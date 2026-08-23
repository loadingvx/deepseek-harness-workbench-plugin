/** Subset of mermaid used by the markdown preview. Kept local so `client.js` never imports the package. */
export interface MermaidApi {
  initialize: (config: {
    startOnLoad: boolean
    securityLevel: string
    theme: string
    fontFamily: string
  }) => void
  render: (id: string, source: string) => Promise<{
    svg: string
    bindFunctions?: (el: Element) => void
  }>
}
