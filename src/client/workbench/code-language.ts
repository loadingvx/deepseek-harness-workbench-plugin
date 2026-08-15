import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'

export type EditorLanguage =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'xml'
  | 'yaml'
  | 'plain'

const EXT_TO_LANG: Record<string, EditorLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyi: 'python',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
}

/** Pick a highlighter from the file name. Unknown types stay plain text. */
export function languageIdFromPath(path: string): EditorLanguage {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return 'plain'
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'plain'
}

export function languageExtension(id: EditorLanguage): Extension {
  switch (id) {
    case 'javascript': return javascript()
    case 'typescript': return javascript({ typescript: true })
    case 'jsx': return javascript({ jsx: true })
    case 'tsx': return javascript({ jsx: true, typescript: true })
    case 'json': return json()
    case 'html': return html()
    case 'css': return css()
    case 'markdown': return markdown()
    case 'python': return python()
    case 'xml': return xml()
    case 'yaml': return yaml()
    case 'plain': return []
  }
}
