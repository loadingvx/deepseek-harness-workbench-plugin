declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '@xterm/xterm/css/xterm.css' {
  const classes: Record<string, string>
  export default classes
}

interface ImportMeta {
  readonly env?: {
    readonly MODE?: string
    readonly WB_REV?: string
  }
}
