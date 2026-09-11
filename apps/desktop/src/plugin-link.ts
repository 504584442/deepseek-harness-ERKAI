/** One validated `dsh://plugin/install` deep link emitted by the plugin market. */

import { createHash } from 'node:crypto'

/** The custom scheme the plugin market uses to hand a plugin to the desktop client. */
export const PLUGIN_LINK_SCHEME = 'dsh'

/** Longest accepted value for any query parameter, in characters. */
const MAX_PARAMETER_LENGTH = 512

/** Plugin identifiers are lowercase and dash/underscore separated. */
const PLUGIN_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u

/** Semantic version, with the market's `latest` placeholder kept as a sentinel. */
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u

/** An npm package name, scoped or bare. */
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/** Overall input bound before any parsing happens. */
const MAX_LINK_LENGTH = 4096

/** Validated request carried by one `dsh://plugin/install` link. */
export interface PluginLinkRequest {
  /** Plugin identifier, lowercase; used for display and fallback naming. */
  readonly id: string
  /** Human-readable plugin name shown in the authorization dialog. */
  readonly name: string
  /** Requested version, or `latest` when the market did not pin one. */
  readonly version: string
  /** Upstream repository (`owner/repo`) or npm package name. */
  readonly repo: string
  /** Requested permission summary, shown verbatim to the user. */
  readonly permissions: readonly string[]
  /** Optional direct archive URL, used only as a documented fallback. */
  readonly downloadUrl: string | null
}

/** Raised when a candidate string is not a usable plugin link. */
export class PluginLinkError extends Error {
  override readonly name = 'PluginLinkError'
}

function fail(reason: string): never {
  throw new PluginLinkError(reason)
}

/** Read one bounded, decoded query parameter. */
function parameter(params: URLSearchParams, key: string, required: boolean): string | null {
  const raw = params.get(key)
  if (raw === null || raw.length === 0) {
    if (required) fail(`missing required parameter: ${key}`)
    return null
  }
  if (raw.length > MAX_PARAMETER_LENGTH) fail(`parameter too long: ${key}`)
  if (/[\u0000-\u001f\u007f]/u.test(raw)) fail(`parameter contains control characters: ${key}`)
  return raw.trim()
}

/**
 * Report whether a raw string is a `dsh://plugin/install` link.
 * @param raw - Candidate string, typically a process argument or an OS URL.
 * @returns true when the string carries the plugin-install route.
 */
export function isPluginLink(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_LENGTH) return false
  try {
    const url = new URL(raw)
    return url.protocol === `${PLUGIN_LINK_SCHEME}:` && url.hostname === 'plugin' && url.pathname === '/install'
  } catch {
    return false
  }
}

/**
 * Parse and validate one plugin-install link.
 * @param raw - Raw `dsh://plugin/install?...` string.
 * @returns the validated request.
 * @throws PluginLinkError when the link is malformed or violates the documented data dictionary.
 */
export function parsePluginLink(raw: string): PluginLinkRequest {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_LENGTH) {
    fail('link is empty or too long')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail('link is not a valid URL')
  }
  if (url.protocol !== `${PLUGIN_LINK_SCHEME}:`) fail('unsupported scheme')
  if (url.hostname !== 'plugin') fail('unsupported route host')
  if (url.pathname !== '/install') fail('unsupported route path')

  const params = url.searchParams
  const id = parameter(params, 'id', true)
  const name = parameter(params, 'name', true)
  const version = parameter(params, 'version', true) ?? 'latest'
  const repo = parameter(params, 'repo', true)
  const permissions = parameter(params, 'permissions', false)
  const downloadUrl = parameter(params, 'downloadUrl', false)

  if (id === null || name === null || repo === null) fail('missing required parameter')
  if (!PLUGIN_ID.test(id)) fail('plugin id must be lowercase and separator-delimited')
  if (version !== 'latest' && !EXACT_VERSION.test(version)) fail('version must be semantic or latest')
  if (!NPM_PACKAGE.test(repo) && !/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/u.test(repo)) {
    fail('repo must be an npm package name or an owner/repository pair')
  }
  if (downloadUrl !== null) {
    let parsed: URL
    try {
      parsed = new URL(downloadUrl)
    } catch {
      fail('downloadUrl is not a valid URL')
    }
    if (parsed.protocol !== 'https:') fail('downloadUrl must use https')
  }

  return {
    id,
    name,
    version,
    repo,
    permissions: permissions === null
      ? []
      : permissions.split(',').map(value => value.trim()).filter(value => value.length > 0),
    downloadUrl,
  }
}

/**
 * Report whether a link repo refers to an npm package rather than an `owner/repo` pair.
 * @param repo - The link's repo parameter, already validated.
 * @returns true when the value is an npm package name.
 */
export function isNpmPackageRepo(repo: string): boolean {
  return NPM_PACKAGE.test(repo)
}

/**
 * Derive the catalog plugin id for an npm package, mirroring the discovery repository
 * (`npmPluginId` in `plugin-center/npm-ecosystem-catalog.ts`) so a link resolves to the
 * same reviewed catalog entry the discovery page would produce.
 * @param packageName - Exact npm package name.
 * @returns the stable catalog plugin id.
 */
export function pluginIdForNpmPackage(packageName: string): string {
  const normalized = packageName.replace(/^@/u, '').replace('/', '.').replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '').slice(0, 90) || 'package'
  const digest = createHash('sha256').update(packageName).digest('hex').slice(0, 12)
  return `npm.${normalized}.${digest}`
}

/** Minimal fetch face so version resolution stays testable. */
export type VersionFetch = (input: string, init?: { readonly signal?: AbortSignal }) => Promise<{
  readonly ok: boolean
  json: () => Promise<unknown>
}>

/**
 * Resolve the exact version behind a `latest` request by reading the npm dist-tags.
 * @param packageName - Exact npm package name.
 * @param fetchImpl - Fetch implementation (global fetch in the desktop process).
 * @param signal - Optional abort signal bounding the request.
 * @returns the exact latest version, or null when it cannot be established.
 */
export async function resolveLatestNpmVersion(
  packageName: string,
  fetchImpl: VersionFetch,
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetchImpl(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    signal === undefined ? undefined : { signal },
  )
  if (!response.ok) return null
  const document = await response.json() as { readonly 'dist-tags'?: Record<string, unknown> }
  const latest = document['dist-tags']?.['latest']
  return typeof latest === 'string' && EXACT_VERSION.test(latest) ? latest : null
}
