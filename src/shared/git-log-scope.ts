/** GRAPH / git_log 提交范围：当前检出，或本地+远程+标签。 */
export type GitLogScope = 'head' | 'all'

/** 解析 /git/log?scope=。缺省或空串视为当前分支。非法值返回 null，由调用方给出可读错误。 */
export function parseGitLogScope(raw: string | undefined): GitLogScope | null {
  if (raw === undefined) return 'head'
  const value = raw.trim().toLowerCase()
  if (value === '') return 'head'
  if (value === 'head' || value === 'all') return value
  return null
}
