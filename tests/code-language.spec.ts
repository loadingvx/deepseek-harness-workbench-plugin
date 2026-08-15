import { describe, expect, it } from 'vitest'
import { languageIdFromPath } from '../src/client/workbench/code-language.ts'

describe('languageIdFromPath', () => {
  it('maps TypeScript and JavaScript families', () => {
    expect(languageIdFromPath('src/index.ts')).toBe('typescript')
    expect(languageIdFromPath('src/app.tsx')).toBe('tsx')
    expect(languageIdFromPath('src/widget.jsx')).toBe('jsx')
    expect(languageIdFromPath('lib/client.js')).toBe('javascript')
    expect(languageIdFromPath('a.mts')).toBe('typescript')
  })

  it('maps web and config files', () => {
    expect(languageIdFromPath('README.md')).toBe('markdown')
    expect(languageIdFromPath('package.json')).toBe('json')
    expect(languageIdFromPath('styles.css')).toBe('css')
    expect(languageIdFromPath('index.html')).toBe('html')
    expect(languageIdFromPath('cordis.patch.yml')).toBe('yaml')
    expect(languageIdFromPath('icon.svg')).toBe('xml')
    expect(languageIdFromPath('tools/run.py')).toBe('python')
  })

  it('falls back to plain text', () => {
    expect(languageIdFromPath('LICENSE')).toBe('plain')
    expect(languageIdFromPath('notes.txt')).toBe('plain')
    expect(languageIdFromPath('.gitignore')).toBe('plain')
  })
})
