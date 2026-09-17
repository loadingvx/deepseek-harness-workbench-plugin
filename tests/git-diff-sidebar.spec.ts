// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  gitCommitDiffAddressOf,
  gitDiffAddressOf,
  parseGitDiffAddress,
} from '../src/client/workbench/sidebar-right/diff/address.ts'
import {
  rememberSplitColumns,
  resetDiffColumnMemory,
  splitGitToRight,
} from '../src/client/workbench/sidebar-right/diff/dock-panes.ts'
import {
  bindSidebarDiffFace,
  openGitDiffInSidebar,
} from '../src/client/workbench/sidebar-right/diff/open-git-diff.ts'

beforeEach(() => {
  resetDiffColumnMemory()
})

describe('git diff sidebar addresses', () => {
  it('round-trips unstaged and staged paths with repo', () => {
    const unstaged = gitDiffAddressOf({
      workspaceId: 'ws-1',
      path: 'src/a b/文件.ts',
      staged: false,
      repo: 'repo-a',
    })
    expect(parseGitDiffAddress(unstaged)).toEqual({
      workspaceId: 'ws-1',
      path: 'src/a b/文件.ts',
      staged: false,
      repo: 'repo-a',
    })

    const staged = gitDiffAddressOf({
      workspaceId: 'ws-1',
      path: 'README.md',
      staged: true,
    })
    expect(parseGitDiffAddress(staged)).toEqual({
      workspaceId: 'ws-1',
      path: 'README.md',
      staged: true,
      repo: undefined,
    })
  })

  it('round-trips commit diffs', () => {
    const address = gitCommitDiffAddressOf({
      workspaceId: 'ws-2',
      path: 'lib/index.ts',
      hash: 'abc123',
      repo: 'nearby',
    })
    expect(parseGitDiffAddress(address)).toEqual({
      workspaceId: 'ws-2',
      path: 'lib/index.ts',
      staged: false,
      hash: 'abc123',
      repo: 'nearby',
    })
  })

  it('omits nearby-repo id "." so picomatch can claim the address', () => {
    const address = gitDiffAddressOf({
      workspaceId: 'ws-1',
      path: 'src/client/workbench/GitSidebar.tsx',
      staged: false,
      repo: '.',
    })
    expect(address).toBe(
      'dsh-resource://git-diff/w/ws-1/f/src/client/workbench/GitSidebar.tsx/unstaged',
    )
    expect(address.endsWith('/r/.')).toBe(false)
    expect(parseGitDiffAddress(address)).toEqual({
      workspaceId: 'ws-1',
      path: 'src/client/workbench/GitSidebar.tsx',
      staged: false,
      repo: undefined,
    })
  })
})

describe('splitGitToRight', () => {
  it('records left/right only when split returns a pane', () => {
    const split = vi.fn(() => 'pane-right')
    expect(splitGitToRight({ split, openTab: vi.fn() }, 'pane-git')).toBe('pane-right')
    expect(split).toHaveBeenCalledWith('pane-git')
  })

  it('does nothing when harness refuses to split', () => {
    const split = vi.fn(() => undefined)
    expect(splitGitToRight({ split, openTab: vi.fn() }, 'pane-git')).toBeUndefined()
  })
})

describe('openGitDiffInSidebar', () => {
  it('opens via sidebar.openResource with kind even when split is refused', () => {
    const openResource = vi.fn()
    const closeGit = vi.fn()
    const release = bindSidebarDiffFace({
      split: vi.fn(() => undefined),
      openTab: vi.fn(),
      openResource,
    })
    openGitDiffInSidebar({
      workspaceId: 'ws-1',
      path: 'src/a.ts',
      staged: false,
      repo: '.',
      gitPaneId: 'pane-git',
      closeGit,
    })
    // No paneId when split failed — avoids stale/missing layout nodes.
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://git-diff/w/ws-1/f/src/a.ts/unstaged',
      { kind: 'git-diff', revealIfOpened: true },
    )
    expect(closeGit).not.toHaveBeenCalled()
    release()
  })

  it('opens diff before moving git right after a successful split', () => {
    const calls: string[] = []
    const openResource = vi.fn(() => { calls.push('openResource') })
    const closeGit = vi.fn(() => { calls.push('close') })
    const openTab = vi.fn(() => { calls.push('openTab') })
    const split = vi.fn(() => 'pane-right')
    const release = bindSidebarDiffFace({ split, openTab, openResource })
    openGitDiffInSidebar({
      workspaceId: 'ws-1',
      path: 'src/a.ts',
      staged: false,
      gitPaneId: 'pane-git',
      closeGit,
    })
    expect(calls).toEqual(['openResource', 'openTab', 'close'])
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://git-diff/w/ws-1/f/src/a.ts/unstaged',
      { kind: 'git-diff', paneId: 'pane-git', revealIfOpened: true },
    )
    expect(openTab).toHaveBeenCalledWith('git', { paneId: 'pane-right' })
    release()
  })

  it('opens later diffs into the remembered left pane when both panes are live', () => {
    document.body.innerHTML = `
      <div data-dockkit-surface>
        <div data-dockkit-pane="pane-diff"></div>
        <div data-dockkit-pane="pane-git"></div>
      </div>
    `
    rememberSplitColumns('pane-diff', 'pane-git')
    const openResource = vi.fn()
    const closeGit = vi.fn()
    const split = vi.fn()
    const release = bindSidebarDiffFace({ split, openTab: vi.fn(), openResource })
    openGitDiffInSidebar({
      workspaceId: 'ws-1',
      path: 'src/b.ts',
      staged: false,
      gitPaneId: 'pane-git',
      closeGit,
    })
    expect(split).not.toHaveBeenCalled()
    expect(closeGit).not.toHaveBeenCalled()
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://git-diff/w/ws-1/f/src/b.ts/unstaged',
      { kind: 'git-diff', paneId: 'pane-diff', revealIfOpened: true },
    )
    release()
  })

  it('ignores stale remembered pane ids and opens without paneId', () => {
    rememberSplitColumns('pane1', 'pane-gone')
    const openResource = vi.fn()
    const release = bindSidebarDiffFace({
      split: vi.fn(() => undefined),
      openTab: vi.fn(),
      openResource,
    })
    openGitDiffInSidebar({
      workspaceId: 'ws-1',
      path: 'src/c.ts',
      staged: false,
      gitPaneId: 'pane-gone',
      closeGit: vi.fn(),
    })
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://git-diff/w/ws-1/f/src/c.ts/unstaged',
      { kind: 'git-diff', revealIfOpened: true },
    )
    release()
  })

  it('retries without paneId when harness rejects an unknown node', () => {
    document.body.innerHTML = `
      <div data-dockkit-surface>
        <div data-dockkit-pane="pane-diff"></div>
        <div data-dockkit-pane="pane-git"></div>
      </div>
    `
    rememberSplitColumns('pane-diff', 'pane-git')
    const openResource = vi.fn((..._args: unknown[]) => {
      if (openResource.mock.calls.length === 1) {
        throw new Error('layout: unknown node pane-diff')
      }
    })
    const release = bindSidebarDiffFace({
      split: vi.fn(),
      openTab: vi.fn(),
      openResource,
    })
    openGitDiffInSidebar({
      workspaceId: 'ws-1',
      path: 'src/d.ts',
      staged: false,
      gitPaneId: 'pane-git',
      closeGit: vi.fn(),
    })
    expect(openResource).toHaveBeenCalledTimes(2)
    expect(openResource.mock.calls[1]?.[1]).toEqual({ kind: 'git-diff', revealIfOpened: true })
    release()
  })
})
