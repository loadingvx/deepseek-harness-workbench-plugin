/** Files the host may serve under `/git/vendor/`. Names are exact; no directories. */
export const VENDOR_JS_FILES = ['mermaid.js'] as const

export type VendorJsFile = (typeof VENDOR_JS_FILES)[number]

export const VENDOR_ROUTE_PREFIX = '/git/vendor/'

const ALLOWED = new Set<string>(VENDOR_JS_FILES)

/**
 * Map a `/git/vendor/…` pathname to a whitelist file name.
 * Anything with a slash, `..`, or an unknown name is rejected.
 */
export function vendorAssetId(pathname: string): VendorJsFile | undefined {
  if (!pathname.startsWith(VENDOR_ROUTE_PREFIX)) return undefined
  const name = pathname.slice(VENDOR_ROUTE_PREFIX.length)
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return undefined
  if (!ALLOWED.has(name)) return undefined
  return name as VendorJsFile
}
