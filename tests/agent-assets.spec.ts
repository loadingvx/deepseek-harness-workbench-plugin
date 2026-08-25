import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assetFromSkillFile,
  parseFrontmatter,
  renderRulesPrompt,
  serializeRuleMarkdown,
  serializeSkillMarkdown,
  validateAssetDraft,
  type AgentAsset,
} from '../src/shared/agent-assets.ts'
import { GitError } from '../src/shared/errors.ts'
import { AgentAssetStore } from '../src/host/agent-assets/store.ts'
import { WorkspaceFs } from '../src/host/workspace-fs.ts'
import { agentAssetsEn, agentAssetsZh } from '../src/client/workbench/agent-assets-locales.ts'

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'dsh-assets-')))
}

const draft = {
  name: 'code-review',
  description: '改代码前先看 diff',
  whenToUse: '有未提交改动时',
  content: '先 git diff，再改。',
  enabled: true,
}

describe('agent-assets parse/validate', () => {
  it('round-trips skill frontmatter including disable flags', () => {
    const markdown = serializeSkillMarkdown({ ...draft, enabled: false })
    expect(markdown).toContain('disable-model-invocation: true')
    expect(markdown).toContain('user-invocable: false')
    const parsed = parseFrontmatter(markdown)
    expect(parsed.meta.name).toBe('code-review')
    expect(parsed.meta['disable-model-invocation']).toBe(true)
    expect(parsed.body.trim()).toBe('先 git diff，再改。')
    const asset = assetFromSkillFile('.dsh/skills/code-review/SKILL.md', markdown, 'project-dsh')
    expect(asset?.enabled).toBe(false)
    expect(asset?.canDelete).toBe(true)
  })

  it('rejects empty, chinese, and duplicate names', () => {
    expect(validateAssetDraft({ ...draft, name: '' }).ok).toBe(false)
    expect(validateAssetDraft({ ...draft, name: '代码' }).ok).toBe(false)
    expect(validateAssetDraft({ ...draft, content: '  ' }).ok).toBe(false)
    expect(validateAssetDraft(draft, { taken: new Set(['code-review']) }).ok).toBe(false)
    expect(validateAssetDraft(draft, { taken: new Set(['code-review']), renaming: 'code-review' }).ok).toBe(true)
  })

  it('renders only enabled workbench rules into the prompt', () => {
    const rules: AgentAsset[] = [
      {
        name: 'no-force',
        description: '禁止强推',
        whenToUse: '',
        content: '不要 git push --force。',
        relPath: '.dsh/rules/no-force.md',
        family: 'rule',
        origin: 'workbench-rule',
        enabled: true,
        writable: true,
        canDelete: true,
        canToggle: true,
      },
      {
        name: 'off',
        description: '关掉的',
        whenToUse: '',
        content: '不该出现',
        relPath: '.dsh/rules/off.md',
        family: 'rule',
        origin: 'workbench-rule',
        enabled: false,
        writable: true,
        canDelete: true,
        canToggle: true,
      },
      {
        name: 'agents',
        description: 'AGENTS.md',
        whenToUse: '',
        content: '仓库指令',
        relPath: 'AGENTS.md',
        family: 'rule',
        origin: 'instruction',
        enabled: true,
        writable: true,
        canDelete: false,
        canToggle: false,
      },
    ]
    const text = renderRulesPrompt(rules)
    expect(text).toContain('no-force')
    expect(text).toContain('不要 git push --force。')
    expect(text).not.toContain('不该出现')
    expect(text).not.toContain('仓库指令')
  })
})

describe('AgentAssetStore', () => {
  it('creates, toggles, and deletes a project skill', async () => {
    const root = await tempRoot()
    const store = new AgentAssetStore(new WorkspaceFs())
    const created = await store.create(root, 'skill', draft)
    expect(created.relPath).toBe('.dsh/skills/code-review/SKILL.md')
    const raw = await readFile(join(root, created.relPath), 'utf8')
    expect(raw).toContain('name: code-review')
    const off = await store.setEnabled(root, 'skill', 'code-review', false)
    expect(off.enabled).toBe(false)
    const after = await readFile(join(root, created.relPath), 'utf8')
    expect(after).toContain('disable-model-invocation: true')
    await store.remove(root, 'skill', 'code-review')
    const listed = await store.list(root, 'skill')
    expect(listed.items).toEqual([])
  })

  it('refuses a second skill with the same name and keeps the first', async () => {
    const root = await tempRoot()
    const store = new AgentAssetStore(new WorkspaceFs())
    await store.create(root, 'skill', draft)
    await expect(store.create(root, 'skill', { ...draft, content: '另一份' })).rejects.toMatchObject({ code: 'ASSET_INVALID' })
  })

  it('creates a toggleable rule and lists AGENTS.md as non-toggleable', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'AGENTS.md'), 'root agents\n')
    const store = new AgentAssetStore(new WorkspaceFs())
    const rule = await store.create(root, 'rule', {
      name: 'no-rm-rf',
      description: '不要乱删',
      content: '禁止 rm -rf /。',
      enabled: true,
    })
    expect(rule.origin).toBe('workbench-rule')
    expect(serializeRuleMarkdown({
      name: rule.name,
      description: rule.description,
      content: rule.content,
      enabled: true,
    })).toContain('enabled: true')
    const list = await store.list(root, 'rule')
    const instruction = list.items.find(item => item.origin === 'instruction')
    expect(instruction?.relPath).toBe('AGENTS.md')
    expect(instruction?.canToggle).toBe(false)
    expect(instruction?.canDelete).toBe(false)
    await expect(store.setEnabled(root, 'rule', instruction!.name, false)).rejects.toBeInstanceOf(GitError)
    await expect(store.remove(root, 'rule', instruction!.name)).rejects.toBeInstanceOf(GitError)
  })

  it('edits AGENTS.md by path even when a rule is also named agents', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'AGENTS.md'), 'root agents\n')
    const store = new AgentAssetStore(new WorkspaceFs())
    await store.create(root, 'rule', {
      name: 'agents',
      description: '可开关的同名规则',
      content: '工作台规则正文',
      enabled: true,
    })
    const updated = await store.update(root, 'rule', 'agents', { content: '改过的 AGENTS.md\n' }, 'AGENTS.md')
    expect(updated.origin).toBe('instruction')
    expect(updated.content).toContain('改过的 AGENTS.md')
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('改过的 AGENTS.md')
    expect(await readFile(join(root, '.dsh/rules/agents.md'), 'utf8')).toContain('工作台规则正文')
    await expect(store.setEnabled(root, 'rule', 'agents', false, 'AGENTS.md')).rejects.toBeInstanceOf(GitError)
  })
})

describe('agent-assets locales', () => {
  it('keeps english keys aligned with chinese', () => {
    expect(Object.keys(agentAssetsEn).sort()).toEqual(Object.keys(agentAssetsZh).sort())
  })
})
