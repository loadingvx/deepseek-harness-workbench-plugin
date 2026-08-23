import { runGit } from './git-exec.ts'

async function isGitWorkTree(root: string): Promise<boolean> {
  try {
    const result = await runGit({
      cwd: root,
      args: ['rev-parse', '--is-inside-work-tree'],
      allowNonZero: true,
      timeoutMs: 4_000,
    })
    return result.exitCode === 0 && result.stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** Paths that `git check-ignore` treats as ignored (untracked + matching .gitignore). Tracked files stay out. */
export async function ignoredPathSet(root: string, paths: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(paths.filter(path => path !== ''))]
  if (unique.length === 0) return new Set()
  if (!(await isGitWorkTree(root))) return new Set()
  try {
    const result = await runGit({
      cwd: root,
      args: ['check-ignore', '-z', '--stdin'],
      input: `${unique.join('\0')}\0`,
      allowNonZero: true,
      timeoutMs: 8_000,
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) return new Set()
    return new Set(result.stdout.split('\0').filter(Boolean))
  } catch {
    return new Set()
  }
}

export async function attachIgnored<T extends { path: string }>(
  root: string,
  entries: readonly T[],
): Promise<Array<T & { ignored: boolean }>> {
  const ignored = await ignoredPathSet(root, entries.map(entry => entry.path))
  return entries.map(entry => ({ ...entry, ignored: ignored.has(entry.path) }))
}
