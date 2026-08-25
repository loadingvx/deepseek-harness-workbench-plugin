import {
  assetFromInstructionFile,
  assetFromRuleFile,
  assetFromSkillFile,
  formatAssetIssue,
  INSTRUCTION_FILES,
  MAX_ASSET_CONTENT,
  MAX_RULES,
  MAX_SKILLS,
  RULES_DIR,
  SKILLS_AGENTS_DIR,
  SKILLS_DIR,
  serializeRuleMarkdown,
  serializeSkillMarkdown,
  takenNames,
  validateAssetDraft,
  type AgentAsset,
  type AgentAssetDraft,
  type AgentAssetFamily,
  type AgentAssetList,
} from '../../shared/agent-assets.ts'
import { GitError } from '../../shared/errors.ts'
import { WorkspaceFs } from '../workspace-fs.ts'

async function readOptional(fs: WorkspaceFs, root: string, rel: string): Promise<string | null> {
  try {
    const snap = await fs.read(root, rel)
    return snap.content
  } catch (error) {
    if (error instanceof GitError) {
      if (
        error.code === 'FS_NOT_FOUND'
        || error.code === 'FS_IS_DIRECTORY'
        || error.code === 'FS_BINARY'
        || error.code === 'FS_TOO_LARGE'
      ) {
        return null
      }
    }
    throw error
  }
}

async function listRel(fs: WorkspaceFs, root: string, rel: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
  try {
    const snap = await fs.list(root, rel)
    return snap.entries.map(entry => ({ name: entry.name, kind: entry.kind }))
  } catch (error) {
    if (error instanceof GitError && (error.code === 'FS_NOT_FOUND' || error.code === 'FS_IS_DIRECTORY')) {
      return []
    }
    throw error
  }
}

async function scanSkills(fs: WorkspaceFs, root: string): Promise<AgentAsset[]> {
  const found: AgentAsset[] = []
  const seen = new Set<string>()
  const roots: Array<{ dir: string; origin: 'project-dsh' | 'project-agents' }> = [
    { dir: SKILLS_DIR, origin: 'project-dsh' },
    { dir: SKILLS_AGENTS_DIR, origin: 'project-agents' },
  ]
  for (const { dir, origin } of roots) {
    const entries = await listRel(fs, root, dir)
    for (const entry of entries) {
      const rel = entry.kind === 'directory'
        ? `${dir}/${entry.name}/SKILL.md`
        : entry.name.toLowerCase().endsWith('.md')
          ? `${dir}/${entry.name}`
          : null
      if (rel === null) continue
      const raw = await readOptional(fs, root, rel)
      if (raw === null) continue
      const asset = assetFromSkillFile(rel, raw, origin)
      if (asset === null) continue
      if (seen.has(asset.name)) continue
      seen.add(asset.name)
      found.push(asset)
    }
  }
  found.sort((left, right) => left.name.localeCompare(right.name))
  return found
}

async function scanRules(fs: WorkspaceFs, root: string): Promise<AgentAsset[]> {
  const found: AgentAsset[] = []
  const seen = new Set<string>()
  const entries = await listRel(fs, root, RULES_DIR)
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    const rel = `${RULES_DIR}/${entry.name}`
    const raw = await readOptional(fs, root, rel)
    if (raw === null) continue
    const asset = assetFromRuleFile(rel, raw)
    if (asset === null) continue
    if (seen.has(asset.name)) continue
    seen.add(asset.name)
    found.push(asset)
  }
  found.sort((left, right) => left.name.localeCompare(right.name))
  for (const file of INSTRUCTION_FILES) {
    const raw = await readOptional(fs, root, file)
    if (raw === null) continue
    found.push(assetFromInstructionFile(file, raw))
  }
  return found
}

function findAsset(items: AgentAsset[], name: string, relPath?: string): AgentAsset | undefined {
  if (relPath !== undefined && relPath !== '') {
    const byPath = items.find(item => item.relPath === relPath)
    if (byPath !== undefined) return byPath
  }
  const matches = items.filter(item => item.name === name)
  if (matches.length <= 1) return matches[0]
  return matches.find(item => item.origin !== 'instruction') ?? matches[0]
}

async function ensureDir(fs: WorkspaceFs, root: string, rel: string): Promise<void> {
  const parts = rel.split('/').filter(part => part !== '' && part !== '.')
  let acc = ''
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`
    try {
      await fs.mkdir(root, acc)
    } catch (error) {
      if (error instanceof GitError && error.code === 'FS_EXISTS') continue
      throw error
    }
  }
}

function parentRel(rel: string): string {
  const parts = rel.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function failIssue(message: string): never {
  throw new GitError('ASSET_INVALID', message)
}

export class AgentAssetStore {
  constructor(private readonly fs: WorkspaceFs) {}

  async list(root: string, family: AgentAssetFamily): Promise<AgentAssetList> {
    const items = family === 'skill' ? await scanSkills(this.fs, root) : await scanRules(this.fs, root)
    return { workspacePath: root, items }
  }

  async get(root: string, family: AgentAssetFamily, name: string, relPath?: string): Promise<AgentAsset> {
    const list = await this.list(root, family)
    const found = findAsset(list.items, name, relPath)
    if (found === undefined) throw new GitError('FS_NOT_FOUND')
    return found
  }

  async create(root: string, family: AgentAssetFamily, draft: AgentAssetDraft): Promise<AgentAsset> {
    const list = await this.list(root, family)
    const managed = list.items.filter(item => item.origin !== 'instruction')
    const checked = validateAssetDraft(draft, {
      taken: takenNames(managed),
      maxItems: family === 'skill' ? MAX_SKILLS : MAX_RULES,
      itemCount: managed.length,
    })
    if (!checked.ok) failIssue(formatAssetIssue(checked.issue))
    const rel = family === 'skill'
      ? `${SKILLS_DIR}/${checked.value.name}/SKILL.md`
      : `${RULES_DIR}/${checked.value.name}.md`
    const existing = await readOptional(this.fs, root, rel)
    if (existing !== null) failIssue(formatAssetIssue({ code: 'name.taken', name: checked.value.name }))
    const markdown = family === 'skill'
      ? serializeSkillMarkdown(checked.value)
      : serializeRuleMarkdown(checked.value)
    const parent = parentRel(rel)
    if (parent !== '') await ensureDir(this.fs, root, parent)
    await this.fs.write(root, rel, markdown)
    return this.get(root, family, checked.value.name, rel)
  }

  async update(
    root: string,
    family: AgentAssetFamily,
    name: string,
    patch: Partial<AgentAssetDraft>,
    relPath?: string,
  ): Promise<AgentAsset> {
    const current = await this.get(root, family, name, relPath)
    if (!current.writable) {
      failIssue('这项不能改。请新建一条工作台规则，或只编辑可写的项目 skill。')
    }
    if (current.origin === 'instruction') {
      if (typeof patch.content !== 'string') return current
      if (patch.content.trim() === '') failIssue(formatAssetIssue({ code: 'content.empty' }))
      if (patch.content.length > MAX_ASSET_CONTENT) failIssue(formatAssetIssue({ code: 'content.tooLong', max: MAX_ASSET_CONTENT }))
      await this.fs.write(root, current.relPath, patch.content)
      return this.get(root, family, current.name, current.relPath)
    }
    const next: AgentAssetDraft = {
      name: current.name,
      description: patch.description ?? current.description,
      whenToUse: patch.whenToUse ?? current.whenToUse,
      content: patch.content ?? current.content,
      enabled: patch.enabled ?? current.enabled,
    }
    const managed = (await this.list(root, family)).items.filter(item => item.origin !== 'instruction')
    const checked = validateAssetDraft(next, {
      taken: takenNames(managed),
      renaming: current.name,
    })
    if (!checked.ok) failIssue(formatAssetIssue(checked.issue))
    const markdown = family === 'skill'
      ? serializeSkillMarkdown(checked.value)
      : serializeRuleMarkdown(checked.value)
    await this.fs.write(root, current.relPath, markdown)
    return this.get(root, family, current.name, current.relPath)
  }

  async setEnabled(
    root: string,
    family: AgentAssetFamily,
    name: string,
    enabled: boolean,
    relPath?: string,
  ): Promise<AgentAsset> {
    const current = await this.get(root, family, name, relPath)
    if (!current.canToggle) {
      failIssue('工作区指令由 DeepSeek Harness 自动加载，不能在这里停用。请改用下方可开关的工作台规则。')
    }
    return this.update(root, family, name, { enabled }, current.relPath)
  }

  async remove(root: string, family: AgentAssetFamily, name: string, relPath?: string): Promise<void> {
    const current = await this.get(root, family, name, relPath)
    if (!current.canDelete) {
      failIssue('这项不能删除。工作区指令文件请在文件树里处理；`.agents/skills` 下的 skill 请改到 `.dsh/skills` 后再删。')
    }
    const target = family === 'skill' ? `${SKILLS_DIR}/${current.name}` : current.relPath
    try {
      await this.fs.delete(root, target)
    } catch (error) {
      if (error instanceof GitError && error.code === 'FS_NOT_FOUND') return
      throw error
    }
  }
}
