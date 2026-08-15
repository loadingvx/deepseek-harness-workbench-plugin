import { afterEach, describe, expect, it } from 'vitest'
import { checkPluginUpdate, readInstalledVersion, resetUpdateCache } from '../src/host/update-check.ts'
import { isNewer, PLUGIN_NAME, PLUGIN_PAGE_URL, updateTermSeed, upgradeCommand } from '../src/shared/version.ts'

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

describe('updateTermSeed', () => {
  it('types the hint and command as shell comments', () => {
    expect(updateTermSeed('dsh plugin --profile web add dsh-workbench-plugin@0.1.2', '工作台有新版本 0.1.2（当前 0.1.1）。去掉下一行开头的 # 再回车，然后重启 dsh web。'))
      .toBe('# 工作台有新版本 0.1.2（当前 0.1.1）。去掉下一行开头的 # 再回车，然后重启 dsh web。\n# dsh plugin --profile web add dsh-workbench-plugin@0.1.2')
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
    })
    expect(result.outdated).toBe(true)
    expect(result.latest).toBe('9.9.9')
    expect(result.command).toContain('@9.9.9')
    expect(result.current).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('stays quiet when latest matches or is older', async () => {
    const current = readInstalledVersion()
    const same = await checkPluginUpdate({ fetchLatest: async () => current })
    expect(same.outdated).toBe(false)
    resetUpdateCache()
    const older = await checkPluginUpdate({ fetchLatest: async () => '0.0.1' })
    expect(older.outdated).toBe(false)
  })

  it('stays quiet when the registry is unreachable', async () => {
    const result = await checkPluginUpdate({
      fetchLatest: async () => { throw new Error('offline') },
    })
    expect(result.outdated).toBe(false)
    expect(result.latest).toBeNull()
  })

  it('reuses a successful lookup for later calls', async () => {
    let hits = 0
    const first = await checkPluginUpdate({
      now: () => 1_000,
      fetchLatest: async () => {
        hits += 1
        return '8.0.0'
      },
    })
    const second = await checkPluginUpdate({
      now: () => 2_000,
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
