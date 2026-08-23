import { describe, expect, it } from 'vitest'
import { isMarkdownPath, languageIdFromPath } from '../src/client/workbench/code-language.ts'
import { classifyMarkdownHref, classifyMarkdownImageSrc } from '../src/client/workbench/markdown-href.ts'
import { MARKDOWN_FILE_ATTR, renderMarkdownHtml } from '../src/client/workbench/markdown-html.ts'

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
    expect(languageIdFromPath('notes.mdx')).toBe('markdown')
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

describe('isMarkdownPath', () => {
  it('detects markdown extensions only', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.markdown')).toBe(true)
    expect(isMarkdownPath('src/index.ts')).toBe(false)
  })
})

describe('classifyMarkdownHref', () => {
  it('keeps hashes and http(s) links, and opens workspace-relative files', () => {
    expect(classifyMarkdownHref('docs/a.md', '#install')).toEqual({ kind: 'hash', value: '#install' })
    expect(classifyMarkdownHref('docs/a.md', 'https://example.com/x')).toEqual({
      kind: 'url',
      value: 'https://example.com/x',
    })
    expect(classifyMarkdownHref('docs/a.md', './b.md')).toEqual({ kind: 'file', value: 'docs/b.md' })
    expect(classifyMarkdownHref('README.md', 'guide.md')).toEqual({ kind: 'file', value: 'guide.md' })
  })

  it('blocks script and data URLs', () => {
    expect(classifyMarkdownHref('a.md', 'javascript:alert(1)')).toBe(null)
    expect(classifyMarkdownHref('a.md', 'data:text/html,hi')).toBe(null)
    expect(classifyMarkdownHref('a.md', 'file:///etc/passwd')).toBe(null)
  })

  it('redacts secrets in http URLs', () => {
    const href = classifyMarkdownHref('a.md', 'https://example.com/?token=ghp_abcdefghijklmnopqrstuv')
    expect(href?.kind).toBe('url')
    if (href?.kind === 'url') {
      expect(href.value).not.toContain('ghp_abcdefghijklmnopqrstuv')
      expect(href.value).toContain('ghp')
    }
  })
})

describe('classifyMarkdownImageSrc', () => {
  it('keeps http(s) images and resolves workspace-relative paths', () => {
    expect(classifyMarkdownImageSrc('docs/a.md', 'https://example.com/a.png')).toEqual({
      kind: 'url',
      value: 'https://example.com/a.png',
    })
    expect(classifyMarkdownImageSrc('docs/a.md', './img/shot.png')).toEqual({ kind: 'file', value: 'docs/img/shot.png' })
    expect(classifyMarkdownImageSrc('README.md', 'docs/img/shot.png')).toEqual({ kind: 'file', value: 'docs/img/shot.png' })
    expect(classifyMarkdownImageSrc('docs/a.md', '/img/shot.png')).toEqual({ kind: 'file', value: 'img/shot.png' })
  })

  it('resolves .. up to the workspace root', () => {
    expect(classifyMarkdownImageSrc('docs/guide/a.md', '../img/shot.png')).toEqual({ kind: 'file', value: 'docs/img/shot.png' })
    expect(classifyMarkdownImageSrc('docs/a.md', '../../secret.png')).toBe(null)
    expect(classifyMarkdownImageSrc('README.md', '../secret.png')).toBe(null)
  })

  it('blocks script and data sources', () => {
    expect(classifyMarkdownImageSrc('a.md', 'javascript:alert(1)')).toBe(null)
    expect(classifyMarkdownImageSrc('a.md', 'data:image/png;base64,AAAA')).toBe(null)
    expect(classifyMarkdownImageSrc('a.md', 'file:///etc/passwd')).toBe(null)
    expect(classifyMarkdownImageSrc('a.md', '')).toBe(null)
    expect(classifyMarkdownImageSrc('a.md', undefined)).toBe(null)
  })
})

const previewLabels = {
  linkBlocked: 'blocked',
  imageSkip: 'image skipped',
  fileLinkClass: 'file-link',
  imgSkipClass: 'img-skip',
}

describe('renderMarkdownHtml', () => {
  it('renders GFM tables and skips raw HTML', () => {
    const html = renderMarkdownHtml('docs/a.md', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n<script>alert(1)</script>\n', previewLabels)
    expect(html).toContain('<table>')
    expect(html).not.toMatch(/<script/i)
  })

  it('turns workspace-relative links into file buttons and blocks javascript URLs', () => {
    const html = renderMarkdownHtml(
      'docs/a.md',
      '[guide](./b.md) [evil](javascript:alert(1)) [web](https://example.com)',
      previewLabels,
    )
    expect(html).toContain(`${MARKDOWN_FILE_ATTR}="docs/b.md"`)
    expect(html).toContain('class="file-link"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('title="blocked"')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders workspace-relative images through /git/fs/img', () => {
    const html = renderMarkdownHtml('docs/a.md', '![shot](./img/shot.png)', previewLabels, 'ws-1')
    expect(html).toContain('<img src="/git/fs/img?workspaceId=ws-1&amp;path=docs%2Fimg%2Fshot.png" alt="shot">')
  })

  it('renders root-relative and parent-relative images', () => {
    const html = renderMarkdownHtml(
      'docs/guide/a.md',
      '![one](/img/one.png) ![two](../img/two.png)',
      previewLabels,
      'ws-1',
    )
    expect(html).toContain('path=img%2Fone.png')
    expect(html).toContain('path=docs%2Fimg%2Ftwo.png')
  })

  it('renders http(s) images directly', () => {
    const html = renderMarkdownHtml('a.md', '![web](https://example.com/i.png)', previewLabels)
    expect(html).toContain('<img src="https://example.com/i.png" alt="web">')
  })

  it('skips images without a workspace or with blocked sources', () => {
    const noWs = renderMarkdownHtml('a.md', '![shot](./shot.png)', previewLabels)
    expect(noWs).not.toContain('<img')
    expect(noWs).toContain('class="img-skip"')

    const blocked = renderMarkdownHtml('a.md', '![evil](javascript:alert(1))', previewLabels, 'ws-1')
    expect(blocked).not.toContain('<img')
    expect(blocked).toContain('class="img-skip"')
  })
})
