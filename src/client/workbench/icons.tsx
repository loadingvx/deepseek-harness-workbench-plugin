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

export function IconRefresh() {
  return (
    <Icon>
      <path d="M13.2 8A5.2 5.2 0 1 1 11 3.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 1.6v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
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

export function IconPanelOff() {
  return (
    <Icon>
      <path d="M2 3h12v10H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3v10" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

export function IconSparkle() {
  return (
    <Icon>
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
