// WeChat iLink Bot API HTTP Client
// Pure HTTP wrapper for iLink API endpoints

import type {
  QRCodeResponse,
  QRCodeStatusResponse,
  Credentials,
  GetUpdatesRequest,
  GetUpdatesResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetConfigRequest,
  GetConfigResponse,
  SendTypingRequest,
  SendTypingResponse,
} from './ilink-types.js'

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CHANNEL_VERSION = '1.0.0'

export class ILinkClient {
  private baseUrl: string
  private botToken: string | null = null

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl
  }

  // ============================================
  // Authentication
  // ============================================

  /**
   * Get QR code for login
   */
  async getQRCode(): Promise<QRCodeResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`getQRCode failed: ${response.status}`)
    }
    return response.json() as Promise<QRCodeResponse>
  }

  /**
   * Poll QR code status
   */
  async getQRCodeStatus(qrcode: string): Promise<QRCodeStatusResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    const response = await fetch(url, {
      headers: {
        'iLink-App-ClientVersion': '1',
      },
    })
    if (!response.ok) {
      throw new Error(`getQRCodeStatus failed: ${response.status}`)
    }
    return response.json() as Promise<QRCodeStatusResponse>
  }

  /**
   * Set credentials after successful login
   */
  setCredentials(credentials: Credentials): void {
    this.botToken = credentials.bot_token
    if (credentials.baseUrl) {
      this.baseUrl = credentials.baseUrl
    }
  }

  /**
   * Clear credentials (logout)
   */
  clearCredentials(): void {
    this.botToken = null
  }

  /**
   * Check if credentials are set
   */
  hasCredentials(): boolean {
    return this.botToken !== null
  }

  // ============================================
  // Message Polling
  // ============================================

  /**
   * Get updates (long polling)
   */
  async getUpdates(getUpdatesBuf: string = ''): Promise<GetUpdatesResponse> {
    if (!this.botToken) {
      throw new Error('No credentials - need to login first')
    }

    const url = `${this.baseUrl}/ilink/bot/getupdates`
    const body: GetUpdatesRequest = {
      get_updates_buf: getUpdatesBuf,
      base_info: {
        channel_version: CHANNEL_VERSION,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`getUpdates failed: ${response.status}`)
    }

    return response.json() as Promise<GetUpdatesResponse>
  }

  // ============================================
  // Message Sending
  // ============================================

  /**
   * Send a text message
   */
  async sendMessage(
    toUserId: string,
    text: string,
    contextToken: string
  ): Promise<SendMessageResponse> {
    if (!this.botToken) {
      throw new Error('No credentials - need to login first')
    }

    const url = `${this.baseUrl}/ilink/bot/sendmessage`
    const body: SendMessageRequest = {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: `bot-hub:${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        context_token: contextToken,
        item_list: [
          {
            type: 1, // TEXT
            text_item: { text },
          },
        ],
      },
      base_info: {
        channel_version: CHANNEL_VERSION,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`sendMessage failed: ${response.status}`)
    }

    return response.json() as Promise<SendMessageResponse>
  }

  // ============================================
  // Typing Indicator
  // ============================================

  /**
   * Get typing ticket for a user
   */
  async getTypingTicket(
    userId: string,
    contextToken?: string
  ): Promise<string | null> {
    if (!this.botToken) {
      return null
    }

    const url = `${this.baseUrl}/ilink/bot/getconfig`
    const body: GetConfigRequest = {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: {
        channel_version: CHANNEL_VERSION,
      },
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as GetConfigResponse
      return data.ret === 0 ? data.typing_ticket || null : null
    } catch {
      return null
    }
  }

  /**
   * Send typing indicator
   */
  async sendTyping(
    userId: string,
    typingTicket: string,
    status: 1 | 2
  ): Promise<boolean> {
    if (!this.botToken) {
      return false
    }

    const url = `${this.baseUrl}/ilink/bot/sendtyping`
    const body: SendTypingRequest = {
      ilink_user_id: userId,
      typing_ticket: typingTicket,
      status,
      base_info: {
        channel_version: CHANNEL_VERSION,
      },
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        return false
      }

      const data = (await response.json()) as SendTypingResponse
      return data.ret === 0 || data.ret === undefined
    } catch {
      return false
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  private getAuthHeaders(): Record<string, string> {
    if (!this.botToken) {
      throw new Error('No bot token available')
    }

    // Generate X-WECHAT-UIN: random uint32 → decimal string → base64
    const randomUin = crypto.getRandomValues(new Uint32Array(1))[0]
    const uinBase64 = btoa(String(randomUin))

    return {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${this.botToken}`,
      'X-WECHAT-UIN': uinBase64,
    }
  }
}
