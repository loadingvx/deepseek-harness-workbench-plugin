/** Structural slice of a DSH Agent that `/steer` actually touches. */
export interface SteerAgent {
  readonly status: 'idle' | 'running'
  steer(message: SteerUserMessage): void
}

/** User-role message queued into the agent's next-step inbox. */
export interface SteerUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  readonly source: { readonly kind: 'user' }
}

/** Invocation handed to the registered slash-command handler. */
export interface SteerInvocation {
  readonly agent: SteerAgent
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** Direct UI result. Matches `@deepseek-ai/dsh-commands` CommandResult. */
export type SteerCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** Registration payload accepted by `ctx.commands.register`. */
export interface SteerCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  readonly handler: (invocation: SteerInvocation) => SteerCommandResult
}
