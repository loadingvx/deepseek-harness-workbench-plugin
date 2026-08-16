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

/**
 * Syntax colors are CSS custom properties defined in EditorPane.module.css on
 * .cmHost. The host signals its scheme with body[data-ds-dark-theme]; light
 * values are the defaults there and dark values override under that attribute,
 * so the palette follows the host theme without reconfiguring the editor.
 */
const highlights = HighlightStyle.define([
  { tag: t.comment, color: 'var(--dsw-wb-syn-comment)', fontStyle: 'italic' },
  { tag: t.lineComment, color: 'var(--dsw-wb-syn-comment)', fontStyle: 'italic' },
  { tag: t.blockComment, color: 'var(--dsw-wb-syn-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--dsw-wb-syn-keyword)' },
  { tag: t.controlKeyword, color: 'var(--dsw-wb-syn-keyword)' },
  { tag: t.moduleKeyword, color: 'var(--dsw-wb-syn-keyword)' },
  { tag: t.definitionKeyword, color: 'var(--dsw-wb-syn-definition-keyword)' },
  { tag: t.operatorKeyword, color: 'var(--dsw-wb-syn-operator-keyword)' },
  { tag: t.operator, color: 'var(--dsw-wb-syn-operator)' },
  { tag: t.string, color: 'var(--dsw-wb-syn-string)' },
  { tag: t.special(t.string), color: 'var(--dsw-wb-syn-string)' },
  { tag: t.number, color: 'var(--dsw-wb-syn-number)' },
  { tag: t.bool, color: 'var(--dsw-wb-syn-constant)' },
  { tag: t.null, color: 'var(--dsw-wb-syn-constant)' },
  { tag: t.variableName, color: 'var(--dsw-wb-syn-variable)' },
  { tag: t.definition(t.variableName), color: 'var(--dsw-wb-syn-variable)' },
  { tag: t.function(t.variableName), color: 'var(--dsw-wb-syn-function)' },
  { tag: t.propertyName, color: 'var(--dsw-wb-syn-property)' },
  { tag: t.definition(t.propertyName), color: 'var(--dsw-wb-syn-property)' },
  { tag: t.typeName, color: 'var(--dsw-wb-syn-type)' },
  { tag: t.className, color: 'var(--dsw-wb-syn-class)' },
  { tag: t.namespace, color: 'var(--dsw-wb-syn-type)' },
  { tag: t.tagName, color: 'var(--dsw-wb-syn-tag)' },
  { tag: t.attributeName, color: 'var(--dsw-wb-syn-attribute)' },
  { tag: t.angleBracket, color: 'var(--dsw-wb-syn-punctuation)' },
  { tag: t.regexp, color: 'var(--dsw-wb-syn-regexp)' },
  { tag: t.meta, color: 'var(--dsw-wb-syn-meta)' },
  { tag: t.heading, color: 'var(--dsw-wb-syn-heading)', fontWeight: '600' },
  { tag: t.link, color: 'var(--dsw-wb-syn-link)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--dsw-wb-syn-invalid)' },
])

export const workbenchEditorTheme: Extension = [
  chrome,
  syntaxHighlighting(highlights, { fallback: true }),
]
