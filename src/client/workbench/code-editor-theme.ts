import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const chrome = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    lineHeight: '22px',
  },
  '.cm-content': {
    caretColor: 'var(--dsw-alias-label-primary)',
    padding: '8px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-caption)',
    border: 'none',
    borderRight: '1px solid var(--dsw-alias-border-l2)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3.2em',
    padding: '0 8px 0 10px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 28%, transparent) !important',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary)',
  },
})

/** Syntax colors that stay readable on both host light and dark backgrounds. */
const highlights = HighlightStyle.define([
  { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: t.keyword, color: '#c586c0' },
  { tag: t.controlKeyword, color: '#c586c0' },
  { tag: t.moduleKeyword, color: '#c586c0' },
  { tag: t.definitionKeyword, color: '#569cd6' },
  { tag: t.operatorKeyword, color: '#d4d4d4' },
  { tag: t.operator, color: '#d4d4d4' },
  { tag: t.string, color: '#ce9178' },
  { tag: t.special(t.string), color: '#ce9178' },
  { tag: t.number, color: '#b5cea8' },
  { tag: t.bool, color: '#569cd6' },
  { tag: t.null, color: '#569cd6' },
  { tag: t.variableName, color: '#9cdcfe' },
  { tag: t.definition(t.variableName), color: '#9cdcfe' },
  { tag: t.function(t.variableName), color: '#dcdcaa' },
  { tag: t.propertyName, color: '#9cdcfe' },
  { tag: t.definition(t.propertyName), color: '#9cdcfe' },
  { tag: t.typeName, color: '#4ec9b0' },
  { tag: t.className, color: '#4ec9b0' },
  { tag: t.namespace, color: '#4ec9b0' },
  { tag: t.tagName, color: '#569cd6' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: t.angleBracket, color: '#808080' },
  { tag: t.regexp, color: '#d16969' },
  { tag: t.meta, color: '#9b9b9b' },
  { tag: t.heading, color: '#569cd6', fontWeight: '600' },
  { tag: t.link, color: '#3794ff', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: '#f44747' },
])

export const workbenchEditorTheme: Extension = [
  chrome,
  syntaxHighlighting(highlights, { fallback: true }),
]
