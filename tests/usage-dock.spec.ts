// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureNavDockHost,
  findNativeSettingsArea,
  isNativeSettingsTrigger,
  measureNavContentPad,
  navHostIsSeated,
  releaseNavDockHost,
  USAGE_DOCK_HOST,
  usageTabVisible,
} from '../src/client/workbench/usage-dock.ts'
import { NAV_CONTENT_PAD } from '../src/client/workbench/nav-usage-layout.ts'

function mountSettings(label = 'Settings'): HTMLButtonElement {
  const sidebar = document.createElement('div')
  sidebar.className = 'hHd-Xa_root'
  const foot = document.createElement('div')
  foot.className = 'hHd-Xa_footArea'
  const area = document.createElement('div')
  area.className = 'hHd-Xa_settingsArea'
  const wrap = document.createElement('div')
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'dialog')
  btn.textContent = label
  wrap.append(btn)
  area.append(wrap)
  foot.append(area)
  sidebar.append(foot)
  document.body.append(sidebar)
  return btn
}

afterEach(() => {
  releaseNavDockHost()
  document.body.innerHTML = ''
})

describe('native Settings lookup', () => {
  it('finds the harness Settings control and ignores workbench copies', () => {
    mountSettings()
    const workbench = document.createElement('div')
    workbench.setAttribute('data-git-ide-panel', 'side')
    const copy = document.createElement('button')
    copy.setAttribute('aria-haspopup', 'dialog')
    copy.textContent = 'Settings'
    workbench.append(copy)
    document.body.append(workbench)
    const area = findNativeSettingsArea()
    expect(area?.className).toContain('settingsArea')
    expect(isNativeSettingsTrigger(copy)).toBe(false)
  })

  it('accepts the Chinese Settings label', () => {
    mountSettings('设置')
    expect(findNativeSettingsArea()).not.toBeNull()
  })

  it('finds Settings when the left rail is collapsed to an icon', () => {
    const btn = mountSettings('')
    btn.setAttribute('aria-label', 'Settings')
    expect(findNativeSettingsArea()?.className).toContain('settingsArea')
    expect(isNativeSettingsTrigger(btn)).toBe(true)
  })

  it('seats the host on a collapsed rail that only has a footer', () => {
    const sidebar = document.createElement('div')
    sidebar.className = 'hHd-Xa_root'
    sidebar.style.width = '48px'
    const foot = document.createElement('div')
    foot.className = 'hHd-Xa_footArea'
    const gear = document.createElement('button')
    gear.type = 'button'
    gear.setAttribute('aria-haspopup', 'dialog')
    gear.setAttribute('aria-label', '设置')
    foot.append(gear)
    sidebar.append(foot)
    document.body.append(sidebar)
    const host = ensureNavDockHost()
    expect(host).not.toBeNull()
    expect(host?.nextElementSibling).toBe(foot)
    expect(navHostIsSeated(host!)).toBe(true)
  })
})

describe('nav dock host', () => {
  it('inserts a host immediately above Settings', () => {
    const btn = mountSettings()
    const host = ensureNavDockHost()
    expect(host).not.toBeNull()
    expect(host?.getAttribute(USAGE_DOCK_HOST)).toBe('nav')
    expect(host?.nextElementSibling?.className).toContain('footArea')
    expect(navHostIsSeated(host!)).toBe(true)
    expect(btn.closest('[class*="root"]')?.contains(host)).toBe(true)
  })

  it('reuses the same host instead of stacking duplicates', () => {
    mountSettings()
    const first = ensureNavDockHost()
    const second = ensureNavDockHost()
    expect(second).toBe(first)
    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(1)
  })
})

describe('usageTabVisible', () => {
  it('hides the right-dock Usage tab only after the left host is seated', () => {
    expect(usageTabVisible('side', false)).toBe(true)
    expect(usageTabVisible('side', true)).toBe(true)
    expect(usageTabVisible('nav', false)).toBe(true)
    expect(usageTabVisible('nav', true)).toBe(false)
  })
})

describe('measureNavContentPad', () => {
  it('copies padding from the workspace list above the host', () => {
    const sidebar = document.createElement('div')
    const list = document.createElement('div')
    list.className = 'hHd-Xa_workspaceList'
    list.style.paddingLeft = '16px'
    list.style.paddingRight = '16px'
    const host = document.createElement('div')
    sidebar.append(list, host)
    document.body.append(sidebar)
    expect(measureNavContentPad(sidebar, host)).toEqual({ left: 16, right: 16 })
  })

  it('falls back to the default indent when nothing is measurable', () => {
    const sidebar = document.createElement('div')
    const host = document.createElement('div')
    sidebar.append(host)
    document.body.append(sidebar)
    expect(measureNavContentPad(sidebar, host)).toEqual({
      left: NAV_CONTENT_PAD,
      right: NAV_CONTENT_PAD,
    })
  })
})

describe('nav dock content padding', () => {
  it('writes indent css variables onto the seated host', () => {
    const btn = mountSettings()
    const sidebar = btn.closest('[class*="root"]') as HTMLElement
    const list = document.createElement('div')
    list.className = 'hHd-Xa_workspaceList'
    list.style.paddingLeft = '16px'
    list.style.paddingRight = '16px'
    const foot = sidebar.querySelector('[class*="footArea"]') as HTMLElement
    sidebar.insertBefore(list, foot)
    const host = ensureNavDockHost()
    expect(host).not.toBeNull()
    expect(host?.style.getPropertyValue('--dsw-usage-pad-left')).toBe('16px')
    expect(host?.style.getPropertyValue('--dsw-usage-pad-right')).toBe('16px')
  })
})
