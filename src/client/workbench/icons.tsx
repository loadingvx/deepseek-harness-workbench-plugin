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
