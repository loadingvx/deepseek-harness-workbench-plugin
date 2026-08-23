import { spawn } from 'node:child_process'
import { GitError } from '../shared/errors.ts'
import { redactSecrets } from '../shared/redact.ts'

const DEFAULT_TIMEOUT_MS = 30_000

export interface GitExecOptions {
  cwd: string
  args: readonly string[]
  signal?: AbortSignal
  timeoutMs?: number
  allowNonZero?: boolean
  /** Written to git stdin, then closed. Used by `check-ignore --stdin`. */
  input?: string
  /** Merged over the default git env. Tests use this to isolate `--global` writes. */
  env?: NodeJS.ProcessEnv
}

export interface GitExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

function classifyFailure(stderr: string, exitCode: number): GitError {
  const text = `${stderr}`
  if (/index\.lock/i.test(text)) return new GitError('INDEX_LOCKED')
  if (/not a git repository/i.test(text)) return new GitError('NOT_A_REPO')
  if (/did not match any file/i.test(text) && /pathspec/i.test(text)) return new GitError('INVALID_PATH')
  if (/please tell me who you are/i.test(text) || /user\.email/i.test(text) || /user\.name/i.test(text)) {
    return new GitError('IDENTITY_MISSING')
  }
  if (/your local changes/i.test(text) || /would be overwritten/i.test(text)) return new GitError('DIRTY_WORKTREE')
  if (/already exists/i.test(text)) return new GitError('BRANCH_EXISTS')
  if (/pathspec '.*' did not match/i.test(text)) return new GitError('BRANCH_MISSING')
  if (/conflict|automatic merge failed|fix conflicts|unmerged paths/i.test(text)) {
    return new GitError('MERGE_CONFLICT')
  }
  if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|403 forbidden|401 unauthorized/i.test(text)) {
    return new GitError('AUTH_FAILED')
  }
  if (/could not resolve host|unable to access|failed to connect|connection refused|network is unreachable|timed out/i.test(text)) {
    return new GitError('REMOTE_UNREACHABLE')
  }
  if (/not possible to fast-forward|diverging branches|need to specify how to reconcile/i.test(text)) {
    return new GitError('DIVERGED')
  }
  if (/rejected.*non-fast-forward|failed to push some refs|updates were rejected/i.test(text)) {
    return new GitError('REMOTE_AHEAD')
  }
  if (/no upstream|no tracking information|does not have a corresponding remote/i.test(text)) {
    return new GitError('NO_UPSTREAM')
  }
  const detail = redactSecrets(text.trim() || `退出码 ${exitCode}`)
  return new GitError('GIT_FAILED', detail.slice(0, 400))
}

/** Run `git` with a timeout and map common failures to GitError. */
export function runGit(options: GitExecOptions): Promise<GitExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error('aborted'))
      return
    }
    const child = spawn('git', options.args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...options.env },
      stdio: [options.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => { /* git may close stdin before we finish writing */ })
      child.stdin.end(options.input, 'utf8')
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })

    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new GitError('GIT_FAILED', `命令超时（${timeoutMs}ms）：git ${options.args.join(' ')}`))
    }, timeoutMs)

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error.code === 'ENOENT') reject(new GitError('GIT_NOT_FOUND'))
      else reject(new GitError('GIT_FAILED', error.message))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      const exitCode = code ?? 1
      if (exitCode !== 0 && !options.allowNonZero) {
        reject(classifyFailure(`${stdout}\n${stderr}`, exitCode))
        return
      }
      resolve({ stdout, stderr, exitCode })
    })
  })
}

export async function gitAvailable(signal?: AbortSignal): Promise<{ ok: true; version: string } | { ok: false }> {
  try {
    const result = await runGit({ cwd: process.cwd(), args: ['--version'], signal, timeoutMs: 8_000 })
    return { ok: true, version: result.stdout.trim() }
  } catch (error) {
    if (error instanceof GitError && error.code === 'GIT_NOT_FOUND') return { ok: false }
    throw error
  }
}
