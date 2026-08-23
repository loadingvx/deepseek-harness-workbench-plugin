/** XPath / CSS / JSPath for a DOM element. Used by tests and documented for the inspect script. */

function tagOf(el: Element): string {
  return el.tagName.toLowerCase()
}

function indexAmongType(el: Element): number {
  const tag = el.tagName
  const parent = el.parentElement
  if (parent === null) return 1
  let index = 0
  for (const child of Array.from(parent.children)) {
    if (child.tagName !== tag) continue
    index += 1
    if (child === el) return index
  }
  return 1
}

/** Absolute XPath with positional predicates, e.g. `/html[1]/body[1]/div[2]`. */
export function elementXPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node !== null && node.nodeType === 1) {
    const tag = tagOf(node)
    if (tag === 'html') {
      parts.unshift('/html[1]')
      break
    }
    parts.unshift(`/${tag}[${indexAmongType(node)}]`)
    node = node.parentElement
  }
  return parts.join('')
}

function escapeCssIdent(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1')
}

function uniqueSelector(el: Element, doc: ParentNode): string | null {
  if (el.id !== '' && /^[A-Za-z][\w-]*$/.test(el.id)) {
    const sel = `#${el.id}`
    if (doc.querySelectorAll(sel).length === 1) return sel
  }
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test')
  if (testId !== null && testId !== '') {
    const sel = `[data-testid="${testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel
    } catch { /* invalid selector */ }
  }
  return null
}

/** Unique-enough CSS path using id, then nth-of-type from body. */
export function elementCssPath(el: Element): string {
  const doc = el.ownerDocument ?? el
  const unique = uniqueSelector(el, doc)
  if (unique !== null) return unique
  const parts: string[] = []
  let node: Element | null = el
  while (node !== null && node.nodeType === 1 && tagOf(node) !== 'html') {
    const tag = tagOf(node)
    if (tag === 'body') {
      parts.unshift('body')
      break
    }
    const idSel = uniqueSelector(node, doc)
    if (idSel !== null) {
      parts.unshift(idSel)
      break
    }
    const parent = node.parentElement
    const tagName = node.tagName
    const nth = indexAmongType(node)
    const klass = typeof node.className === 'string'
      ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(escapeCssIdent).join('.')
      : ''
    const piece = klass !== '' ? `${tag}.${klass}` : tag
    const sameType = parent === null
      ? 1
      : Array.from(parent.children).filter(child => child.tagName === tagName).length
    parts.unshift(nth > 1 || sameType !== 1
      ? `${piece}:nth-of-type(${nth})`
      : piece)
    node = node.parentElement
  }
  return parts.join(' > ')
}

/** Chrome-style JSPath: `document.querySelector("…")`. */
export function elementJsPath(el: Element): string {
  const css = elementCssPath(el)
  const escaped = css.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `document.querySelector("${escaped}")`
}
