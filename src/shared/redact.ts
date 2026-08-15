/** 展示用脱敏：URL、主机名、路径保留；token / 密码只留头尾。 */

const SENSITIVE_QUERY = /([?&](?:access_token|api[_-]?key|auth(?:orization)?|jwt|password|secret|session|token)=)([^&#\s]+)/gi
const BEARER = /\b(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi
const KNOWN_TOKEN = /\b((?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|npm|sk|xox[baprs])[_-])([A-Za-z0-9_-]{8,})/gi
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi

function maskSecret(value: string): string {
  if (value.length <= 6) return '***'
  return `${value.slice(0, 3)}***${value.slice(-2)}`
}

function maskUserInfo(userInfo: string): string {
  const colon = userInfo.indexOf(':')
  if (colon === -1) {
    return looksLikeToken(userInfo) ? maskSecret(userInfo) : userInfo
  }
  const user = userInfo.slice(0, colon)
  const secret = userInfo.slice(colon + 1)
  if (secret === '') return userInfo
  return `${user}:${maskSecret(secret)}`
}

function looksLikeToken(value: string): boolean {
  if (value.length < 16) return false
  if (/^[0-9a-f]{7,40}$/i.test(value)) return false
  return /^[A-Za-z0-9._~+/-]+=*$/.test(value)
}

/** 给即将展示给用户或写入错误条的文本做脱敏。可重复调用。 */
export function redactSecrets(raw: string): string {
  let text = raw
  text = text.replace(URL_USERINFO, (_all, protocol: string, userInfo: string) => {
    return `${protocol}${maskUserInfo(userInfo)}@`
  })
  text = text.replace(SENSITIVE_QUERY, (_all, prefix: string, value: string) => `${prefix}${maskSecret(value)}`)
  text = text.replace(BEARER, (_all, prefix: string, value: string) => `${prefix}${maskSecret(value)}`)
  text = text.replace(KNOWN_TOKEN, (_all, prefix: string, rest: string) => `${prefix}${maskSecret(rest)}`)
  return text
}
