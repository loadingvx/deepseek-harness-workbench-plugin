// @vitest-environment jsdom
/**
 * Issue #26: stacked usage panels / unpin cannot clear non-empty hosts.
 * Asserts the singleton + force-release fix.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapNavDockHosts,
  claimNavPortalLease,
  ensureNavDockHost,
  isNavPortalOwner,
  purgeNavDockHosts,
  readNavPortalLease,
  readUsageDock,
  releaseNavDockHost,
  resetNavDockBootstrapForTests,
  USAGE_DOCK_HOST,
  USAGE_DOCK_KEY,
  writeUsageDock,
} from '../src/client/workbench/usage-dock.ts'

function mountSidebar(id: string): HTMLElement {
  const sidebar = document.createElement('div')
  sidebar.className = 'hHd-Xa_root'
  sidebar.dataset.sid = id
  const list = document.createElement('div')
  list.className = 'hHd-Xa_workspaceList'
  const foot = document.createElement('div')
  foot.className = 'hHd-Xa_footArea'
  const area = document.createElement('div')
  area.className = 'hHd-Xa_settingsArea'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'dialog')
  btn.textContent = 'Settings'
  area.append(btn)
  foot.append(area)
  sidebar.append(list, foot)
  document.body.append(sidebar)
  return sidebar
}

function paintFakePanel(host: HTMLElement, model: string): void {
  const root = document.createElement('div')
  root.setAttribute('data-git-chrome', 'usage')
  root.innerHTML = `<header><span>用量</span><span class="model">${model}</span><button type="button" class="pin">pin</button></header>`
  host.append(root)
}

afterEach(() => {
  releaseNavDockHost()
  resetNavDockBootstrapForTests()
  document.body.innerHTML = ''
  try { localStorage.removeItem(USAGE_DOCK_KEY) } catch { /* ignore */ }
})

describe('issue #26 singleton usage host', () => {
  it('collapses detached-then-reattached sidebars to one host', () => {
    expect(readUsageDock()).toBe('nav')

    const s1 = mountSidebar('1')
    const h1 = ensureNavDockHost()!
    paintFakePanel(h1, 'glm-pro')

    s1.remove()
    mountSidebar('2')
    const h2 = ensureNavDockHost()!
    paintFakePanel(h2, 'deepseek-flash')
    expect(h2).not.toBe(h1)

    document.body.append(s1)
    // ensure again: extras (including reattached orphan) are purged
    const kept = ensureNavDockHost()
    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(1)
    expect(kept?.isConnected).toBe(true)
  })

  it('releaseNavDockHost clears hosts even when they still have panel children', () => {
    const s1 = mountSidebar('1')
    const h1 = ensureNavDockHost()!
    paintFakePanel(h1, 'glm-pro')
    s1.remove()
    mountSidebar('2')
    const h2 = ensureNavDockHost()!
    paintFakePanel(h2, 'deepseek-flash')
    document.body.append(s1)

    writeUsageDock('side')
    releaseNavDockHost()

    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(0)
    expect(document.querySelectorAll('[data-git-chrome="usage"]')).toHaveLength(0)
  })

  it('bootstrap wipe drops leaked upgrade hosts before first ensure', () => {
    const s1 = mountSidebar('1')
    const leak = document.createElement('div')
    leak.setAttribute(USAGE_DOCK_HOST, 'nav')
    paintFakePanel(leak, 'stale-orphan')
    s1.insertBefore(leak, s1.querySelector('[class*="footArea"]'))

    resetNavDockBootstrapForTests()
    bootstrapNavDockHosts()
    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(0)

    const fresh = ensureNavDockHost()
    expect(fresh).not.toBeNull()
    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(1)
    expect(fresh?.querySelector('.model')).toBeNull()
  })

  it('purgeNavDockHosts removes every host unconditionally', () => {
    mountSidebar('1')
    const host = ensureNavDockHost()!
    paintFakePanel(host, 'a')
    paintFakePanel(host, 'b')
    paintFakePanel(host, 'c')
    expect(host.querySelectorAll('[data-git-chrome="usage"]')).toHaveLength(3)
    purgeNavDockHosts()
    expect(document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)).toHaveLength(0)
  })

  it('nav portal lease: only the latest claim is owner', () => {
    const first = claimNavPortalLease()
    expect(isNavPortalOwner(first)).toBe(true)
    const second = claimNavPortalLease()
    expect(isNavPortalOwner(first)).toBe(false)
    expect(isNavPortalOwner(second)).toBe(true)
    expect(readNavPortalLease()).toBe(second)
  })
})
