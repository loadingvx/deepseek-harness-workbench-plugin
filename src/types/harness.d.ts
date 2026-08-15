declare module '@deepseek-ai/cordis' {
  export interface Context {
    effect(fn: () => (() => void) | void, name?: string): void
    on(event: string, handler: (...args: unknown[]) => unknown): () => void
    get(name: string): unknown
    tools: {
      register(tool: unknown): () => void
    }
    webServer?: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
      }): () => void
    }
    workspaceRegistry?: {
      get(id: string): { readonly path: string } | undefined
      list(): Array<{ readonly id: string; readonly path: string }>
    }
    locale: {
      register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
      bind(ns: string): (key: string, vars?: Record<string, string | number>) => string
    }
    sessions?: {
      binding(id: string): { session?: {
        prompt: (content: Array<{ type: string; text: string }>, mode: 'queue' | 'steer') => Promise<{ ok: boolean; error?: { message?: string } }>
        cancel: () => Promise<unknown>
        getSnapshot: () => { running?: boolean }
      } } | undefined
    }
    llm: {
      listProviders(): Array<{ id: string }>
      listModels(provider: string): Promise<Array<{ id: string }>>
      stream(options: Record<string, unknown>): AsyncIterable<{
        type?: string
        text?: string
        reason?: { kind?: string; failure?: { message?: string } }
      }>
    }
    slots: {
      inject(name: string, factory: () => unknown | Generator<unknown>): () => void
      register(spec: Record<string, unknown>, component: unknown): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolRunContext {
    signal: AbortSignal
    name: string
    agent?: {
      session?: {
        header?: {
          cwd?: string
        }
      }
    }
  }

  export interface ToolResult {
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
    meta?: unknown
  }

  export function defineTool<Args = Record<string, unknown>, Value = unknown>(options: {
    name: string
    description: string
    parameters: Record<string, {
      type: string
      required?: boolean
      description?: string
      enum?: readonly string[]
    }>
    output: {
      schema: unknown
      render: (args: Args, value: Value) => Array<{ type: 'text'; text: string }>
    }
    execute: (args: Args, exec: ToolRunContext) => Promise<Value>
    presentCall?: (args: Args) => unknown
    presentResult?: (args: Args, result: ToolResult) => unknown
  }): unknown
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export type SessionId = string
  export type ClientContext = import('@deepseek-ai/cordis').Context
  export interface ToolCallBlock {
    callId: string
    toolName?: string
    argsRaw?: string
    kind?: string
    isError?: boolean
    content?: Array<{ type: string; text?: string }>
    error?: { name?: string; code?: string }
    call?: { argsRaw?: string }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export interface SlotMap {
    [name: string]: unknown
  }
  export interface LocaleNamespaceMap {
    [name: string]: string
  }
  export type PropsRuntime<K extends string = string> = {
    wide?: boolean
    sessionId?: string
    useSession?: <T>(selector: (state: {
      nodes?: readonly unknown[]
      partial?: unknown
      running?: boolean
      runningCalls?: readonly unknown[]
      pending?: readonly unknown[]
      promptError?: { op?: string; error?: { message?: string } } | null
      lastAgentError?: string | null
      removed?: boolean
      blank?: boolean
      composerPhase?: string
    }) => T) => T
    useInput?: <T>(selector: (state: { draft: string; phase: string }) => T) => T
    inputActions?: {
      setDraft: (text: string) => void
      submit: () => void
    }
    useSessions: (selector: (state: {
      current?: string
    }) => unknown) => unknown
    useWorkspaces: (selector: (state: {
      items: Array<{
        workspaceId: string
        path: string
        title: string
        sessionIds: string[]
      }>
      recentWorkspaceId?: string
    }) => unknown) => unknown
  }
  export type PropsLocale<NS extends string = string> = {
    t: (key: string, vars?: Record<string, string | number>) => string
  }
  export type InjectFace<T> = T
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  export {}
}

declare module '@deepseek-ai/dsh-client-ui-tool/client' {
  export type ToolCallViewProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'tool.call.toolview'> & {
    block: import('@deepseek-ai/dsh-client-runtime/client').ToolCallBlock
    inspect?: () => void
    toolName: string
    callId: string
  }
}

declare module '@deepseek-ai/dsh-client-locale/client' {
  export {}
}

declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const Tooltip: (props: {
    label: string
    side?: string
    delayMs?: number
    children: import('react').ReactNode
  }) => import('react').ReactElement
}
