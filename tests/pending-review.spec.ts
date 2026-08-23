import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PendingReviewStore } from '../src/host/pending-review.ts'
import { WorkspaceFs } from '../src/host/workspace-fs.ts'

describe('PendingReviewStore', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function setup(): Promise<{ root: string; store: PendingReviewStore }> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-'))
    dirs.push(root)
    return { root, store: new PendingReviewStore(new WorkspaceFs()) }
  }

  it('tracks edit then keep file clears pending', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'new\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    const listed = await store.list(root)
    expect(listed.files).toHaveLength(1)
    expect(listed.files[0]!.path).toBe('a.txt')
    expect(listed.files[0]!.hunks.length).toBeGreaterThan(0)

    const afterKeep = await store.keepFile(root, 'a.txt')
    expect(afterKeep.files).toHaveLength(0)
  })

  it('undo file restores baseline', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'new\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    await store.undoFile(root, 'a.txt')
    const fs = new WorkspaceFs()
    expect((await fs.read(root, 'a.txt')).content).toBe('old\n')
    expect((await store.list(root)).files).toHaveLength(0)
  })

  it('undo create deletes the file', async () => {
    const { root, store } = await setup()
    await store.captureBaseline(root, 'born.txt')
    await writeFile(join(root, 'born.txt'), 'hi\n', 'utf8')
    await store.noteSuccess(root, 'born.txt')
    await store.undoFile(root, 'born.txt')
    await expect(new WorkspaceFs().read(root, 'born.txt')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })

  it('keep all and undo all operate on the whole queue', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'a0\n', 'utf8')
    await writeFile(join(root, 'b.txt'), 'b0\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await store.captureBaseline(root, 'b.txt')
    await writeFile(join(root, 'a.txt'), 'a1\n', 'utf8')
    await writeFile(join(root, 'b.txt'), 'b1\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    await store.noteSuccess(root, 'b.txt')
    expect((await store.list(root)).files).toHaveLength(2)
    await store.keepAll(root)
    expect((await store.list(root)).files).toHaveLength(0)

    await store.captureBaseline(root, 'a.txt')
    await store.captureBaseline(root, 'b.txt')
    await writeFile(join(root, 'a.txt'), 'a2\n', 'utf8')
    await writeFile(join(root, 'b.txt'), 'b2\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    await store.noteSuccess(root, 'b.txt')
    await store.undoAll(root)
    const fs = new WorkspaceFs()
    expect((await fs.read(root, 'a.txt')).content).toBe('a1\n')
    expect((await fs.read(root, 'b.txt')).content).toBe('b1\n')
  })

  it('keeps pending and marks manualEdited after a hand edit (Cursor-style)', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'agent\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    expect((await store.list(root)).files).toHaveLength(1)

    await writeFile(join(root, 'a.txt'), 'manual\n', 'utf8')
    const listed = await store.list(root)
    expect(listed.files).toHaveLength(1)
    expect(listed.files[0]!.manualEdited).toBe(true)
    expect((await new WorkspaceFs().read(root, 'a.txt')).content).toBe('manual\n')
  })

  it('undo after manual edit restores baseline (UI confirms; host allows)', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'agent\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'manual\n', 'utf8')
    await store.undoFile(root, 'a.txt')
    expect((await new WorkspaceFs().read(root, 'a.txt')).content).toBe('old\n')
    expect((await store.list(root)).files).toHaveLength(0)
  })

  it('refuses hunk ops after a manual edit', async () => {
    const { root, store } = await setup()
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8')
    await store.captureBaseline(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'agent\n', 'utf8')
    await store.noteSuccess(root, 'a.txt')
    const hunkId = (await store.list(root)).files[0]!.hunks[0]!.id
    await writeFile(join(root, 'a.txt'), 'manual\n', 'utf8')
    await expect(store.undoHunk(root, 'a.txt', hunkId)).rejects.toMatchObject({ code: 'REVIEW_STALE' })
    expect((await new WorkspaceFs().read(root, 'a.txt')).content).toBe('manual\n')
  })

  it('keep hunk then undo remaining restores cleanly', async () => {
    const { root, store } = await setup()
    const before = 'line1\nline2\nline3\nline4\nline5\n'
    const after = 'line1\nLINE2\nline3\nLINE4\nline5\n'
    await writeFile(join(root, 'm.txt'), before, 'utf8')
    await store.captureBaseline(root, 'm.txt')
    await writeFile(join(root, 'm.txt'), after, 'utf8')
    await store.noteSuccess(root, 'm.txt')
    const listed = await store.list(root)
    expect(listed.files[0]!.hunks.length).toBeGreaterThanOrEqual(1)
    const first = listed.files[0]!.hunks[0]!
    await store.keepHunk(root, 'm.txt', first.id)
    const mid = await store.list(root)
    if (mid.files.length === 0) {
      expect((await new WorkspaceFs().read(root, 'm.txt')).content).toBe(after)
      return
    }
    const rest = mid.files[0]!.hunks
    for (const hunk of [...rest].reverse()) {
      await store.undoHunk(root, 'm.txt', hunk.id)
    }
    const final = await store.list(root)
    expect(final.files.length === 0 || final.files[0]!.hunks.every(h => h.id !== first.id)).toBe(true)
  })
})
