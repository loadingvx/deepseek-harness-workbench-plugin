import { invalidBranchName, normalizeBranchName } from './branch-name.ts'

export const DEFAULT_INIT_BRANCH = 'main'

const NAME_MAX = 128
const EMAIL_MAX = 254

/** Reject names git would store poorly or that look empty to a person. */
export function invalidGitUserName(raw: string): 'empty' | 'invalid' | null {
  const name = raw.trim()
  if (name === '') return 'empty'
  if (name.length > NAME_MAX) return 'invalid'
  if (/[\r\n\0]/.test(name)) return 'invalid'
  return null
}

/** Git is permissive; we only require a non-empty local-part@host so 小白能一眼看懂。 */
export function invalidGitUserEmail(raw: string): 'empty' | 'invalid' | null {
  const email = raw.trim()
  if (email === '') return 'empty'
  if (email.length > EMAIL_MAX) return 'invalid'
  if (/[\s\r\n\0]/.test(email)) return 'invalid'
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return 'invalid'
  return null
}

export function normalizeGitUserName(raw: string): string {
  return raw.trim()
}

export function normalizeGitUserEmail(raw: string): string {
  return raw.trim()
}

export function normalizeInitBranch(raw: string): string {
  const name = normalizeBranchName(raw)
  return name === '' ? DEFAULT_INIT_BRANCH : name
}

/** Empty input becomes `main`. Only reject names git would refuse. */
export function invalidInitBranch(raw: string): 'invalid' | null {
  const reason = invalidBranchName(normalizeInitBranch(raw))
  return reason === 'invalid' ? 'invalid' : null
}
