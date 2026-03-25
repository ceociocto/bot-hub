// Telegram Bot API Adapter using grammy
// Implements MessengerAdapter interface with native typing indicator support

import { Bot, Context } from 'grammy'
import type { MessengerAdapter, MessageContext, Message } from '../../../core/types.js'
import type { TelegramConfig } from './types.js'
import { markdownToTelegramHtml } from './markdown-to-html.js'
import { splitMessage } from '../../../utils/message-split.js'

export class TelegramAdapter implements MessengerAdapter {
  readonly name = 'telegram'
  private bot: Bot | null = null
  private config: TelegramConfig | null = null
  private messageHandler?: (ctx: MessageContext) => Promise<void>
  private isRunning = false
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>()

  async start(): Promise<void> {
    // Load config
    const { readFile } = await import('fs/promises')
    const { homedir } = await import('os')
    const { join } = await import('path')

    const configPath = join(homedir(), '.im-hub', 'config.json')
    try {
      const data = await readFile(configPath, 'utf-8')
      const config = JSON.parse(data)
      this.config = config.telegram as TelegramConfig
    } catch {
      throw new Error('Telegram config not found. Run "im-hub config telegram" first.')
    }

    if (!this.config?.botToken) {
      throw new Error('Telegram bot token not configured. Run "im-hub config telegram" first.')
    }

    // Initialize bot
    this.bot = new Bot(this.config.botToken)

    // Set up message handler
    this.bot.on('message:text', async (ctx) => {
      // Ignore messages from bots
      if (ctx.message.from.is_bot) {
        return
      }

      if (!this.messageHandler) {
        return
      }

      const message: Message = {
        id: ctx.message.message_id.toString(),
        threadId: ctx.chat.id.toString(),
        userId: ctx.message.from?.id?.toString() || 'unknown',
        text: ctx.message.text || '',
        timestamp: new Date(ctx.message.date * 1000),
      }

      const msgCtx: MessageContext = {
        message,
        platform: 'telegram',
      }

      await this.messageHandler(msgCtx)
    })

    await this.bot.start()
    this.isRunning = true
    console.log('🚀 Telegram adapter started')
  }

  async stop(): Promise<void> {
    this.isRunning = false

    // Clean up all typing intervals
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval)
    }
    this.typingIntervals.clear()

    if (this.bot) {
      await this.bot.stop()
      this.bot = null
    }

    console.log('👋 Telegram adapter stopped')
  }

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram adapter not started')
    }

    const htmlText = markdownToTelegramHtml(text)
    const chunks = splitMessage(htmlText, { maxLength: 4000, addContinuationMarker: false })

    for (const chunk of chunks) {
      await this.bot.api.sendMessage(threadId, chunk, { parse_mode: 'HTML' })
    }
  }

  async sendTyping(threadId: string, isTyping: boolean): Promise<void> {
    if (!this.bot) {
      return
    }

    if (isTyping) {
      // Send initial typing action
      try {
        await this.bot.api.sendChatAction(threadId, 'typing')
      } catch {
        // Ignore errors during typing
      }

      // Clear any existing interval
      const existing = this.typingIntervals.get(threadId)
      if (existing) {
        clearInterval(existing)
      }

      // Set up periodic refresh every 4 seconds (Telegram expires after ~5s)
      const interval = setInterval(async () => {
        try {
          await this.bot!.api.sendChatAction(threadId, 'typing')
        } catch {
          // Ignore errors during typing refresh
        }
      }, 4000)

      this.typingIntervals.set(threadId, interval)
    } else {
      // Clear the refresh interval
      const interval = this.typingIntervals.get(threadId)
      if (interval) {
        clearInterval(interval)
        this.typingIntervals.delete(threadId)
      }
      // Note: Telegram has no "cancel" action - typing just expires
    }
  }
}

// Singleton instance
export const telegramAdapter = new TelegramAdapter()
