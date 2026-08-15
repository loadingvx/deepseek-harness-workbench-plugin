import { describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { redactSecrets } from '../src/shared/redact.ts'

describe('redactSecrets', () => {
  it('keeps the URL but masks the password in userinfo', () => {
    expect(redactSecrets('fatal: unable to access https://octocat:ghp_abcdefghijklmnopqrstuv@github.com/acme/app.git'))
      .toBe('fatal: unable to access https://octocat:ghp***uv@github.com/acme/app.git')
  })

  it('masks a token used as the URL username', () => {
    const out = redactSecrets('https://ghp_abcdefghijklmnopqrstuvwxyz12@github.com/acme/app.git')
    expect(out).toContain('https://')
    expect(out).toContain('@github.com/acme/app.git')
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz12')
  })

  it('masks query tokens and leaves the rest of the URL', () => {
    expect(redactSecrets('https://example.com/hook?token=supersecrettoken&ref=main'))
      .toBe('https://example.com/hook?token=sup***en&ref=main')
  })

  it('masks Bearer and known token prefixes', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: Bearer abc***op')
    expect(redactSecrets('npm_abcdefghijklmnopqrstuvwxyz')).toMatch(/^npm_/)
    expect(redactSecrets('npm_abcdefghijklmnopqrstuvwxyz')).not.toBe('npm_abcdefghijklmnopqrstuvwxyz')
  })

  it('leaves ordinary git URLs and commit hashes alone', () => {
    expect(redactSecrets('git@github.com:acme/app.git')).toBe('git@github.com:acme/app.git')
    expect(redactSecrets('https://github.com/acme/app.git')).toBe('https://github.com/acme/app.git')
    expect(redactSecrets('commit 49a21b8addzhcnandenusreadmefile')).toBe('commit 49a21b8addzhcnandenusreadmefile')
  })

  it('is safe to run twice', () => {
    const once = redactSecrets('https://user:password1234@host/repo')
    expect(redactSecrets(once)).toBe(once)
  })

  it('redacts secrets inside GitError copy shown to the user', () => {
    const error = new GitError('GIT_FAILED', 'unable to access https://octocat:ghp_abcdefghijklmnopqrstuv@github.com/acme/app.git')
    expect(error.messageZh).toContain('https://octocat:ghp***uv@github.com/acme/app.git')
    expect(error.messageZh).not.toContain('ghp_abcdefghijklmnopqrstuv')
  })
})
