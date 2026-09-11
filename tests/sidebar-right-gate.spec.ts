import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { hasOfficialSidebarServices } from '../src/client/workbench/sidebar-right/services.ts'

function ctxWith(services: Record<string, unknown>): ClientContext {
  return {
    ...services,
    get(name: string) {
      return services[name]
    },
  } as unknown as ClientContext
}

describe('hasOfficialSidebarServices', () => {
  it('is false when sidebar services are missing (old harness)', () => {
    expect(hasOfficialSidebarServices(ctxWith({}))).toBe(false)
  })

  it('is true only when both tabs and sidebar are present', () => {
    const tabs = { register: () => () => {} }
    const sidebar = { openTab: () => {} }
    expect(hasOfficialSidebarServices(ctxWith({ sidebarRightTabs: tabs }))).toBe(false)
    expect(hasOfficialSidebarServices(ctxWith({ sidebarRight: sidebar }))).toBe(false)
    expect(hasOfficialSidebarServices(ctxWith({
      sidebarRightTabs: tabs,
      sidebarRight: sidebar,
    }))).toBe(true)
  })
})
