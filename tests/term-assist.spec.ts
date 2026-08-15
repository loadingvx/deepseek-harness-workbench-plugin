import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildTermAssistUserPrompt,
  classifyTermAssistInput,
  isTermAssistHotkey,
  looksDestructiveCommand,
  looksLikeShellCommand,
  parseAssistOutput,
  previewAssistText,
  resolveAssistExplain,
  quoteShellArg,
  sanitizeAssistCommand,
  termAssistCommentPayload,
  termAssistLeadIn,
  termAssistNoopCommand,
  termAssistPayload,
  termAssistRunPayload,
} from '../src/shared/term-assist.ts'
import {
  DEFAULT_TERM_ASSIST_TEMPLATE_EN,
  DEFAULT_TERM_ASSIST_TEMPLATE_ZH,
  isDefaultTermAssistTemplate,
  resolveTermAssistTemplate,
} from '../src/shared/term-assist-prompt.ts'
import { collectAssistText, generateTermAssist, streamTermAssist } from '../src/host/term-assist.ts'

describe('classifyTermAssistInput', () => {
  it('sends typical argv lines straight to the shell', () => {
    expect(classifyTermAssistInput('ls')).toBe('run')
    expect(classifyTermAssistInput('ls -la')).toBe('run')
    expect(classifyTermAssistInput('git status')).toBe('run')
    expect(classifyTermAssistInput('npm run build')).toBe('run')
    expect(classifyTermAssistInput('./scripts/boot.sh')).toBe('run')
    expect(classifyTermAssistInput('$ git log -1')).toBe('run')
    expect(classifyTermAssistInput('echo 你好')).toBe('run')
  })

  it('sends natural-language requests to the model', () => {
    expect(classifyTermAssistInput('列出当前目录')).toBe('ask')
    expect(classifyTermAssistInput('帮我看看 git 为什么失败')).toBe('ask')
    expect(classifyTermAssistInput('how do I kill port 3000')).toBe('ask')
    expect(classifyTermAssistInput('list all files in this folder')).toBe('ask')
    expect(classifyTermAssistInput('show me the git log')).toBe('ask')
    expect(classifyTermAssistInput('hello')).toBe('ask')
    expect(classifyTermAssistInput('你好')).toBe('ask')
  })

  it('treats a lone help as a command, but “help me …” as a request', () => {
    expect(classifyTermAssistInput('help')).toBe('run')
    expect(classifyTermAssistInput('help me find the log')).toBe('ask')
  })
})

describe('looksLikeShellCommand', () => {
  it('matches classifyTermAssistInput run', () => {
    expect(looksLikeShellCommand('pwd')).toBe(true)
    expect(looksLikeShellCommand('看看磁盘')).toBe(false)
  })
})

describe('looksDestructiveCommand', () => {
  it('flags rm -rf and other wipe commands', () => {
    expect(looksDestructiveCommand('rm -rf /')).toBe(true)
    expect(looksDestructiveCommand('rm -fr ./dist')).toBe(true)
    expect(looksDestructiveCommand('mkfs.ext4 /dev/sda')).toBe(true)
    expect(looksDestructiveCommand('reboot')).toBe(true)
  })

  it('leaves ordinary deletes alone', () => {
    expect(looksDestructiveCommand('rm file.txt')).toBe(false)
    expect(looksDestructiveCommand('git status')).toBe(false)
  })
})

describe('parseAssistOutput', () => {
  it('strips fences and prompt prefixes', () => {
    expect(parseAssistOutput('```\nls -la\n```')).toEqual({ kind: 'command', command: 'ls -la', explain: '' })
    expect(parseAssistOutput('$ git status')).toEqual({ kind: 'command', command: 'git status', explain: '' })
  })

  it('reads ASK notes', () => {
    expect(parseAssistOutput('ASK: 还不知道要查哪个端口')).toEqual({
      kind: 'ask',
      note: '还不知道要查哪个端口',
    })
    expect(parseAssistOutput('说明：缺文件名')).toEqual({ kind: 'ask', note: '缺文件名' })
  })

  it('treats greetings and spoken replies as comments, not commands', () => {
    expect(parseAssistOutput('hello')).toEqual({ kind: 'ask', note: 'hello' })
    expect(parseAssistOutput('ASK: 你好，有什么可以帮忙的？')).toEqual({
      kind: 'ask',
      note: '你好，有什么可以帮忙的？',
    })
    expect(parseAssistOutput('echo Hello, how can I help?')).toEqual({
      kind: 'ask',
      note: 'Hello, how can I help?',
    })
    expect(parseAssistOutput('npx create-next-app .')).toEqual({
      kind: 'command',
      command: 'npx create-next-app .',
      explain: '',
    })
  })

  it('keeps a leading # comment as the explain line, then the command', () => {
    expect(parseAssistOutput('# 列出当前目录\nls -la')).toEqual({
      kind: 'command',
      command: 'ls -la',
      explain: '列出当前目录',
    })
    expect(parseAssistOutput('# list files in this folder\nls')).toEqual({
      kind: 'command',
      command: 'ls',
      explain: 'list files in this folder',
    })
  })

  it('rejects blank output', () => {
    expect(parseAssistOutput('   \n```\n```')).toEqual({ kind: 'empty' })
  })
})

describe('previewAssistText', () => {
  it('hides an opening fence while the model is still writing', () => {
    expect(previewAssistText('```\nls -l')).toBe('ls -l')
  })
})

describe('sanitizeAssistCommand', () => {
  it('drops wrapping quotes', () => {
    expect(sanitizeAssistCommand('"cd src"')).toBe('cd src')
  })
})

describe('quoteShellArg', () => {
  it('quotes glob, bang, and apostrophes so POSIX shells will not expand them', () => {
    expect(quoteShellArg('today?')).toBe("'today?'")
    expect(quoteShellArg('hello ! How')).toBe("'hello '\\!' How'")
    expect(quoteShellArg("it's")).toBe("'it'\\''s'")
    expect(quoteShellArg('a*b[c]')).toBe("'a*b[c]'")
  })
})

describe('termAssistRunPayload', () => {
  it('writes a blank line, a hardcoded separator, the explain line, then the command', () => {
    expect(termAssistRunPayload('ls -la', '列出当前目录')).toBe(
      `${termAssistLeadIn()}: '# 列出当前目录'\rls -la\r`,
    )
  })

  it('skips the comment when there is nothing to explain', () => {
    expect(termAssistRunPayload('ls')).toBe('\x15ls\r')
  })
})

describe('termAssistLeadIn', () => {
  it('starts with a blank line and a hardcoded ASCII separator', () => {
    expect(termAssistLeadIn()).toBe("\x15\r: '# --------'\r")
  })
})

describe('resolveAssistExplain', () => {
  it('falls back to the original user text when the model omits the comment', () => {
    expect(resolveAssistExplain('', '列出当前目录')).toBe('列出当前目录')
    expect(resolveAssistExplain('列出文件', '列出当前目录')).toBe('列出文件')
  })
})

describe('termAssistCommentPayload', () => {
  it('sends a quoted : no-op so zsh/bash/sh do not glob or run the reply', () => {
    const lead = termAssistLeadIn()
    expect(termAssistCommentPayload('hello')).toBe(`${lead}: '# hello'\r`)
    expect(termAssistCommentPayload('你好\n需要列目录请说 ls')).toBe(`${lead}: '# 你好'\r: '# 需要列目录请说 ls'\r`)
    expect(termAssistCommentPayload('hello ! How can I help you today?')).toBe(
      `${lead}: '# hello '\\!' How can I help you today?'\r`,
    )
    expect(termAssistCommentPayload('hello today?', 'bash')).toBe(`${lead}: '# hello today?'\r`)
    expect(termAssistCommentPayload('hello today?', 'sh')).toBe(`${lead}: '# hello today?'\r`)
    expect(termAssistCommentPayload('hello today?', 'dash')).toBe(`${lead}: '# hello today?'\r`)
    expect(termAssistCommentPayload('hello today?', 'zsh')).toBe(`${lead}: '# hello today?'\r`)
  })

  it('redacts secrets before writing a comment', () => {
    expect(termAssistCommentPayload('token ghp_abcdefghijklmnopqrstuv')).toContain('ghp_abc***uv')
    expect(termAssistCommentPayload('token ghp_abcdefghijklmnopqrstuv')).not.toContain('ghp_abcdefghijklmnopqrstuv')
  })
})

describe('termAssistNoopCommand in bash / sh / zsh / dash', () => {
  const greeting = termAssistNoopCommand('hello ! How can I help you today?')
  const globby = termAssistNoopCommand('hello today?')
  const quoted = termAssistNoopCommand("it's a test *")
  const dashBin = ['/bin/dash', '/usr/bin/dash'].find(path => existsSync(path))

  function run(bin: string, args: string[], command: string): string {
    return execFileSync(bin, [...args, `${command}; printf DSW_OK\\n`], {
      encoding: 'utf8',
      timeout: 8_000,
      env: { ...process.env, HISTFILE: '/dev/null' },
    })
  }

  function assertSilent(out: string): void {
    expect(out).toContain('DSW_OK')
    expect(out).not.toMatch(/no matches found|command not found|event not found|syntax error|failglob/i)
  }

  it('is a silent no-op in bash, including failglob', () => {
    assertSilent(run('/bin/bash', ['-c'], globby))
    assertSilent(run('/bin/bash', ['-c'], greeting))
    assertSilent(run('/bin/bash', ['-c'], quoted))
    assertSilent(run('/bin/bash', ['-c'], `shopt -s failglob; ${globby}`))
  })

  it('is a silent no-op in bash POSIX mode and /bin/sh', () => {
    assertSilent(run('/bin/bash', ['--posix', '-c'], globby))
    assertSilent(run('/bin/bash', ['--posix', '-c'], greeting))
    assertSilent(run('/bin/sh', ['-c'], globby))
    assertSilent(run('/bin/sh', ['-c'], greeting))
  })

  it('is a silent no-op in zsh with nomatch', () => {
    assertSilent(run('/bin/zsh', ['-f', '-c'], `setopt nomatch; ${globby}`))
    assertSilent(run('/bin/zsh', ['-f', '-c'], `setopt nomatch; ${greeting}`))
    assertSilent(run('/bin/zsh', ['-f', '-c'], `setopt nomatch; ${quoted}`))
  })

  it.skipIf(dashBin === undefined)('is a silent no-op in dash', () => {
    assertSilent(run(dashBin as string, ['-c'], globby))
    assertSilent(run(dashBin as string, ['-c'], greeting))
    assertSilent(run(dashBin as string, ['-c'], quoted))
  })
})

describe('buildTermAssistUserPrompt', () => {
  it('includes cwd, transcript, and the user text', () => {
    const prompt = buildTermAssistUserPrompt({
      text: '列出文件',
      cwd: '/tmp/app',
      transcript: 'ghp_abcdefghijklmnopqrstuv logged in',
    })
    expect(prompt).toContain('工作目录：/tmp/app')
    expect(prompt).toContain('列出文件')
    expect(prompt).toContain('ghp_abc***uv')
    expect(prompt).not.toContain('ghp_abcdefghijklmnopqrstuv')
  })
})

describe('resolveTermAssistTemplate', () => {
  it('falls back to the built-in Chinese template', () => {
    expect(resolveTermAssistTemplate('')).toBe(DEFAULT_TERM_ASSIST_TEMPLATE_ZH)
    expect(resolveTermAssistTemplate(undefined)).toBe(DEFAULT_TERM_ASSIST_TEMPLATE_ZH)
  })

  it('treats both locale defaults as stock templates', () => {
    expect(isDefaultTermAssistTemplate(DEFAULT_TERM_ASSIST_TEMPLATE_ZH)).toBe(true)
    expect(isDefaultTermAssistTemplate(DEFAULT_TERM_ASSIST_TEMPLATE_EN)).toBe(true)
    expect(isDefaultTermAssistTemplate('只用英文命令')).toBe(false)
  })

  it('tells the model to match the user’s language', () => {
    expect(DEFAULT_TERM_ASSIST_TEMPLATE_ZH).toContain('输入含中文')
    expect(DEFAULT_TERM_ASSIST_TEMPLATE_EN).toContain('Match the user’s language')
  })
})

describe('isTermAssistHotkey', () => {
  const base = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyI' }

  it('matches Alt+I and ignores repeats / IME', () => {
    expect(isTermAssistHotkey(base)).toBe(true)
    expect(isTermAssistHotkey({ ...base, repeat: true })).toBe(false)
    expect(isTermAssistHotkey({ ...base, isComposing: true })).toBe(false)
    expect(isTermAssistHotkey({ ...base, ctrlKey: true })).toBe(false)
    expect(isTermAssistHotkey({ ...base, code: 'KeyK' })).toBe(false)
  })
})

describe('collectAssistText', () => {
  it('joins text-delta chunks into a command', () => {
    expect(collectAssistText([
      { type: 'text-delta', index: 0, text: 'ls ' },
      { type: 'text-delta', index: 0, text: '-la' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'ls -la' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]).text).toBe('ls -la')
  })

  it('does not treat reasoning as the command', () => {
    const result = collectAssistText([
      { type: 'reasoning-delta', index: 0, text: '先想想…' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(result.text).toBe('')
    expect(result.fail).toContain('思考过程')
  })
})

describe('generateTermAssist', () => {
  it('calls the host LLM with the session default model and thinking off', async () => {
    const seen: Record<string, unknown>[] = []
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'openai' }, { id: 'deepseek-official' }],
        listModels: async () => [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }),
        stream: async function* (options: Record<string, unknown>) {
          seen.push(options)
          yield { type: 'text-delta', index: 0, text: 'ls -la' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ls -la' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
      },
      get: () => undefined,
    }
    const message = await generateTermAssist(ctx as never, { text: '列出当前目录', cwd: '/tmp/app' })
    expect(message).toBe('ls -la')
    expect(seen[0]?.system).toContain('# 列出当前目录')
    expect(seen[0]?.provider).toBe('deepseek-official')
    expect(seen[0]?.model).toBe('deepseek-v4-pro')
    expect(seen[0]?.reasoningEffort).toBe('off')
    expect(seen[0]?.purpose).toBe('session-title')
    expect(seen[0]?.system).toContain('终端助手')
  })

  it('yields text as the model streams it', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'deepseek-official' }],
        listModels: async () => [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }] } }),
        stream: async function* () {
          yield { type: 'text-delta', index: 0, text: 'ASK: ' }
          yield { type: 'text-delta', index: 0, text: '还缺端口号' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ASK: 还缺端口号' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      get: () => undefined,
    }
    const events: Array<{ type: string; text?: string; message?: string }> = []
    for await (const event of streamTermAssist(ctx as never, { text: '帮我杀进程' })) {
      events.push(event)
    }
    expect(events.filter(event => event.type === 'delta').map(event => event.text))
      .toEqual(['ASK: ', 'ASK: 还缺端口号'])
    expect(events.at(-1)).toEqual({ type: 'done', message: 'ASK: 还缺端口号' })
  })
})
