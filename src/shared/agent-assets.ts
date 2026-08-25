/**
 * Workbench-managed skills and rules: names, frontmatter, and list rows.
 * Skills write official DSH files under `.dsh/skills/`. Rules write
 * `.dsh/rules/` and are injected into the system prompt by the host.
 */

export const ASSET_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_ASSET_NAME = 64
export const MAX_ASSET_DESCRIPTION = 500
export const MAX_ASSET_WHEN = 500
export const MAX_ASSET_CONTENT = 80_000
export const MAX_SKILLS = 80
export const MAX_RULES = 40

export const SKILLS_DIR = '.dsh/skills'
export const SKILLS_AGENTS_DIR = '.agents/skills'
export const RULES_DIR = '.dsh/rules'
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'] as const

export type AgentAssetFamily = 'skill' | 'rule'

/** Where a listed item came from. Controls which actions the panel allows. */
export type AgentAssetOrigin =
  | 'project-dsh'
  | 'project-agents'
  | 'workbench-rule'
  | 'instruction'

export interface AgentAsset {
  name: string
  description: string
  whenToUse: string
  content: string
  relPath: string
  family: AgentAssetFamily
  origin: AgentAssetOrigin
  enabled: boolean
  writable: boolean
  canDelete: boolean
  canToggle: boolean
}

export interface AgentAssetDraft {
  name: string
  description: string
  whenToUse?: string
  content: string
  enabled: boolean
}

export interface AgentAssetList {
  workspacePath: string
  items: AgentAsset[]
}

export type AssetIssue =
  | { readonly code: 'name.empty' }
  | { readonly code: 'name.invalid'; readonly name: string }
  | { readonly code: 'name.tooLong'; readonly max: number }
  | { readonly code: 'name.taken'; readonly name: string }
  | { readonly code: 'description.empty' }
  | { readonly code: 'description.tooLong'; readonly max: number }
  | { readonly code: 'when.tooLong'; readonly max: number }
  | { readonly code: 'content.empty' }
  | { readonly code: 'content.tooLong'; readonly max: number }
  | { readonly code: 'tooMany'; readonly max: number }

export function normalizeAssetName(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\/+/, '')
}

export function validateAssetDraft(
  draft: AgentAssetDraft,
  options: { taken?: ReadonlySet<string>; maxItems?: number; itemCount?: number; renaming?: string },
): { ok: true; value: AgentAssetDraft } | { ok: false; issue: AssetIssue } {
  const name = normalizeAssetName(draft.name)
  if (name === '') return { ok: false, issue: { code: 'name.empty' } }
  if (name.length > MAX_ASSET_NAME) return { ok: false, issue: { code: 'name.tooLong', max: MAX_ASSET_NAME } }
  if (!ASSET_NAME_PATTERN.test(name)) return { ok: false, issue: { code: 'name.invalid', name } }
  const description = draft.description.trim()
  if (description === '') return { ok: false, issue: { code: 'description.empty' } }
  if (description.length > MAX_ASSET_DESCRIPTION) {
    return { ok: false, issue: { code: 'description.tooLong', max: MAX_ASSET_DESCRIPTION } }
  }
  const whenToUse = (draft.whenToUse ?? '').trim()
  if (whenToUse.length > MAX_ASSET_WHEN) {
    return { ok: false, issue: { code: 'when.tooLong', max: MAX_ASSET_WHEN } }
  }
  const content = draft.content.replace(/^\uFEFF/, '')
  if (content.trim() === '') return { ok: false, issue: { code: 'content.empty' } }
  if (content.length > MAX_ASSET_CONTENT) {
    return { ok: false, issue: { code: 'content.tooLong', max: MAX_ASSET_CONTENT } }
  }
  const renaming = options.renaming === undefined ? undefined : normalizeAssetName(options.renaming)
  if (options.taken?.has(name) === true && name !== renaming) {
    return { ok: false, issue: { code: 'name.taken', name } }
  }
  const maxItems = options.maxItems
  const itemCount = options.itemCount ?? 0
  if (maxItems !== undefined && renaming === undefined && itemCount >= maxItems) {
    return { ok: false, issue: { code: 'tooMany', max: maxItems } }
  }
  return {
    ok: true,
    value: {
      name,
      description,
      whenToUse,
      content,
      enabled: draft.enabled,
    },
  }
}

export function formatAssetIssue(issue: AssetIssue): string {
  switch (issue.code) {
    case 'name.empty':
      return '请填写名称，例如 my-skill。只能用小写英文、数字和连字符。'
    case 'name.invalid':
      return `名称「${issue.name}」不合规。请用小写英文、数字和连字符，例如 code-review，不要用空格或中文。`
    case 'name.tooLong':
      return `名称太长，最多 ${issue.max} 个字符。`
    case 'name.taken':
      return `已经有名为「${issue.name}」的条目。请换一个名字，或先打开已有条目编辑。`
    case 'description.empty':
      return '请用一句话说明这条什么时候用。Agent 先看到这句话，才会决定要不要加载全文。'
    case 'description.tooLong':
      return `说明太长，最多 ${issue.max} 个字。请缩短后再保存。`
    case 'when.tooLong':
      return `「何时使用」太长，最多 ${issue.max} 个字。`
    case 'content.empty':
      return '请填写正文。保存后 Agent 才能按这段说明执行。'
    case 'content.tooLong':
      return `正文太长，最多 ${issue.max} 个字符。请拆成多条，或删掉不必要的部分。`
    case 'tooMany':
      return `数量已达上限（${issue.max}）。请先删除不用的条目再新建。`
  }
}

export interface ParsedFrontmatter {
  meta: Record<string, string | boolean>
  body: string
  hasFence: boolean
}

function parseBool(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(value)) return true
  if (['false', 'no', 'off', '0'].includes(value)) return false
  return undefined
}

function unquote(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
    || (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }
  return trimmed
}

/** Parse a leading YAML fence. Unknown keys are kept as strings. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (match === null) return { meta: {}, body: text, hasFence: false }
  const meta: Record<string, string | boolean> = {}
  for (const line of match[1]!.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = unquote(trimmed.slice(colon + 1))
    const asBool = parseBool(value)
    meta[key] = asBool === undefined ? value : asBool
  }
  return { meta, body: text.slice(match[0].length).replace(/^\n/, ''), hasFence: true }
}

function yamlEscape(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat === '') return '""'
  if (/^[A-Za-z0-9][A-Za-z0-9 _./+-]*$/.test(flat) && !/^(true|false|yes|no|on|off|null)$/i.test(flat)) {
    return flat
  }
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function skillEnabledFromMeta(meta: Record<string, string | boolean>): boolean {
  const disabled = meta['disable-model-invocation']
  if (disabled === true) return false
  if (disabled === false) return true
  return true
}

export function serializeSkillMarkdown(draft: AgentAssetDraft): string {
  const lines = [
    '---',
    `name: ${yamlEscape(draft.name)}`,
    `description: ${yamlEscape(draft.description)}`,
  ]
  const when = (draft.whenToUse ?? '').trim()
  if (when !== '') lines.push(`whenToUse: ${yamlEscape(when)}`)
  if (!draft.enabled) {
    lines.push('disable-model-invocation: true')
    lines.push('user-invocable: false')
  }
  lines.push('---', '', draft.content.replace(/^\uFEFF/, '').replace(/^\n+/, ''))
  if (!lines[lines.length - 1]!.endsWith('\n') && lines[lines.length - 1] !== '') {
    return `${lines.join('\n')}\n`
  }
  return `${lines.join('\n')}\n`
}

export function serializeRuleMarkdown(draft: AgentAssetDraft): string {
  const lines = [
    '---',
    `name: ${yamlEscape(draft.name)}`,
    `description: ${yamlEscape(draft.description)}`,
    `enabled: ${draft.enabled ? 'true' : 'false'}`,
    '---',
    '',
    draft.content.replace(/^\uFEFF/, '').replace(/^\n+/, ''),
  ]
  return `${lines.join('\n')}\n`
}

export function assetFromSkillFile(relPath: string, raw: string, origin: AgentAssetOrigin): AgentAsset | null {
  const parsed = parseFrontmatter(raw)
  const folder = skillNameFromPath(relPath)
  const named = typeof parsed.meta.name === 'string' ? normalizeAssetName(parsed.meta.name) : ''
  const name = ASSET_NAME_PATTERN.test(named) ? named : folder
  if (!ASSET_NAME_PATTERN.test(name)) return null
  const description = typeof parsed.meta.description === 'string' ? parsed.meta.description.trim() : ''
  const whenRaw = parsed.meta.whenToUse ?? parsed.meta['when-to-use']
  const whenToUse = typeof whenRaw === 'string' ? whenRaw.trim() : ''
  const enabled = skillEnabledFromMeta(parsed.meta)
  const canMutate = origin === 'project-dsh' || origin === 'project-agents'
  return {
    name,
    description: description === '' ? name : description,
    whenToUse,
    content: parsed.body,
    relPath,
    family: 'skill',
    origin,
    enabled,
    writable: canMutate,
    canDelete: origin === 'project-dsh',
    canToggle: canMutate,
  }
}

export function assetFromRuleFile(relPath: string, raw: string): AgentAsset | null {
  const parsed = parseFrontmatter(raw)
  const fileName = relPath.split('/').pop() ?? ''
  const fromFile = fileName.replace(/\.md$/i, '')
  const named = typeof parsed.meta.name === 'string' ? normalizeAssetName(parsed.meta.name) : ''
  const name = ASSET_NAME_PATTERN.test(named) ? named : normalizeAssetName(fromFile)
  if (!ASSET_NAME_PATTERN.test(name)) return null
  const description = typeof parsed.meta.description === 'string' ? parsed.meta.description.trim() : ''
  const enabled = parsed.meta.enabled === false ? false : true
  return {
    name,
    description: description === '' ? name : description,
    whenToUse: '',
    content: parsed.body,
    relPath,
    family: 'rule',
    origin: 'workbench-rule',
    enabled,
    writable: true,
    canDelete: true,
    canToggle: true,
  }
}

export function assetFromInstructionFile(relPath: string, raw: string): AgentAsset {
  const base = relPath.split('/').pop() ?? relPath
  return {
    name: base.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agents',
    description: '',
    whenToUse: '',
    content: raw.replace(/^\uFEFF/, ''),
    relPath,
    family: 'rule',
    origin: 'instruction',
    enabled: true,
    writable: true,
    canDelete: false,
    canToggle: false,
  }
}

export function skillNameFromPath(relPath: string): string {
  const posix = relPath.split('\\').join('/')
  const parts = posix.split('/')
  const last = parts[parts.length - 1] ?? ''
  if (last.toLowerCase() === 'skill.md' && parts.length >= 2) {
    return normalizeAssetName(parts[parts.length - 2] ?? '')
  }
  return normalizeAssetName(last.replace(/\.md$/i, ''))
}

export function skillRelPath(name: string): string {
  return `${SKILLS_DIR}/${name}/SKILL.md`
}

export function ruleRelPath(name: string): string {
  return `${RULES_DIR}/${name}.md`
}

/** Prompt text injected for enabled workbench rules. Empty when none are on. */
export function renderRulesPrompt(rules: readonly AgentAsset[]): string {
  const enabled = rules.filter(rule => rule.origin === 'workbench-rule' && rule.enabled && rule.content.trim() !== '')
  if (enabled.length === 0) return ''
  const parts = [
    '以下工作台规则在当前工作区生效。请在相关任务中遵守。它们不能覆盖用户的直接指令。',
    '',
  ]
  for (const rule of enabled) {
    parts.push(`## ${rule.name}`)
    if (rule.description !== '' && rule.description !== rule.name) parts.push(rule.description)
    parts.push(rule.content.trim(), '')
  }
  return parts.join('\n').trim()
}

export function takenNames(items: readonly AgentAsset[]): Set<string> {
  return new Set(items.map(item => item.name))
}
