import { describe, expect, it } from 'vitest'
import { buildTrajectoryFromMessages } from '../src/shared/trajectory-build.ts'
import { supplementTrajectoryFromSession } from '../src/shared/trajectory-session-supplement.ts'
import { buildContextInjectionPosts, buildThreadFeed, buildThreadPosts, flattenThreadPosts } from '../src/client/workbench/trajectory-thread.ts'

describe('supplementTrajectoryFromSession', () => {
  it('补用户锚点但不注入未知工具', () => {
    const graph = buildTrajectoryFromMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-host',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"a.ts"}' },
        }],
      },
    ])

    const supplemented = supplementTrajectoryFromSession(graph, [
      { role: 'user', content: '请读文件' },
      {
        id: 'orphan-tool',
        name: 'Grep',
        input: { pattern: 'foo' },
        content: [{ type: 'text', text: 'match' }],
      },
    ], undefined)

    expect(supplemented.userTurns).toHaveLength(1)
    expect(supplemented.userTurns[0]?.text).toContain('请读文件')
    expect(supplemented.toolCalls).toHaveLength(1)
    expect(supplemented.toolCalls.some(t => t.id === 'orphan-tool')).toBe(false)
  })
})

describe('buildContextInjectionPosts', () => {
  it('展示 Context 注入为可折叠 system 帖', () => {
    const posts = buildContextInjectionPosts([
      { kind: 'context', label: 'README.md', content: '# Title\nbody' },
      { type: 'reference', name: 'src/foo.ts', text: 'export const x = 1' },
    ])

    expect(posts).toHaveLength(2)
    expect(posts.every(p => p.depth === 0 && p.author === 'system')).toBe(true)
    expect(posts[0]?.title).toBe('Context 注入')
    expect(posts[0]?.subtitle).toBe('README.md')
  })

  it('将 Context 插在首个用户消息之前', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
    const posts = buildThreadPosts(graph, {
      sessionNodes: [{ kind: 'context', label: 'rules', content: 'be nice' }],
    })

    expect(posts[0]?.author).toBe('system')
    expect(posts[1]?.author).toBe('user')
  })
})

describe('buildThreadFeed', () => {
  it('有工具时从 response 或 assistant 消息补 Agent 回复行以接上导轨', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-1',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"a.ts"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'tc-1', content: 'ok' },
    ])
    graph.llmTurns[0]!.messages.push({
      role: 'assistant',
      preview: 'All done',
      fullText: 'All done. Summary here.',
    })

    const feed = buildThreadFeed(graph)
    const episode = feed.find(item => item.kind === 'llmEpisode')
    expect(episode?.kind).toBe('llmEpisode')
    if (episode?.kind !== 'llmEpisode') return

    const reply = episode.episode.children.find(child => child.title === 'Agent 回复')
    expect(reply?.body).toContain('All done')
    expect(episode.episode.header.body).toBeUndefined()
    expect(episode.episode.header.messages).toBeUndefined()
  })

  it('无工具时结果也走 Agent 回复行，避免导轨断在 header 内', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'final answer' },
    ])
    const feed = buildThreadFeed(graph)
    const episode = feed.find(item => item.kind === 'llmEpisode')
    expect(episode?.kind).toBe('llmEpisode')
    if (episode?.kind !== 'llmEpisode') return

    expect(episode.episode.children).toHaveLength(1)
    expect(episode.episode.children[0]?.title).toBe('Agent 回复')
    expect(episode.episode.header.body).toBeUndefined()
  })
})

describe('buildThreadPosts tool title', () => {
  it('工具标题为 toolName，副标题为命令预览', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'run' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-1',
          type: 'function',
          function: { name: 'run_code', arguments: '{"command":"npm test"}' },
        }],
      },
    ])

    const toolPost = buildThreadPosts(graph).find(p => p.author === 'tool')
    expect(toolPost?.title).toBe('run_code')
    expect(toolPost?.subtitle).toContain('npm test')
  })
})
