import type { Context } from '@deepseek-ai/cordis'
import { GitError } from '../shared/errors.ts'
import { redactSecrets } from '../shared/redact.ts'
import type { ProviderUsageSnapshot, UsageBalanceStatus, UsageRouteSource } from '../shared/types.ts'
import { billingOrigin, billingUrls, parseBalanceBody } from '../shared/usage-format.ts'

const FETCH_TIMEOUT_MS = 8_000
const DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com'
const DEEPSEEK_PROVIDER = 'deepseek-official'

export type UsageFetch = (url: string, init: RequestInit) => Promise<Response>

export interface UsageQueryOptions {
  fetch?: UsageFetch
  now?: () => number
  signal?: AbortSignal
}

interface Route {
  provider: string
  model: string
  reasoningEffort?: string
  source: UsageRouteSource
}

interface Connection {
  baseURL: string
  apiKeyEnv: string
}

interface HostLlm {
  listProviders(): Array<{ id: string }>
  listConfigurableProviders?(): Array<{ provider: string; displayName: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{ name?: string }>
}

function readLlm(ctx: Context): HostLlm {
  const llm = (ctx.llm ?? ctx.get('llm')) as HostLlm | undefined
  if (llm === undefined || typeof llm.listProviders !== 'function') {
    throw new GitError('LLM_UNAVAILABLE')
  }
  return llm
}

function defaultRoute(ctx: Context): Route | undefined {
  const service = ctx.agentDefaultModel
    ?? ctx.get('agentDefaultModel') as Context['agentDefaultModel'] | undefined
  const selection = service?.currentSelection?.()
  if (
    typeof selection?.provider === 'string'
    && selection.provider !== ''
    && typeof selection.model === 'string'
    && selection.model !== ''
  ) {
    return {
      provider: selection.provider,
      model: selection.model,
      ...typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== ''
        ? { reasoningEffort: selection.reasoningEffort }
        : {},
      source: 'default',
    }
  }
  return undefined
}

function loggedRoute(agent: unknown): Omit<Route, 'source'> | undefined {
  const header = (agent as {
    session?: { requestHeader?: () => { config?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } } }
  } | undefined)?.session?.requestHeader?.()
  const config = header?.config
  if (typeof config?.provider !== 'string' || config.provider === '') return undefined
  if (typeof config.model !== 'string' || config.model === '') return undefined
  return {
    provider: config.provider,
    model: config.model,
    ...typeof config.reasoningEffort === 'string' && config.reasoningEffort !== ''
      ? { reasoningEffort: config.reasoningEffort }
      : {},
  }
}

function agentFor(ctx: Context, sessionId: string | undefined): unknown {
  if (sessionId === undefined || sessionId === '') return undefined
  const agents = ctx.get('agents') as { get?: (id: string) => unknown } | undefined
  const found = agents?.get?.(sessionId)
  if (found !== undefined) return found
  const sessions = ctx.sessions ?? ctx.get('sessions') as Context['sessions'] | undefined
  return sessions?.binding?.(sessionId)
}

function resolveRoute(ctx: Context, sessionId: string | undefined): Route {
  const logged = loggedRoute(agentFor(ctx, sessionId))
  if (logged !== undefined) return { ...logged, source: 'session' }
  const fallback = defaultRoute(ctx)
  if (fallback !== undefined) return fallback
  throw new GitError('LLM_UNAVAILABLE')
}

function settingsSection(ctx: Context, ns: string): unknown {
  const settings = ctx.get('settings') as { get?: (name: string) => unknown } | undefined
  try {
    return settings?.get?.(ns)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function connectionFor(ctx: Context, provider: string): Connection {
  if (provider === DEEPSEEK_PROVIDER) {
    const section = asRecord(settingsSection(ctx, 'llm-deepseek'))
    return {
      baseURL: asNonEmpty(section?.baseURL) ?? DEFAULT_DEEPSEEK_BASE,
      apiKeyEnv: asNonEmpty(section?.apiKeyEnv) ?? 'DEEPSEEK_API_KEY',
    }
  }
  const pi = asRecord(settingsSection(ctx, 'llm-pi-ai'))
  const providers = asRecord(pi?.providers)
  const profile = asRecord(providers?.[provider])
  return {
    baseURL: asNonEmpty(profile?.baseURL) ?? '',
    apiKeyEnv: asNonEmpty(profile?.apiKeyEnv) ?? '',
  }
}

async function resolveApiKey(ctx: Context, ref: string): Promise<string | undefined> {
  if (ref === '' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return undefined
  const credentials = ctx.get('credentials') as {
    resolve?: (name: string) => Promise<{ value?: string } | undefined>
  } | undefined
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(ref)
      const value = asNonEmpty(hit?.value)
      return value
    } catch {
      return undefined
    }
  }
  const env = ctx.get('launchEnvironment') as {
    get?: (name: string) => { value?: string } | undefined
  } | undefined
  const ambient = asNonEmpty(env?.get?.(ref)?.value)
  if (ambient !== undefined) return ambient
  const processValue = asNonEmpty(process.env[ref])
  return processValue
}

function providerNameOf(llm: HostLlm, provider: string): string {
  const listed = llm.listConfigurableProviders?.() ?? []
  const match = listed.find(item => item.provider === provider)
  if (match !== undefined && match.displayName.trim() !== '') return match.displayName
  if (provider === DEEPSEEK_PROVIDER) return 'DeepSeek'
  return provider
}

async function modelNameOf(llm: HostLlm, provider: string, model: string, signal?: AbortSignal): Promise<string> {
  try {
    const info = await llm.resolveModelInfo?.(provider, model, signal)
    if (typeof info?.name === 'string' && info.name.trim() !== '') return info.name
  } catch { /* catalog lookup is advisory */ }
  try {
    const models = await llm.listModels(provider)
    const match = models.find(item => item.id === model)
    if (typeof match?.name === 'string' && match.name.trim() !== '') return match.name
  } catch { /* same */ }
  return model
}

function endpointLabel(baseURL: string): string | undefined {
  if (baseURL === '') return undefined
  try {
    const url = new URL(baseURL.includes('://') ? baseURL : `https://${baseURL}`)
    return redactSecrets(`${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`)
  } catch {
    return redactSecrets(billingOrigin(baseURL))
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function queryBalance(
  baseURL: string,
  apiKey: string,
  fetchImpl: UsageFetch,
  signal: AbortSignal,
): Promise<{ status: UsageBalanceStatus; accountAvailable?: boolean; balances: ProviderUsageSnapshot['balances'] }> {
  const urls = billingUrls(baseURL)
  if (urls.length === 0) return { status: 'unsupported', balances: [] }
  let sawAuth = false
  let sawHttp = false
  for (const url of urls) {
    if (signal.aborted) break
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'user-agent': 'dsh-workbench-plugin/usage (+https://github.com/loadingvx/deepseek-harness-workbench-plugin)',
        },
      })
      if (response.status === 401 || response.status === 403) {
        sawAuth = true
        continue
      }
      if (response.status === 404 || response.status === 405) continue
      if (!response.ok) {
        sawHttp = true
        continue
      }
      const parsed = parseBalanceBody(await readJson(response))
      if (parsed === null) continue
      return { status: 'ok', balances: parsed.balances, accountAvailable: parsed.accountAvailable }
    } catch (error) {
      if (signal.aborted) break
      if (error instanceof Error && error.name === 'AbortError') break
      sawHttp = true
    }
  }
  if (sawAuth) return { status: 'auth', balances: [] }
  if (sawHttp) return { status: 'failed', balances: [] }
  return { status: 'unsupported', balances: [] }
}

function timeoutSignal(parent?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, FETCH_TIMEOUT_MS)
  const onParent = (): void => { controller.abort() }
  parent?.addEventListener('abort', onParent)
  if (parent?.aborted) controller.abort()
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParent)
    },
  }
}

/** Current session model plus that provider's account balance. Never returns secrets. */
export async function readProviderUsage(
  ctx: Context,
  sessionId?: string,
  options?: UsageQueryOptions,
): Promise<ProviderUsageSnapshot> {
  const llm = readLlm(ctx)
  const route = resolveRoute(ctx, sessionId)
  const connection = connectionFor(ctx, route.provider)
  const [modelName, apiKey] = await Promise.all([
    modelNameOf(llm, route.provider, route.model, options?.signal),
    connection.apiKeyEnv === '' ? Promise.resolve(undefined) : resolveApiKey(ctx, connection.apiKeyEnv),
  ])
  const fetchedAt = options?.now?.() ?? Date.now()
  const snapshot = (balanceStatus: UsageBalanceStatus, extra?: Partial<ProviderUsageSnapshot>): ProviderUsageSnapshot => ({
    provider: route.provider,
    providerName: providerNameOf(llm, route.provider),
    model: route.model,
    modelName,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    source: route.source,
    ...endpointLabel(connection.baseURL) === undefined ? {} : { endpoint: endpointLabel(connection.baseURL) },
    balanceStatus,
    balances: [],
    fetchedAt,
    ...extra,
  })

  if (connection.baseURL === '' && route.provider !== DEEPSEEK_PROVIDER) {
    if (apiKey === undefined) return snapshot(connection.apiKeyEnv === '' ? 'unsupported' : 'no_key')
    return snapshot('unsupported')
  }
  if (apiKey === undefined) return snapshot('no_key')

  const gated = timeoutSignal(options?.signal)
  try {
    const result = await queryBalance(
      connection.baseURL === '' ? DEFAULT_DEEPSEEK_BASE : connection.baseURL,
      apiKey,
      options?.fetch ?? fetch,
      gated.signal,
    )
    return snapshot(result.status, {
      balances: result.balances,
      ...result.accountAvailable === undefined ? {} : { accountAvailable: result.accountAvailable },
    })
  } finally {
    gated.cancel()
  }
}
