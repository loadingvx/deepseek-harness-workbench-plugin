import type { ReactNode } from 'react'

export function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {children}
    </svg>
  )
}

export function IconLayout() {
  return (
    <Icon>
      <path d="M1.5 2.5h13v11h-13zM6 3.5v9M10.5 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconChat() {
  return (
    <Icon>
      <path d="M2 3.2h12v7.3H8.2L5.4 13V10.5H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconEditor() {
  return (
    <Icon>
      <path d="M3 2.5h7l3 3V13.5H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 2.5V6h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconFiles() {
  return (
    <Icon>
      <path d="M2.5 3.5h4l1.2 1.5H13.5v7.5H2.5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconGit() {
  return (
    <Icon>
      <path d="M15.7 7.3 8.7.3a1 1 0 0 0-1.4 0L5.6 2 7.4 3.8a1.3 1.3 0 0 1 1.6 1.6l1.7 1.7a1.3 1.3 0 1 1-.7.7L8.4 6.2v4.1a1.3 1.3 0 1 1-1 0V6a1.3 1.3 0 0 1-.7-1.7L5 2.7.3 7.3a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4Z" />
    </Icon>
  )
}

export function IconUsage() {
  return (
    <Icon>
      <path d="M2.2 4.4h11.6v7.2H2.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.65" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.1 6.2v3.6M11.9 6.2v3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconSlash() {
  return (
    <Icon>
      <path d="M2.4 3.2h11.2v9.6H2.4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.6 4.8 6.4 11.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconRestore() {
  return (
    <Icon>
      <path d="M4.2 8A3.8 3.8 0 1 0 8 4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.6 4.2h3.2v3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconRefresh() {
  return (
    <Icon>
      <path d="M13.2 8A5.2 5.2 0 1 1 11 3.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 1.6v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconPin() {
  return (
    <Icon>
      <path d="M6.2 2.4h3.6L11.4 6.2 13.2 7.4 8.8 11.2 8 14.4 7.2 11.2 2.8 7.4 4.6 6.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconEye() {
  return (
    <Icon>
      <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4-6.4-4-6.4-4Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.7" />
    </Icon>
  )
}

export function IconPlus() {
  return (
    <Icon>
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconMinus() {
  return (
    <Icon>
      <path d="M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconPush() {
  return (
    <Icon>
      <path d="M8 12.5V3.8M4.6 6.6 8 3.2 11.4 6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconPull() {
  return (
    <Icon>
      <path d="M8 3.5v8.7M4.6 9.4 8 12.8 11.4 9.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconCheck() {
  return (
    <Icon>
      <path d="M3.2 8.2 6.4 11.4 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  )
}

export function IconSave() {
  return (
    <Icon>
      <path d="M3 2.5h8.2L13 4.3V13.5H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 2.5v3.4h5.2V2.5M5 13.5v-4h6v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconClose() {
  return (
    <Icon size={12}>
      <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  )
}

export function IconDiff() {
  return (
    <Icon>
      <path d="M3 3h4v4H3zM9 9h4v4H9z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 3.5v3M8 9.5v3M5.5 8h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconSplit() {
  return (
    <Icon>
      <path d="M2 3h5.2v10H2zM8.8 3H14v10H8.8z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconPanelOff() {
  return (
    <Icon>
      <path d="M2 3h12v10H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3v10" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconTune() {
  return (
    <Icon>
      <path d="M2.5 4.5h4.2M9.4 4.5h4.1M2.5 11.5h7.2M12.4 11.5h1.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8.2" cy="4.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.2" cy="11.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconSend() {
  return (
    <Icon>
      <path d="M3 8h9.2M8.4 4.6 12.4 8 8.4 11.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconStop() {
  return (
    <Icon>
      <path d="M4.2 4.2h7.6v7.6H4.2z" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconSparkle({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M8 1.6 9.1 6 13.6 7.2 9.1 8.4 8 12.8 6.9 8.4 2.4 7.2 6.9 6z" />
      <path d="M12.2 10.2 12.7 12 14.6 12.5 12.7 13 12.2 14.8 11.7 13 9.8 12.5 11.7 12z" />
    </Icon>
  )
}

export function IconChevron({ open }: { open: boolean }) {
  return (
    <Icon size={12}>
      <path
        d={open ? 'M3 5.5 6 8.5 9 5.5' : 'M5 3.5 8 6.5 5 9.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </Icon>
  )
}

export function IconBranch() {
  return (
    <Icon>
      <circle cx="4.2" cy="4" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.2" cy="12" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.8" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.2 5.6v4.8M5.6 4.6c3.2 0 4.6 1.6 4.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconTerminal() {
  return (
    <Icon>
      <path d="M2.2 3.2h11.6v9.6H2.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.2 6.2 6.4 8 4.2 9.8M7.6 10.4h4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconSearch() {
  return (
    <Icon>
      <circle cx="6.6" cy="6.6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.3 9.3 13.2 13.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconExternal() {
  return (
    <Icon>
      <path d="M3.2 4.2h6V5.6H4.6v5.8H10.4V10h1.4v3H3.2z" />
      <path d="M8.4 3h4.6v4.6M12.6 3.4 7.6 8.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconMore() {
  return (
    <Icon>
      <circle cx="2.6" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="13.4" cy="8" r="1.35" />
    </Icon>
  )
}

/** Compact graph: commit dots + short subject lines, no meta. */
export function IconCompact() {
  return (
    <Icon>
      <path d="M4 3.2v9.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="4" r="1.3" />
      <circle cx="4" cy="8" r="1.3" />
      <circle cx="4" cy="12" r="1.3" />
      <path d="M7 4h6M7 8h6M7 12h6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconFetch() {
  return (
    <Icon>
      <path d="M8 2.5v7.2M5 7.2 8 10.4 11 7.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 12.6h10" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  )
}

export function IconNewBranch() {
  return (
    <Icon>
      <circle cx="4" cy="4" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.5v5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 3.2v5.2M7.6 5.8h4.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconMerge() {
  return (
    <Icon>
      <circle cx="4.2" cy="3.6" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.2" cy="12.4" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.2 5.1v5.8M5.6 4.2c3.6 0 5.2 2 5.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8.6 10.6 11.6 8.2 8.6 5.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconGithub({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </Icon>
  )
}

export function IconFeedback({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.2 3h11.6v7.2H8L5.2 13V10.2H2.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconRename() {
  return (
    <Icon>
      <path d="M11.9 2.3 13.7 4.1 6 11.8 3.4 12.6 4.2 10z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.6 3.6 12.4 5.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconTrash() {
  return (
    <Icon>
      <path d="M3 4.2h10M6.4 4.2V2.9h3.2v1.3M5.1 4.2l.6 8.8h4.6l.6-8.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.8 6.6v4.6M9.2 6.6v4.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconCopy() {
  return (
    <Icon>
      <path d="M5.2 5.2h8.2v8.2H5.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.2 10.2V2.8h7.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconPaste() {
  return (
    <Icon>
      <path d="M5.4 3.4h5.2v1.8H5.4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.2 4.4h7.6v9H4.2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconCut() {
  return (
    <Icon>
      <circle cx="4.2" cy="11.4" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.8" cy="11.4" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.6 10.2 12.2 2.8M10.4 10.2 3.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconFilePlus() {
  return (
    <Icon>
      <path d="M4 2.4h5.2L12.4 5.6v8H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.2 2.4V5.6h3.2M6.2 9.6h4M8.2 7.6v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconFolderPlus() {
  return (
    <Icon>
      <path d="M2.4 4h4l1.2 1.4H13.6v7.2H2.4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.4 9.2h4M8.4 7.2v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconReveal() {
  return (
    <Icon>
      <path d="M2.4 4.2h4l1.2 1.5H13.6v7.1H2.4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="9.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.6 10.8 11.4 12.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </Icon>
  )
}

export function IconNpm({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path fillRule="evenodd" d="M1 1h14v14H1zm2 2h10v10H11V5H8v8H3z" />
    </Icon>
  )
}