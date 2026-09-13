#!/usr/bin/env bash
# Smoke: /new must switch sessions.list.current before reporting success.
# No browser required — exercises the same faces the host injects.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

echo "==> unit: ultra-slash /new"
mise exec -- pnpm exec vitest run tests/ultra-slash-new-session.spec.ts tests/ultra-slash-slash-menu.spec.ts

echo "==> contract smoke (node)"
mise exec -- node --experimental-strip-types <<'NODE'
import {
  createAndOpenSession,
  newSlashMatchEnter,
  startNewSession,
} from './src/client/ultra-slash/new-session.ts'
import { translate } from './src/shared/ultra-slash/locales.ts'

function t(key, vars) {
  return translate('zh', key, vars)
}

function makeEnv({ createFails = false, openNoop = false } = {}) {
  let current = 's-old'
  const listeners = new Set()
  const notify = () => { for (const fn of listeners) fn() }
  const create = async () => {
    if (createFails) throw new Error('create failed')
    return 's-new'
  }
  const open = (id) => {
    if (openNoop) return
    current = id
    notify()
  }
  const sessions = {
    list: {
      getSnapshot: () => ({ current, phase: 'ready', byId: { 's-old': { updatedAt: 1 } } }),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    },
    create,
    open,
    binding: (id) => id === current || id === 's-new'
      ? { session: { prompt: async () => ({ ok: true }) } }
      : undefined,
  }
  const workspaces = {
    list: {
      getSnapshot: () => ({
        phase: 'ready',
        items: [{ workspaceId: 'ws1', sessionIds: ['s-old'], createdAt: '2026-01-01T00:00:00.000Z' }],
      }),
    },
  }
  const remote = {
    session: {
      create: async (req) => {
        const id = await create(req)
        return { ok: true, value: { sessionId: id } }
      },
    },
    agentPresets: {
      list: async () => ({
        ok: true,
        value: { presets: [{ id: 'standard' }, { id: 'ptc' }] },
      }),
    },
  }
  const uiWorkspace = {
    openSession: (id) => open(id),
    openWorkspace: async (workspaceId, beforeOpen) => {
      const id = await create({ workspaceId })
      beforeOpen?.(id)
      open(id)
    },
    startSession: () => {},
  }
  const get = (name) => {
    if (name === 'sessions') return sessions
    if (name === 'workspaces') return workspaces
    if (name === 'uiWorkspace') return uiWorkspace
    if (name === 'remote') return remote
    return undefined
  }
  return { get, readCurrent: () => current, uiWorkspace }
}

const warn = console.warn
console.warn = () => {}

// 1) Happy path switches current
{
  const env = makeEnv()
  const id = await createAndOpenSession(env.get, 'ws1')
  if (id !== 's-new' || env.readCurrent() !== 's-new') {
    throw new Error(`createAndOpenSession happy path failed: id=${id} current=${env.readCurrent()}`)
  }
}

// 2) Create failure falls back to startSession when it actually switches current
{
  const env = makeEnv({ createFails: true })
  env.uiWorkspace.startSession = () => {
    env.uiWorkspace.openSession('s-new')
  }
  const started = await startNewSession(env.get, 'hello')
  if (!started.ok || env.readCurrent() !== 's-new') {
    throw new Error(`create-fail must fall back to startSession: ${JSON.stringify(started)} current=${env.readCurrent()}`)
  }
}

// 2a) Create failure with no startSession must not pretend success
{
  const env = makeEnv({ createFails: true })
  env.uiWorkspace.startSession = undefined
  const started = await startNewSession(env.get, 'hello')
  if (started.ok || env.readCurrent() !== 's-old') {
    throw new Error(`create-fail without startSession must not succeed: ${JSON.stringify(started)} current=${env.readCurrent()}`)
  }
}

// 2b) Open that updates current only after a microtask still succeeds
{
  let current = 's-old'
  const listeners = new Set()
  const notify = () => { for (const fn of listeners) fn() }
  const openLater = (id) => {
    queueMicrotask(() => { current = id; notify() })
  }
  const get = (name) => {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => ({ current, phase: 'ready', byId: { 's-old': { updatedAt: 1 } } }),
          subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        },
        create: async () => 's-new',
        open: openLater,
        binding: () => undefined,
      }
    }
    if (name === 'workspaces') {
      return {
        list: {
          getSnapshot: () => ({
            phase: 'ready',
            items: [{ workspaceId: 'ws1', sessionIds: ['s-old'], createdAt: '2026-01-01T00:00:00.000Z' }],
          }),
        },
      }
    }
    if (name === 'uiWorkspace') {
      return {
        openSession: openLater,
        openWorkspace: async (workspaceId, beforeOpen) => {
          const id = await create({ workspaceId })
          beforeOpen?.(id)
          openLater(id)
        },
        startSession: () => {},
      }
    }
    return undefined
  }
  const id = await createAndOpenSession(get, 'ws1')
  if (id !== 's-new' || current !== 's-new') {
    throw new Error(`microtask open settle failed: id=${id} current=${current}`)
  }
}

// 3) Open noop + no startSession → claim returns unavailable
{
  const env = makeEnv({ openNoop: true })
  env.uiWorkspace.startSession = undefined
  const matchEnter = newSlashMatchEnter(env.get, t)
  const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
  const result = await outcome.claim.submit('hello')
  if (result.kind !== 'error' || env.readCurrent() !== 's-old') {
    throw new Error(`claim must error when current stuck: ${JSON.stringify(result)} current=${env.readCurrent()}`)
  }
}

// 3b) Open noop + noop startSession → claim must not pretend success for /new hello
{
  const env = makeEnv({ openNoop: true })
  env.uiWorkspace.startSession = () => {}
  const matchEnter = newSlashMatchEnter(env.get, t)
  const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
  const result = await outcome.claim.submit('hello')
  if (result.kind !== 'error' || env.readCurrent() !== 's-old') {
    throw new Error(`claim must error when session stuck: ${JSON.stringify(result)} current=${env.readCurrent()}`)
  }
}

// 4) Bare /new is not claimed by plugin matchEnter
{
  const matchEnter = newSlashMatchEnter(() => undefined, t)
  const bare = await matchEnter({}, '/new', new AbortController().signal)
  if (bare !== undefined) throw new Error('bare /new must leave command source')
}

// 5) Claim success only after switch
{
  const env = makeEnv()
  const matchEnter = newSlashMatchEnter(env.get, t)
  const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
  const result = await outcome.claim.submit('hello')
  if (result.kind !== 'success' || env.readCurrent() !== 's-new') {
    throw new Error(`claim success requires switch: ${JSON.stringify(result)} current=${env.readCurrent()}`)
  }
}

console.warn = warn
console.log('contract smoke ok')
NODE

echo "==> build lib"
bash devops/build.sh

echo "==> assert bundle contains async /new guardrails"
if ! grep -q 'current did not switch after open' lib/client.js; then
  echo "lib/client.js missing current-switch guard" >&2
  exit 1
fi
if ! grep -q 'sessions.create failed' lib/client.js; then
  echo "lib/client.js missing create-fail guard" >&2
  exit 1
fi
if ! grep -q 'command/executed' lib/client.js; then
  echo "lib/client.js missing command/executed listener" >&2
  exit 1
fi

echo "smoke-new-session: PASS"
