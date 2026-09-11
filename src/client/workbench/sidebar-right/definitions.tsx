import type { ComponentType, ReactNode } from 'react'
import type { Translate } from '../types.ts'
import {
  IconGit, IconGlobe, IconLayout, IconSlash, IconTerminal, IconUsage,
} from '../icons.tsx'
import {
  WORKBENCH_BROWSER_ID,
  WORKBENCH_BROWSER_KIND,
  WORKBENCH_CONTROL_PLANE_ID,
  WORKBENCH_CONTROL_PLANE_KIND,
  WORKBENCH_GIT_ID,
  WORKBENCH_GIT_KIND,
  WORKBENCH_SLASH_ID,
  WORKBENCH_SLASH_KIND,
  WORKBENCH_TERMINAL_ID,
  WORKBENCH_TERMINAL_KIND,
  WORKBENCH_USAGE_ID,
  WORKBENCH_USAGE_KIND,
} from './ids.ts'

/** Minimal glyph face accepted by the official guide capsules. */
type GlyphProps = { size?: number; className?: string }

function wrapIcon(Icon: () => ReactNode): ComponentType<GlyphProps> {
  return function Glyph({ size = 16, className }: GlyphProps) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon />
      </span>
    )
  }
}

const GitGlyph = wrapIcon(IconGit)
const UsageGlyph = wrapIcon(IconUsage)
const SlashGlyph = wrapIcon(IconSlash)
const TerminalGlyph = wrapIcon(IconTerminal)
const BrowserGlyph = wrapIcon(IconGlobe)
const ControlPlaneGlyph = wrapIcon(IconLayout)

/** Structural slice of SidebarRightTabDefinition — avoid value-importing the package. */
export type WorkbenchSidebarTabDefinition = {
  id: string
  kind: string
  priority: 'extension'
  title: () => string
  guide: Array<{
    order: number
    title: () => string
    description: () => string
    icon: ComponentType<GlyphProps>
  }>
}

export function gitTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_GIT_ID,
    kind: WORKBENCH_GIT_KIND,
    priority: 'extension',
    title: () => t('ide.git'),
    guide: [{
      order: 20,
      title: () => t('ide.git'),
      description: () => t('sidebarRight.guide.git'),
      icon: GitGlyph,
    }],
  }
}

export function usageTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_USAGE_ID,
    kind: WORKBENCH_USAGE_KIND,
    priority: 'extension',
    title: () => t('ide.usage'),
    guide: [{
      order: 30,
      title: () => t('ide.usage'),
      description: () => t('sidebarRight.guide.usage'),
      icon: UsageGlyph,
    }],
  }
}

export function slashTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_SLASH_ID,
    kind: WORKBENCH_SLASH_KIND,
    priority: 'extension',
    title: () => t('ide.slash'),
    guide: [{
      order: 40,
      title: () => t('ide.slash'),
      description: () => t('sidebarRight.guide.slash'),
      icon: SlashGlyph,
    }],
  }
}

export function terminalTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_TERMINAL_ID,
    kind: WORKBENCH_TERMINAL_KIND,
    priority: 'extension',
    title: () => t('ide.terminal'),
    guide: [{
      order: 50,
      title: () => t('ide.terminal'),
      description: () => t('sidebarRight.guide.terminal'),
      icon: TerminalGlyph,
    }],
  }
}

export function browserTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_BROWSER_ID,
    kind: WORKBENCH_BROWSER_KIND,
    priority: 'extension',
    title: () => t('ide.browser'),
    guide: [{
      order: 60,
      title: () => t('ide.browser'),
      description: () => t('sidebarRight.guide.browser'),
      icon: BrowserGlyph,
    }],
  }
}

export function controlPlaneTabDefinition(t: Translate): WorkbenchSidebarTabDefinition {
  return {
    id: WORKBENCH_CONTROL_PLANE_ID,
    kind: WORKBENCH_CONTROL_PLANE_KIND,
    priority: 'extension',
    title: () => t('ide.controlPlane'),
    guide: [{
      order: 70,
      title: () => t('ide.controlPlane'),
      description: () => t('sidebarRight.guide.controlPlane'),
      icon: ControlPlaneGlyph,
    }],
  }
}
