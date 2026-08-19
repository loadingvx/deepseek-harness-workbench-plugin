import { redactSecrets } from '../../shared/redact.ts'
import type {
  BrowserAppInfo,
  BrowserCssSheet,
  BrowserCssVar,
  BrowserFileEntry,
  BrowserNetEntry,
} from '../../shared/browser-devtools.ts'
import {
  BROWSER_NET_MAX,
  normalizeAppInfo,
  normalizeCssDump,
  normalizeFileEntries,
  normalizeNetEntries,
} from '../../shared/browser-devtools.ts'

export interface BrowserPageInfo {
  url: string
  title: string
  ua: string
  viewport: { w: number; h: number }
  secure?: boolean
  cookiesEnabled?: boolean
}

export type BrowserConsoleKind = 'log' | 'command' | 'result'

export interface BrowserConsoleLine {
  id: number
  level: 'log' | 'info' | 'warn' | 'error'
  kind: BrowserConsoleKind
  text: string
  at: number
}

export interface BrowserEvalRequest {
  nonce: number
  code: string
}

export type BrowserLoadStatus = 'idle' | 'loading' | 'ok' | 'fail'

export interface BrowserTabState {
  input: string
  committed: string
  title: string
  history: string[]
  historyIndex: number
  inspect: boolean
  status: BrowserLoadStatus
  failMessage: string
  failHint: string
  page: BrowserPageInfo | null
  console: BrowserConsoleLine[]
  network: BrowserNetEntry[]
  app: BrowserAppInfo | null
  cssSheets: BrowserCssSheet[]
  cssVars: BrowserCssVar[]
  files: BrowserFileEntry[]
  evalRequest: BrowserEvalRequest | null
  probeRequest: { nonce: number } | null
}

const CONSOLE_MAX = 200
const EVAL_MAX = 8_000

const listeners = new Set<() => void>()
const tabs = new Map<string, BrowserTabState>()
let activeId: string | null = null
let consoleSeq = 0
let evalNonce = 0
let probeNonce = 0

function emit(): void {
  for (const listener of listeners) listener()
}

function emptyState(): BrowserTabState {
  return {
    input: '',
    committed: '',
    title: '',
    history: [],
    historyIndex: -1,
    inspect: false,
    status: 'idle',
    failMessage: '',
    failHint: '',
    page: null,
    console: [],
    network: [],
    app: null,
    cssSheets: [],
    cssVars: [],
    files: [],
    evalRequest: null,
    probeRequest: null,
  }
}

/** Shared empty snapshot. useSyncExternalStore requires getSnapshot to return the same reference when nothing changed. */
const EMPTY_TAB: BrowserTabState = emptyState()

function hydrateState(state: BrowserTabState): BrowserTabState {
  const base = emptyState()
  return {
    ...base,
    ...state,
    console: Array.isArray(state.console) ? state.console : base.console,
    network: Array.isArray(state.network) ? state.network : base.network,
    app: state.app === null || state.app === undefined ? null : normalizeAppInfo(state.app),
    cssSheets: Array.isArray(state.cssSheets) ? state.cssSheets : base.cssSheets,
    cssVars: Array.isArray(state.cssVars) ? state.cssVars : base.cssVars,
    files: Array.isArray(state.files) ? state.files : base.files,
  }
}

function writeTab(id: string, next: BrowserTabState): void {
  tabs.set(id, hydrateState(next))
  emit()
}

export function subscribeBrowserSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getActiveBrowserId(): string | null {
  return activeId
}

export function setActiveBrowserId(id: string | null): void {
  if (activeId === id) return
  activeId = id
  emit()
}

function tabOf(id: string): BrowserTabState {
  return tabs.get(id) ?? EMPTY_TAB
}

export function readBrowserTab(id: string): BrowserTabState {
  return tabOf(id)
}

export function readActiveBrowserTab(): BrowserTabState {
  return activeId === null ? EMPTY_TAB : readBrowserTab(activeId)
}

export function ensureBrowserTab(id: string): BrowserTabState {
  const current = tabs.get(id)
  if (current !== undefined) return current
  const next = emptyState()
  tabs.set(id, next)
  emit()
  return next
}

export function dropBrowserTab(id: string): void {
  tabs.delete(id)
  if (activeId === id) activeId = null
  emit()
}

export function patchBrowserTab(id: string, patch: Partial<BrowserTabState>): void {
  writeTab(id, { ...tabOf(id), ...patch })
}

export function commitBrowserUrl(id: string, url: string): void {
  const current = tabOf(id)
  const history = current.history.slice(0, current.historyIndex + 1)
  if (history[history.length - 1] !== url) history.push(url)
  writeTab(id, {
    ...current,
    input: url,
    committed: url,
    history,
    historyIndex: history.length - 1,
    status: 'loading',
    failMessage: '',
    failHint: '',
    network: [],
    app: null,
    cssSheets: [],
    cssVars: [],
    files: [],
  })
}

export function goBrowserHistory(id: string, delta: -1 | 1): string | null {
  const current = tabs.get(id)
  if (current === undefined) return null
  const nextIndex = current.historyIndex + delta
  const url = current.history[nextIndex]
  if (url === undefined) return null
  writeTab(id, {
    ...current,
    historyIndex: nextIndex,
    input: url,
    committed: url,
    status: 'loading',
    failMessage: '',
    failHint: '',
    network: [],
    app: null,
    cssSheets: [],
    cssVars: [],
    files: [],
  })
  return url
}

export function canBrowserBack(state: BrowserTabState): boolean {
  return state.historyIndex > 0
}

export function canBrowserForward(state: BrowserTabState): boolean {
  return state.historyIndex >= 0 && state.historyIndex < state.history.length - 1
}

export function pushBrowserConsole(
  id: string,
  level: BrowserConsoleLine['level'],
  text: string,
  kind: BrowserConsoleKind = 'log',
): void {
  const current = tabOf(id)
  consoleSeq += 1
  const line: BrowserConsoleLine = {
    id: consoleSeq,
    level,
    kind,
    text: redactSecrets(text).slice(0, 2000),
    at: Date.now(),
  }
  const console = [...(Array.isArray(current.console) ? current.console : []), line].slice(-CONSOLE_MAX)
  writeTab(id, { ...current, console })
}

export function requestBrowserEval(id: string, code: string): boolean {
  const trimmed = code.trim()
  if (trimmed === '') return false
  ensureBrowserTab(id)
  evalNonce += 1
  pushBrowserConsole(id, 'log', trimmed.slice(0, EVAL_MAX), 'command')
  writeTab(id, {
    ...tabOf(id),
    evalRequest: { nonce: evalNonce, code: trimmed.slice(0, EVAL_MAX) },
  })
  return true
}

export function beginBrowserLoad(id: string): void {
  const current = tabs.get(id)
  if (current === undefined) return
  writeTab(id, {
    ...current,
    status: 'loading',
    network: [],
    app: null,
    cssSheets: [],
    cssVars: [],
    files: [],
  })
}

export function upsertBrowserNetwork(id: string, raw: unknown): void {
  const incoming = normalizeNetEntries(raw)
  if (incoming.length === 0) return
  const current = tabOf(id)
  const network = Array.isArray(current.network) ? current.network.slice() : []
  for (const entry of incoming) {
    const idx = network.findIndex(row => row.id === entry.id)
    if (idx === -1) network.push(entry)
    else network[idx] = { ...network[idx], ...entry }
  }
  writeTab(id, { ...current, network: network.slice(-BROWSER_NET_MAX) })
}

export function setBrowserApp(id: string, raw: unknown): void {
  writeTab(id, { ...tabOf(id), app: normalizeAppInfo(raw) })
}

export function setBrowserCss(id: string, raw: unknown): void {
  const dump = normalizeCssDump(raw)
  writeTab(id, { ...tabOf(id), cssSheets: dump.sheets, cssVars: dump.vars })
}

export function setBrowserFiles(id: string, raw: unknown): void {
  writeTab(id, { ...tabOf(id), files: normalizeFileEntries(raw) })
}

export function clearBrowserNetwork(id: string): void {
  const current = tabs.get(id)
  if (current === undefined) return
  writeTab(id, { ...current, network: [] })
}

export function requestBrowserProbe(id: string): boolean {
  const current = tabs.get(id)
  if (current === undefined || current.committed === '') return false
  probeNonce += 1
  writeTab(id, { ...current, probeRequest: { nonce: probeNonce } })
  return true
}

export function consumeBrowserProbe(id: string, nonce: number): boolean {
  const current = tabs.get(id)
  if (current === undefined || current.probeRequest === null || current.probeRequest.nonce !== nonce) return false
  writeTab(id, { ...current, probeRequest: null })
  return true
}

export function clearBrowserConsole(id: string): void {
  const current = tabs.get(id)
  if (current === undefined) return
  writeTab(id, { ...current, console: [] })
}

/** Test helper. */
export function resetBrowserSession(): void {
  tabs.clear()
  activeId = null
  consoleSeq = 0
  evalNonce = 0
  probeNonce = 0
  emit()
}
