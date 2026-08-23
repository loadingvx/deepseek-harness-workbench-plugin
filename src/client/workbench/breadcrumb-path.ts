export interface BreadcrumbPart {
  name: string
  path: string
}

/** Split a workspace-relative path into clickable crumbs. Empty path → no parts. */
export function breadcrumbParts(filePath: string): BreadcrumbPart[] {
  const parts = filePath.split('/').filter(part => part !== '' && part !== '.')
  const crumbs: BreadcrumbPart[] = []
  let acc = ''
  for (const name of parts) {
    acc = acc === '' ? name : `${acc}/${name}`
    crumbs.push({ name, path: acc })
  }
  return crumbs
}
