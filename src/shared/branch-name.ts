/** Reject names that git would refuse or that look like flags / path tricks. */
export function invalidBranchName(raw: string): 'empty' | 'invalid' | null {
  const name = raw.trim()
  if (name === '') return 'empty'
  if (name.length > 64) return 'invalid'
  if (name === 'HEAD' || name === '@') return 'invalid'
  if (/^[./-]/.test(name)) return 'invalid'
  if (/[./]$/.test(name) || name.endsWith('.lock')) return 'invalid'
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return 'invalid'
  if (/[\s~^:?*[\\]/.test(name)) return 'invalid'
  return null
}

export function normalizeBranchName(raw: string): string {
  return raw.trim()
}
