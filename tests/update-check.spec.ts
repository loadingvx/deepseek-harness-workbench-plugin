import { afterEach, describe, expect, it } from 'vitest'
import {
  canInstallLatestPlugin,
  checkPluginUpdate,
  readInstalledVersion,
  resetUpdateCache,
} from '../src/host/update-check.ts'
import {
  isNewer,
  meetsMinVersion,
  MIN_HARNESS_VERSION,
  PLUGIN_ISSUES_URL,
  PLUGIN_NAME,
  PLUGIN_PAGE_URL,
  PLUGIN_REPO_URL,
  updateTermSeed,
  upgradeCommand,
} from '../src/shared/version.ts'

afterEach(() => {
  resetUpdateCache()
})

describe('isNewer', () => {
  it('compares x.y.z and ignores junk', () => {
    expect(isNewer('0.1.2', '0.1.1')).toBe(true)
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.1.1', '0.1.1')).toBe(false)
    expect(isNewer('0.1.0', '0.1.1')).toBe(false)
    expect(isNewer('not-a-version', '0.1.1')).toBe(false)
    expect(isNewer('0.1.2', '')).toBe(false)
  })
})

describe('meetsMinVersion', () => {
  it('treats prerelease as the base x.y.z', () => {
    expect(meetsMinVersion('0.1.5', MIN_HARNESS_VERSION)).toBe(true)
    expect(meetsMinVersion('0.1.5-rc.2', MIN_HARNESS_VERSION)).toBe(true)
    expect(meetsMinVersion('0.1.6', MIN_HARNESS_VERSION)).toBe(true)
    expect(meetsMinVersion('0.1.4', MIN_HARNESS_VERSION)).toBe(false)
    expect(meetsMinVersion('0.1.4-rc.9', MIN_HARNESS_VERSION)).toBe(false)
    expect(meetsMinVersion('', MIN_HARNESS_VERSION)).toBe(false)
  })
})

describe('canInstallLatestPlugin', () => {
  it('allows when harness meets the floor', () => {
    expect(canInstallLatestPlugin('0.1.5', false)).toBe(true)
    expect(canInstallLatestPlugin('0.1.5-rc.2', false)).toBe(true)
  })

  it('allows when official sidebar-right is present even if version is unknown', () => {
    expect(canInstallLatestPlugin(null, true)).toBe(true)
  })

  it('refuses when harness is old and sidebar-right is missing', () => {
    expect(canInstallLatestPlugin('0.1.4', false)).toBe(false)
    expect(canInstallLatestPlugin(null, false)).toBe(false)
  })
})

describe('upgradeCommand', () => {
  it('pins the published version on the web profile', () => {
    expect(upgradeCommand('0.1.3')).toBe(`dsh plugin --profile web add ${PLUGIN_NAME}@0.1.3`)
  })
})

describe('PLUGIN_PAGE_URL', () => {
  it('points at the public npm page', () => {
    expect(PLUGIN_PAGE_URL).toBe('https://www.npmjs.com/package/dsh-workbench-plugin')
  })
})

describe('PLUGIN_REPO_URL', () => {
  it('points at the GitHub project page', () => {
    expect(PLUGIN_REPO_URL).toBe('https://github.com/loadingvx/deepseek-harness-workbench-plugin')
  })
})

describe('PLUGIN_ISSUES_URL', () => {
  it('points at the public GitHub Issues page', () => {
    expect(PLUGIN_ISSUES_URL).toBe('https://github.com/loadingvx/deepseek-harness-workbench-plugin/issues')
  })
})

describe('updateTermSeed', () => {
  it('types the hint and command as shell comments', () => {
    expect(updateTermSeed('dsh plugin --profile web add dsh-workbench-plugin@0.1.2', '工作台有新版本 0.1.2（当前 0.1.1）。去掉下一行开头的 # 再回车，然后重启 dsh web。'))
      .toBe('# 工作台有新版本 0.1.2（当前 0.1.1）。去掉下一行开头的 # 再回车，然后重启 dsh web。\n# dsh plugin --profile web add dsh-workbench-plugin@0.1.2')
  })

  it('omits the install command when blocked', () => {
    expect(updateTermSeed('', '请先升级 harness'))
      .toBe('# 请先升级 harness')
  })
})

describe('readInstalledVersion', () => {
  it('walks up from this file to the plugin package.json', () => {
    expect(readInstalledVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('checkPluginUpdate', () => {
  it('marks outdated when npm latest is newer', async () => {
    const result = await checkPluginUpdate({
      fetchLatest: async () => '9.9.9',
      readHarnessVersion: () => '0.1.5',
      hasSidebarRight: () => true,
    })
    expect(result.outdated).toBe(true)
    expect(result.latest).toBe('9.9.9')
    expect(result.command).toContain('@9.9.9')
    expect(result.current).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.installAllowed).toBe(true)
    expect(result.minHarness).toBe(MIN_HARNESS_VERSION)
  })

  it('still reports outdated on old harness but refuses install', async () => {
    const result = await checkPluginUpdate({
      fetchLatest: async () => '9.9.9',
      readHarnessVersion: () => '0.1.4',
      hasSidebarRight: () => false,
    })
    expect(result.outdated).toBe(true)
    expect(result.latest).toBe('9.9.9')
    expect(result.installAllowed).toBe(false)
    expect(result.harnessVersion).toBe('0.1.4')
  })

  it('stays quiet when latest matches or is older', async () => {
    const current = readInstalledVersion()
    const same = await checkPluginUpdate({
      fetchLatest: async () => current,
      readHarnessVersion: () => '0.1.5',
      hasSidebarRight: () => true,
    })
    expect(same.outdated).toBe(false)
    resetUpdateCache()
    const older = await checkPluginUpdate({
      fetchLatest: async () => '0.0.1',
      readHarnessVersion: () => '0.1.5',
      hasSidebarRight: () => true,
    })
    expect(older.outdated).toBe(false)
  })

  it('stays quiet when the registry is unreachable', async () => {
    const result = await checkPluginUpdate({
      fetchLatest: async () => { throw new Error('offline') },
      readHarnessVersion: () => '0.1.5',
      hasSidebarRight: () => true,
    })
    expect(result.outdated).toBe(false)
    expect(result.latest).toBeNull()
  })

  it('reuses a successful lookup for later calls', async () => {
    let hits = 0
    const first = await checkPluginUpdate({
      now: () => 1_000,
      readHarnessVersion: () => '0.1.5',
      hasSidebarRight: () => true,
      fetchLatest: async () => {
        hits += 1
        return '8.0.0'
      },
    })
    const second = await checkPluginUpdate({
      now: () => 2_000,
      readHarnessVersion: () => '0.1.4',
      hasSidebarRight: () => false,
      fetchLatest: async () => {
        hits += 1
        return '1.0.0'
      },
    })
    expect(hits).toBe(1)
    expect(second).toEqual(first)
    expect(second.latest).toBe('8.0.0')
  })
})
