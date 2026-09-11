import { describe, expect, it } from 'vitest'
import {
  isNpmPackageRepo,
  isPluginLink,
  parsePluginLink,
  PluginLinkError,
  pluginIdForNpmPackage,
  resolveLatestNpmVersion,
} from '../src/plugin-link.ts'

const BASE = 'dsh://plugin/install?id=open-design&name=%E6%89%93%E5%BC%80%20Design&version=1.0.0&repo=nexu-io/open-design'

describe('isPluginLink', () => {
  it('accepts the documented install route', () => {
    expect(isPluginLink(BASE)).toBe(true)
  })

  it('rejects other schemes, hosts, routes and non-URL input', () => {
    for (const value of ['https://plugin/install', 'dsh://plugin/other', 'dsh://else/install', 'not a url', '']) {
      expect(isPluginLink(value)).toBe(false)
    }
  })
})

describe('parsePluginLink', () => {
  it('decodes the documented parameter set', () => {
    const request = parsePluginLink(`${BASE}&permissions=${encodeURIComponent('网络请求,本地文件读写')}`)
    expect(request.id).toBe('open-design')
    expect(request.name).toBe('打开 Design')
    expect(request.version).toBe('1.0.0')
    expect(request.repo).toBe('nexu-io/open-design')
    expect(request.permissions).toEqual(['网络请求', '本地文件读写'])
    expect(request.downloadUrl).toBeNull()
  })

  it('keeps the latest sentinel and an https fallback URL', () => {
    const request = parsePluginLink(`${BASE.replace('version=1.0.0', 'version=latest')}&downloadUrl=${encodeURIComponent('https://api.deepseek.stream/p.zip')}`)
    expect(request.version).toBe('latest')
    expect(request.downloadUrl).toBe('https://api.deepseek.stream/p.zip')
  })

  it('rejects missing required parameters', () => {
    expect(() => parsePluginLink('dsh://plugin/install?id=a&name=b&repo=c')).toThrow(PluginLinkError)
  })

  it('rejects malformed identifiers, versions and non-https download URLs', () => {
    const cases = [
      'dsh://plugin/install?id=Bad%20Id&name=x&version=1.0.0&repo=owner/repo',
      'dsh://plugin/install?id=ok&name=x&version=not-a-version&repo=owner/repo',
      'dsh://plugin/install?id=ok&name=x&version=1.0.0&repo=owner/repo&downloadUrl=http%3A%2F%2Finsecure.test%2Fa.zip',
      'dsh://plugin/install?id=ok&name=x&version=1.0.0&repo=%2F%2Fevil',
    ]
    for (const value of cases) expect(() => parsePluginLink(value)).toThrow(PluginLinkError)
  })
})

describe('pluginIdForNpmPackage', () => {
  it('mirrors the discovery repository derivation', () => {
    // The discovery repository derives `npm.<normalized>.<sha256(name)[0:12]>`.
    expect(pluginIdForNpmPackage('open-design')).toMatch(/^npm\.open-design\.[0-9a-f]{12}$/u)
    expect(pluginIdForNpmPackage('@dsh-external/dsh-graded-mode'))
      .toMatch(/^npm\.dsh-external\.dsh-graded-mode\.[0-9a-f]{12}$/u)
    expect(pluginIdForNpmPackage('@scope/name')).toBe(pluginIdForNpmPackage('@scope/name'))
  })

  it('classifies npm package repos', () => {
    expect(isNpmPackageRepo('@scope/name')).toBe(true)
    expect(isNpmPackageRepo('owner/repo')).toBe(false)
  })
})

describe('resolveLatestNpmVersion', () => {
  const ok = (latest: unknown) => async () => ({ ok: true, json: async () => ({ 'dist-tags': { latest } }) })

  it('returns the exact latest tag', async () => {
    await expect(resolveLatestNpmVersion('open-design', ok('2.3.4'))).resolves.toBe('2.3.4')
  })

  it('rejects unusable tags, failed responses and non-versions', async () => {
    await expect(resolveLatestNpmVersion('open-design', ok('not-a-version'))).resolves.toBeNull()
    await expect(resolveLatestNpmVersion('open-design', async () => ({ ok: false, json: async () => ({}) })))
      .resolves.toBeNull()
  })
})
