/**
 * Ultra Slash copy. DSH's client locale registry keeps zh and en as two
 * dictionaries; zh is the key-set source of truth, en must cover every key.
 * Menu rows call `t()` at candidate time so a language switch takes effect
 * on the next `/` open. Host command results use {@link translate} with the
 * settings locale when it is available.
 */

import type { CatalogIssue } from './catalog.ts'

/** Dictionary namespace registered with `ctx.locale.register`. */
export const LOCALE_NS = 'ultra-slash'

/** Shipped UI locales. DSH's own fallback is zh. */
export type UiLocale = 'zh' | 'en'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.group': '插件命令',
  'steer.description': '不打断当前对话，把内容注入到模型下一步',
  'steer.hint': '<引导内容>',
  'steer.usage': '用法：/steer <引导内容>',
  'steer.example': '示例：/steer 先不要改代码，只列出将要改的文件',
  'steer.empty': '请写明要告诉模型的内容，然后再发送。\n{usage}\n{example}\n\n这条命令不会停止当前对话：模型正在跑时，内容会在下一次访问大模型时注入；模型空闲时，会立刻开始下一步。',
  'steer.queued.running': '已排队到下一步，当前对话不会被打断、也不需要点停止。\n模型下一次访问大模型时会看到：\n{quoted}',
  'steer.queued.idle': '已提交引导，即将开始下一步。\n模型会看到：\n{quoted}',
  'steer.cancelled': '引导已取消，没有注入给模型。',
  'steer.failed': '引导没有送出：{detail}\n当前对话没有被打断。可以改写内容后重新执行 /steer。',
  'steer.preview': '{preview}…\n（已完整排队，共 {count} 字；上面只是预览）',
  'steer.unknownError': '未知错误',
  'new.description': '开启新会话；后面跟的内容会作为第一句话直接发出',
  'new.hint': '<第一句话，可空>',
  'new.ok': '已切到空白会话。之前正在跑的对话不会被停止，可在左侧列表里点回去。',
  'new.started': '已创建新会话，正在发送你的输入：\n{quoted}',
  'new.unavailable': '现在还不能从这里开新会话。请点左侧栏的「新会话」按钮。',
  'alias.hint': '<补充说明，可空>',
  'skill.description': '完成后把刚才的方案存成当前项目的 skill，不打断对话',
  'skill.payload': '完成任务后将刚才的方案创建保存为当前项目下的skill备用',
  'docs.description': '完成后把问题原因和解决方案写成 md，放到 docs 目录，不打断对话',
  'docs.payload': '完成任务后将问题原因和解决方案输出为md文档写入到docs目录下',
  'catalog.issue.name.empty': '请填写命令名。不用写斜杠，填 review 就会变成 /review。',
  'catalog.issue.name.invalid': '命令名 /{name} 不合规。请用小写英文字母开头，后面只能是字母、数字、连字符或下划线。例如 review、save-note。中文请写在下面的「注入内容」里。',
  'catalog.issue.name.tooLong': '命令名太长（最多 {max} 个字符）。请缩短后再试。',
  'catalog.issue.name.reserved': '/{name} 是内置或系统命令，不能占用。请换一个名字，例如 my-{name}。',
  'catalog.issue.name.taken': '已经有 /{name} 了。请换个名字，或者先删掉原来的再添加。',
  'catalog.issue.description.tooLong': '说明太长（最多 {max} 个字）。请缩短后再试。',
  'catalog.issue.text.empty': '请填写发送后要告诉模型的内容。这条命令不会打断当前对话，效果和 /steer 一样。',
  'catalog.issue.text.tooLong': '注入内容太长（最多 {max} 个字）。请缩短后再试。',
  'catalog.issue.tooMany': '最多 {max} 条自定义命令。请先删掉不用的，再添加新的。',
  'catalog.issue.list.duplicate': '列表里出现了两个 /{name}。每个名字只能有一条。',
  'catalog.issue.occupied': '命令名 /{name} 已经被 DeepSeek Harness 占用，请换一个名字。',
  'catalog.issue.corrupt': '自定义命令配置文件损坏，没有覆盖保存。请检查 {path}，修好或删掉后再试。',
  'catalog.issue.io': '没能读写配置文件：{detail}。请确认 DeepSeek Harness 对 {path} 有写权限。',
  'catalog.issue.network': '没保存成功：连不上 DeepSeek Harness。请确认网页还开着，然后重试。',
  'catalog.issue.unknown': '没保存成功：{detail}',
  'settings.nav': '插件命令',
  'settings.title': '插件命令',
  'settings.intro': '在这里管理斜杠命令。它们会出现在输入框 / 菜单最下面的「插件命令」分组。自定义命令发送后，会把固定内容注入模型下一步，当前对话不会被打断。所有会话共用这份名单，保存在本机。',
  'settings.builtinTitle': '内置命令',
  'settings.builtinHint': '这四条不能改名或删除。/steer 是基础能力；另外三条是快捷写法。',
  'settings.customTitle': '自定义命令',
  'settings.customHint': '给常用的 /steer 内容起一个短名字。例如填 review，之后输入 /review 就等于发送那段固定内容。',
  'settings.empty': '还没有自定义命令。下面填好名字和要注入的内容，点「添加」。',
  'settings.nameLabel': '命令名',
  'settings.nameHint': '不用写斜杠。只能用小写英文字母、数字、连字符、下划线。',
  'settings.namePreview': '发送时输入 {slash}',
  'settings.descriptionLabel': '菜单说明（可选）',
  'settings.descriptionHint': '出现在 / 菜单这一行的右边。不填的话，会用注入内容的前几句。',
  'settings.textLabel': '注入内容',
  'settings.textHint': '发送这条命令后，模型下一步会看到这些文字。不会停止当前对话。',
  'settings.textPlaceholder': '例如：完成当前改动后，只总结测试结果，不要再改代码',
  'settings.add': '添加命令',
  'settings.adding': '正在添加…',
  'settings.save': '保存',
  'settings.saving': '正在保存…',
  'settings.cancel': '取消',
  'settings.edit': '编辑',
  'settings.delete': '删除',
  'settings.deleteConfirm': '确定删除 {slash}？删除后输入这个命令不会再生效。',
  'settings.deleteYes': '确定删除',
  'settings.added': '已添加 {slash}。现在就可以在输入框输入这个命令，当前对话不会被打断。',
  'settings.saved': '已保存 {slash}。',
  'settings.deleted': '已删除 {slash}。',
  'settings.loadFailed': '自定义命令名单加载失败。',
  'settings.retry': '重新加载',
  'settings.loading': '正在加载自定义命令…',
  'settings.maxReached': '已经有 {max} 条自定义命令。先删掉不用的，才能再添加。',
  'settings.rowKindSteer': '基础',
  'settings.rowKindAlias': '快捷',
  'settings.rowKindSession': '会话',
  'settings.rowKindCustom': '自定义',
} satisfies Record<string, string>

/** Dictionary key union. */
export type UltraSlashKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'menu.group': 'Ultra Slash',
  'steer.description': 'Inject guidance into the next model step without interrupting the turn',
  'steer.hint': '<guidance>',
  'steer.usage': 'Usage: /steer <guidance>',
  'steer.example': 'Example: /steer list the files you would change, do not edit yet',
  'steer.empty': 'Write the guidance for the model, then send.\n{usage}\n{example}\n\nThis command does not stop the current turn: while the model is running, the text is injected on the next model access; if it is idle, the next step starts immediately.',
  'steer.queued.running': 'Queued for the next step. The current turn is not interrupted and you do not need to press Stop.\nThe model will see this on the next model access:\n{quoted}',
  'steer.queued.idle': 'Guidance submitted. The next step will start now.\nThe model will see:\n{quoted}',
  'steer.cancelled': 'Guidance cancelled. Nothing was injected.',
  'steer.failed': 'Guidance was not sent: {detail}\nThe current turn was not interrupted. You can edit the text and run /steer again.',
  'steer.preview': '{preview}…\n(Queued in full, {count} characters; preview only above)',
  'steer.unknownError': 'Unknown error',
  'new.description': 'Start a new session; text after the command is sent as the first message',
  'new.hint': '<first message, optional>',
  'new.ok': 'Switched to a blank session. A running turn was not stopped; you can switch back from the sidebar.',
  'new.started': 'Created a new session; sending your input now:\n{quoted}',
  'new.unavailable': 'A new session cannot be started from here. Use the New session button in the sidebar.',
  'alias.hint': '<optional extra>',
  'skill.description': 'After the task, save the solution as a project skill, without interrupting the turn',
  'skill.payload': 'After you finish this task, create and save the solution you just used as a skill in the current project for later reuse',
  'docs.description': 'After the task, write the cause and fix to docs/ as markdown, without interrupting the turn',
  'docs.payload': 'After you finish this task, write the root cause and the solution as a markdown document under the docs directory',
  'catalog.issue.name.empty': 'Enter a command name. Do not type the slash — review becomes /review.',
  'catalog.issue.name.invalid': '/{name} is not a valid command name. Start with a lowercase letter; after that only letters, digits, hyphens, or underscores. Example: review, save-note. Put other languages in the guidance text, not the name.',
  'catalog.issue.name.tooLong': 'The name is too long (max {max} characters). Shorten it and try again.',
  'catalog.issue.name.reserved': '/{name} is a built-in or system command. Pick another name, for example my-{name}.',
  'catalog.issue.name.taken': '/{name} already exists. Choose another name, or delete the existing one first.',
  'catalog.issue.description.tooLong': 'The description is too long (max {max} characters). Shorten it and try again.',
  'catalog.issue.text.empty': 'Write the text the model should see. This command does not interrupt the turn; it works like /steer.',
  'catalog.issue.text.tooLong': 'The guidance is too long (max {max} characters). Shorten it and try again.',
  'catalog.issue.tooMany': 'You can have at most {max} custom commands. Delete one you do not need, then add a new one.',
  'catalog.issue.list.duplicate': 'The list contains two /{name} rows. Each name can appear only once.',
  'catalog.issue.occupied': '/{name} is already used by DeepSeek Harness. Pick another name.',
  'catalog.issue.corrupt': 'The custom-command file is damaged and was not overwritten. Check {path}, fix or delete it, then try again.',
  'catalog.issue.io': 'Could not read or write the config file: {detail}. Make sure DeepSeek Harness can write {path}.',
  'catalog.issue.network': 'Save failed: DeepSeek Harness is not reachable. Keep the web UI open and try again.',
  'catalog.issue.unknown': 'Save failed: {detail}',
  'settings.nav': 'Ultra Slash',
  'settings.title': 'Ultra Slash',
  'settings.intro': 'Manage slash commands here. They appear in the bottom Ultra Slash group of the / menu. A custom command injects fixed text into the next model step and does not interrupt the current turn. The list is stored on this machine and shared by every session.',
  'settings.builtinTitle': 'Built-in commands',
  'settings.builtinHint': 'These four cannot be renamed or deleted. /steer is the primitive; the others are shortcuts.',
  'settings.customTitle': 'Custom commands',
  'settings.customHint': 'Give a short name to a /steer payload you use often. For example, review makes /review send that fixed text.',
  'settings.empty': 'No custom commands yet. Fill in a name and the text to inject, then click Add.',
  'settings.nameLabel': 'Command name',
  'settings.nameHint': 'Do not type the slash. Use lowercase letters, digits, hyphens, and underscores only.',
  'settings.namePreview': 'Type {slash} to send',
  'settings.descriptionLabel': 'Menu description (optional)',
  'settings.descriptionHint': 'Shown on the right of the / menu row. If empty, a preview of the guidance is used.',
  'settings.textLabel': 'Guidance to inject',
  'settings.textHint': 'After you send this command, the model sees this text on the next step. The current turn is not stopped.',
  'settings.textPlaceholder': 'Example: after the current change, only summarize test results; do not edit more code',
  'settings.add': 'Add command',
  'settings.adding': 'Adding…',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.cancel': 'Cancel',
  'settings.edit': 'Edit',
  'settings.delete': 'Delete',
  'settings.deleteConfirm': 'Delete {slash}? Typing this command will no longer do anything.',
  'settings.deleteYes': 'Delete',
  'settings.added': 'Added {slash}. You can type it in the composer now. The current turn is not interrupted.',
  'settings.saved': 'Saved {slash}.',
  'settings.deleted': 'Deleted {slash}.',
  'settings.loadFailed': 'Could not load custom commands.',
  'settings.retry': 'Retry',
  'settings.loading': 'Loading custom commands…',
  'settings.maxReached': 'You already have {max} custom commands. Delete one before adding another.',
  'settings.rowKindSteer': 'Core',
  'settings.rowKindAlias': 'Shortcut',
  'settings.rowKindSession': 'Session',
  'settings.rowKindCustom': 'Custom',
} satisfies Record<UltraSlashKey, string>

export const DICTS: Record<UiLocale, Record<UltraSlashKey, string>> = { zh, en }

/** Fill `{name}` placeholders. Unknown names stay in the template. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match)
}

/** Host-side lookup. Client menus should use `ctx.locale.bind(LOCALE_NS)` instead. */
export function translate(
  locale: UiLocale,
  key: UltraSlashKey,
  vars?: Record<string, string | number>,
): string {
  return interpolate(DICTS[locale][key], vars)
}

/** Settings `locale.preference` when present; otherwise DSH's zh fallback. */
export function resolveHostLocale(get: ((name: string) => unknown) | undefined): UiLocale {
  const settings = get?.('settings') as { get?: (ns: string) => { preference?: string } | undefined } | undefined
  const preference = settings?.get?.('locale')?.preference
  return preference === 'en' ? 'en' : 'zh'
}

export const SLASH_MENU_TITLE_ZH = zh['menu.group']
export const SLASH_MENU_TITLE_EN = en['menu.group']

const ISSUE_KEY: Record<CatalogIssue['code'], UltraSlashKey> = {
  'name.empty': 'catalog.issue.name.empty',
  'name.invalid': 'catalog.issue.name.invalid',
  'name.tooLong': 'catalog.issue.name.tooLong',
  'name.reserved': 'catalog.issue.name.reserved',
  'name.taken': 'catalog.issue.name.taken',
  'description.tooLong': 'catalog.issue.description.tooLong',
  'text.empty': 'catalog.issue.text.empty',
  'text.tooLong': 'catalog.issue.text.tooLong',
  tooMany: 'catalog.issue.tooMany',
  'list.duplicate': 'catalog.issue.list.duplicate',
}

/** User-facing text for a custom-command validation failure. */
export function formatCatalogIssue(locale: UiLocale, issue: CatalogIssue): string {
  const vars: Record<string, string | number> = {}
  if ('name' in issue) vars.name = issue.name
  if ('max' in issue) vars.max = issue.max
  return translate(locale, ISSUE_KEY[issue.code], vars)
}
