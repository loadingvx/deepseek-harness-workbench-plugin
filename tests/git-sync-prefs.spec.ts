import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_SYNC_PREFS,
  parseGitSyncPrefs,
  parsePullMode,
  pullArgs,
  pullCommandPreview,
  pushArgs,
  pushCommandPreview,
} from '../src/shared/git-sync-prefs.ts'

describe('git-sync-prefs', () => {
  it('defaults pull to merge and push to safe', () => {
    expect(DEFAULT_GIT_SYNC_PREFS).toEqual({ pullMode: 'merge', pushMode: 'safe' })
    expect(parseGitSyncPrefs(null)).toEqual(DEFAULT_GIT_SYNC_PREFS)
    expect(parseGitSyncPrefs({ pullMode: 'nope', pushMode: '--force' })).toEqual(DEFAULT_GIT_SYNC_PREFS)
  })

  it('accepts only the enumerated modes', () => {
    expect(parsePullMode('ff-only')).toBe('ff-only')
    expect(parsePullMode('rebase')).toBe('rebase')
    expect(parsePullMode('merge')).toBe('merge')
    expect(parsePullMode('--rebase --autostash')).toBe('merge')
  })

  it('builds fixed argv and command previews', () => {
    expect(pullArgs('merge')).toEqual(['pull', '--no-rebase', '--no-edit'])
    expect(pullArgs('ff-only')).toEqual(['pull', '--ff-only'])
    expect(pullCommandPreview('merge')).toBe('git pull --no-rebase --no-edit')
    expect(pushArgs('safe', 'origin', false)).toEqual(['push'])
    expect(pushArgs('safe', 'origin', true)).toEqual(['push', '-u', 'origin', 'HEAD'])
    expect(pushArgs('lease', 'origin', false)).toEqual(['push', '--force-with-lease'])
    expect(pushCommandPreview('safe')).toBe('git push')
  })
})
