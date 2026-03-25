// WeChat iLink Bot API Adapter
// Implements MessengerAdapter using the iLink HTTP API

import type { MessengerAdapter, Message, MessageContext } from '../../../core/types.js'
import { ILinkClient } from './ilink-client.js'
import type { Credentials, WeixinMessage, ContextTokenCache } from './ilink-types.js'
import { ILINK_ERRORS } from './ilink-types.js'
import { homedir } from 'os'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

const CREDENTIALS_FILE = join(homedir(), '.bot-hub', 'wechat-credentials.json')
const POLL_TIMEOUT = 30000 // 30 seconds
const CONTEXT_TOKEN_TTL = 5 * 60 * 1000 // 5 minutes

export class ILinkWeChatAdapter implements MessengerAdapter {
  readonly name = 'wechat-ilink'
  private client: ILinkClient
  private messageHandler?: (ctx: MessageContext) => Promise<void>
  private isRunning = false
  private pollState = {
    getUpdatesBuf: '',
    isPolling: false,
    lastPollTime: 0,
  }
  private contextTokens = new Map<string, ContextTokenCache>()

  constructor() {
    this.client = new ILinkClient()
  }

  // ============================================
  // Lifecycle
  // ============================================

  async start(): Promise<void> {
    // Load saved credentials
    const credentials = await this.loadCredentials()
    if (credentials) {
      this.client.setCredentials(credentials)
      console.log('✅ WeChat credentials loaded from cache')
    } else {
      throw new Error('No WeChat credentials found. Run "bot-hub config wechat" first.')
    }

    this.isRunning = true
    console.log('🚀 WeChat iLink adapter started')

    // Start polling in background
    this.startPolling()
  }

  async stop(): Promise<void> {
    this.isRunning = false
    this.client.clearCredentials()
    console.log('👋 WeChat iLink adapter stopped')
  }

  // ============================================
  // Message Handling
  // ============================================

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    if (!this.client.hasCredentials()) {
      throw new Error('WeChat adapter not authenticated')
    }

    // Extract user ID from threadId (format: user:xxx or room:xxx)
    const userId = threadId.replace(/^(user|room):/, '')

    // Get context token for this user
    const contextToken = this.getContextToken(userId)
    if (!contextToken) {
      throw new Error('No context token available for this user')
    }

    // Split long messages
    const chunks = this.splitMessage(text)

    for (const chunk of chunks) {
      const response = await this.client.sendMessage(userId, chunk, contextToken)

      if (response.ret !== 0 && response.ret !== undefined) {
        if (response.ret === ILINK_ERRORS.SESSION_EXPIRED) {
          throw new Error('WeChat session expired. Please re-login.')
        }
        throw new Error(`Failed to send message: ${response.errmsg || response.ret}`)
      }
    }
  }

  // ============================================
  // QR Code Login
  // ============================================

  /**
   * Start QR code login flow
   * Returns QR code URL and token for polling
   */
  async startQRLogin(): Promise<{ qrUrl: string; qrToken: string }> {
    const response = await this.client.getQRCode()
    return {
      qrUrl: response.qrcode_img_content,
      qrToken: response.qrcode,
    }
  }

  /**
   * Poll QR code status until confirmed or expired
   */
  async waitForQRLogin(
    qrToken: string,
    onStatus?: (status: string) => void
  ): Promise<Credentials | null> {
    const maxAttempts = 120 // 2 minutes with 1s interval
    let attempts = 0

    while (attempts < maxAttempts) {
      const status = await this.client.getQRCodeStatus(qrToken)

      switch (status.status) {
        case 'wait':
          onStatus?.('Waiting for scan...')
          break

        case 'scaned':
          onStatus?.('QR code scanned! Waiting for confirmation...')
          break

        case 'confirmed':
          if (status.bot_token && status.ilink_bot_id && status.ilink_user_id) {
            const credentials: Credentials = {
              bot_token: status.bot_token,
              baseUrl: status.baseurl || 'https://ilinkai.weixin.qq.com',
              accountId: status.ilink_bot_id,
              userId: status.ilink_user_id,
              savedAt: new Date().toISOString(),
            }

            // Save credentials
            await this.saveCredentials(credentials)
            this.client.setCredentials(credentials)

            onStatus?.('Login successful!')
            return credentials
          }
          break

        case 'expired':
          onStatus?.('QR code expired')
          return null
      }

      // Wait 1 second before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000))
      attempts++
    }

    return null
  }

  // ============================================
  // Polling
  // ============================================

  private startPolling(): void {
    if (this.pollState.isPolling) return

    this.pollState.isPolling = true
    this.pollLoop()
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const response = await this.client.getUpdates(this.pollState.getUpdatesBuf)

        if (response.ret === 0 && response.msgs) {
          // Update cursor
          this.pollState.getUpdatesBuf = response.get_updates_buf

          // Process messages
          for (const msg of response.msgs) {
            await this.handleIncomingMessage(msg)
          }
        } else if (response.ret === ILINK_ERRORS.SESSION_EXPIRED) {
          console.error('❌ WeChat session expired. Please re-login.')
          this.isRunning = false
          break
        }
      } catch (error) {
        console.error('[WeChat] Poll error:', error)
      }

      // Small delay between polls
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    this.pollState.isPolling = false
  }

  private async handleIncomingMessage(msg: WeixinMessage): Promise<void> {
    if (!this.messageHandler) return

    // Skip messages from bot itself (message_type: 2)
    if (msg.message_type === 2) return

    // Skip messages without text
    if (!msg.item_list?.length) return

    // Extract text from message items
    const textItems = msg.item_list.filter((item) => item.type === 1 && item.text_item?.text)
    if (!textItems.length) return

    const text = textItems.map((item) => item.text_item!.text).join('\n')

    // Store context token for replies
    if (msg.from_user_id && msg.context_token) {
      this.setContextToken(msg.from_user_id, msg.context_token)
    }

    // Build message object
    const message: Message = {
      id: String(msg.message_id || Date.now()),
      threadId: msg.group_id ? `room:${msg.group_id}` : `user:${msg.from_user_id}`,
      userId: msg.from_user_id || 'unknown',
      text,
      timestamp: new Date(msg.create_time_ms || Date.now()),
    }

    const ctx: MessageContext = {
      message,
      platform: 'wechat',
    }

    await this.messageHandler(ctx)
  }

  // ============================================
  // Context Token Management
  // ============================================

  private getContextToken(userId: string): string | null {
    const cached = this.contextTokens.get(userId)
    if (!cached) return null

    // Check if expired
    if (Date.now() - cached.timestamp > CONTEXT_TOKEN_TTL) {
      this.contextTokens.delete(userId)
      return null
    }

    return cached.contextToken
  }

  private setContextToken(userId: string, token: string): void {
    this.contextTokens.set(userId, {
      userId,
      contextToken: token,
      timestamp: Date.now(),
    })
  }

  // ============================================
  // Credentials Persistence
  // ============================================

  private async loadCredentials(): Promise<Credentials | null> {
    try {
      const data = await readFile(CREDENTIALS_FILE, 'utf-8')
      return JSON.parse(data) as Credentials
    } catch {
      return null
    }
  }

  private async saveCredentials(credentials: Credentials): Promise<void> {
    const dir = join(CREDENTIALS_FILE, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2))
    console.log(`Credentials saved to ${CREDENTIALS_FILE}`)
  }

  // ============================================
  // Utilities
  // ============================================

  private splitMessage(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLength) {
      // Try to split at newline
      let splitPoint = remaining.lastIndexOf('\n', maxLength)
      if (splitPoint < maxLength / 2) {
        splitPoint = maxLength
      }

      chunks.push(remaining.slice(0, splitPoint))
      remaining = remaining.slice(splitPoint).trim()
    }

    if (remaining) {
      chunks.push(remaining)
    }

    // Add continuation markers
    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length - 1; i++) {
        chunks[i] += '\n\n[continued...]'
      }
    }

    return chunks
  }
}

// Singleton instance
export const ilinkWeChatAdapter = new ILinkWeChatAdapter()
