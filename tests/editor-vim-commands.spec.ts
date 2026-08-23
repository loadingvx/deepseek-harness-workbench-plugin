// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Vim } from '@replit/codemirror-vim'
import type { EditorView } from '@codemirror/view'
import {
  ensureVimExCommands,
  installEditorVimOps,
  uninstallEditorVimOps,
} from '../src/client/workbench/editor-vim-commands.ts'
import type { EditorVimOps } from '../src/client/workbench/types.ts'

/**
 * The vim engine drives a CM5-style adapter; only the fields the ex-command
 * dispatcher touches are needed to route a command to our per-view ops.
 */
function makeCm(view: EditorView): unknown {
  return {
    cm6: view,
    operation: (fn: () => void): void => { fn() },
    curOp: undefined,
    state: { vim: { visualMode: false } },
    getCursor: (): { line: number; ch: number } => ({ line: 0, ch: 0 }),
  }
}

function makeOps(): EditorVimOps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    save: vi.fn(() => true),
    close: vi.fn(),
    closeAll: vi.fn(),
    writeQuit: vi.fn(),
    vsplit: vi.fn(),
    hsplit: vi.fn(),
    only: vi.fn(),
  }
}

describe('vim window ex commands', () => {
  it('registers :w / :q / :qa / :x / :wq / :vs / :sp / :only', () => {
    ensureVimExCommands()
    const ops = makeOps()
    const view = {} as EditorView
    installEditorVimOps(view, ops)
    const cm = makeCm(view) as Parameters<typeof Vim.handleEx>[0]

    Vim.handleEx(cm, 'w')
    expect(ops.save).toHaveBeenCalledTimes(1)

    Vim.handleEx(cm, 'q')
    expect(ops.close).toHaveBeenCalledWith(false)

    Vim.handleEx(cm, 'q!')
    expect(ops.close).toHaveBeenCalledWith(true)

    Vim.handleEx(cm, 'qa')
    expect(ops.closeAll).toHaveBeenCalledWith(false)

    Vim.handleEx(cm, 'x')
    expect(ops.writeQuit).toHaveBeenCalledWith(false)

    Vim.handleEx(cm, 'wq')
    expect(ops.writeQuit).toHaveBeenCalledTimes(2)

    Vim.handleEx(cm, 'vs')
    expect(ops.vsplit).toHaveBeenCalledTimes(1)

    Vim.handleEx(cm, 'sp')
    expect(ops.hsplit).toHaveBeenCalledTimes(1)

    Vim.handleEx(cm, 'only')
    expect(ops.only).toHaveBeenCalledTimes(1)

    uninstallEditorVimOps(view)
  })

  it('routes commands to the ops of the view that dispatched them', () => {
    ensureVimExCommands()
    const opsA = makeOps()
    const opsB = makeOps()
    const viewA = {} as EditorView
    const viewB = {} as EditorView
    installEditorVimOps(viewA, opsA)
    installEditorVimOps(viewB, opsB)

    Vim.handleEx(makeCm(viewB) as Parameters<typeof Vim.handleEx>[0], 'w')
    expect(opsA.save).not.toHaveBeenCalled()
    expect(opsB.save).toHaveBeenCalledTimes(1)

    uninstallEditorVimOps(viewA)
    uninstallEditorVimOps(viewB)
  })

  it('no-ops safely when no ops are installed for the view', () => {
    ensureVimExCommands()
    const view = {} as EditorView
    expect(() => {
      Vim.handleEx(makeCm(view) as Parameters<typeof Vim.handleEx>[0], 'w')
      Vim.handleEx(makeCm(view) as Parameters<typeof Vim.handleEx>[0], 'vs')
    }).not.toThrow()
  })
})
