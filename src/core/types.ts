// bot-hub core types

/**
 * Message received from a messenger platform
 */
export interface Message {
  id: string
  threadId: string
  userId: string
  text: string
  timestamp: Date
}

/**
 * Discriminated union for parsed messages
 * Each variant has a unique `type` field for type-safe pattern matching
 */
export type ParsedMessage =
  | { type: 'default'; prompt: string }
  | { type: 'command'; command: 'status' | 'help' | 'agents' }
  | { type: 'agent'; agent: string; prompt: string }
  | { type: 'error'; prompt: string; error: string }

/**
 * Message context passed through the processing pipeline
 */
export interface MessageContext {
  message: Message
  platform: string
  agent?: string
  session?: Session
}

/**
 * Session state for a conversation
 * Keyed by `${platform}:${threadId}` for uniqueness
 */
export interface Session {
  id: string
  threadId: string
  platform: string
  agent: string
  createdAt: Date
  lastActivity: Date
  ttl: number
}

/**
 * Adapter interface for messenger platforms (WeChat, Feishu, Telegram)
 */
export interface MessengerAdapter {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (ctx: MessageContext) => Promise<void>): void
  sendMessage(threadId: string, text: string): Promise<void>
  /**
   * Send typing indicator to show the bot is processing
   * @param threadId - The conversation thread ID
   * @param isTyping - true to start typing indicator, false to stop
   */
  sendTyping?(threadId: string, isTyping: boolean): Promise<void>
}

/**
 * Adapter interface for AI coding agents (Claude Code, Codex, Copilot)
 *
 * sendPrompt returns an AsyncGenerator for streaming responses.
 * Each yielded string is a complete message chunk.
 * The generator throws on error — caller catches and handles.
 */
export interface AgentAdapter {
  readonly name: string
  readonly aliases: string[]
  sendPrompt(sessionId: string, prompt: string): AsyncGenerator<string>
  isAvailable(): Promise<boolean>
}

/**
 * Configuration for the bot-hub instance
 */
export interface Config {
  messengers: string[]
  agents: string[]
  defaultAgent: string
  [key: string]: unknown
}
