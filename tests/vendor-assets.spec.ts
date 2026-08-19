import { describe, expect, it } from 'vitest'
import { mermaidVendorUrl } from '../src/client/workbench/mermaid-loader.ts'
import { vendorAssetId } from '../src/shared/vendor-assets.ts'

describe('vendorAssetId', () => {
  it('accepts the mermaid script and rejects path tricks', () => {
    expect(vendorAssetId('/git/vendor/mermaid.js')).toBe('mermaid.js')
    expect(vendorAssetId('/git/vendor/mermaid.js.map')).toBeUndefined()
    expect(vendorAssetId('/git/vendor/../index.js')).toBeUndefined()
    expect(vendorAssetId('/git/vendor/foo/mermaid.js')).toBeUndefined()
    expect(vendorAssetId('/git/browser/inspect.js')).toBeUndefined()
  })
})

describe('mermaidVendorUrl', () => {
  it('points at the host vendor route with a cache-busting rev', () => {
    const url = mermaidVendorUrl()
    expect(url.startsWith('/git/vendor/mermaid.js?rev=')).toBe(true)
    expect(url).not.toContain('..')
  })
})
