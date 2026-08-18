export type FileManagerKind = 'finder' | 'explorer' | 'files'

/** Pick Finder / Explorer / generic file manager copy from UA + platform. */
export function fileManagerKind(userAgent = '', platform = ''): FileManagerKind {
  const hay = `${platform} ${userAgent}`.toLowerCase()
  if (hay.includes('mac') || hay.includes('darwin')) return 'finder'
  if (hay.includes('win')) return 'explorer'
  return 'files'
}

export function fileManagerLocaleKey(kind: FileManagerKind): `tree.reveal.${FileManagerKind}` {
  return `tree.reveal.${kind}`
}
