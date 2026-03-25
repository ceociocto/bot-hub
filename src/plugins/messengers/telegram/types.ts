// Telegram adapter types

export interface TelegramConfig {
  botToken: string
}

export interface SendMessageResult {
  message_id: number
  chat: {
    id: number
  }
}

export interface TelegramMessageUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: {
      id: number
      is_bot: boolean
      first_name: string
      username?: string
    }
    chat: {
      id: number
      type: 'private' | 'group' | 'supergroup' | 'channel'
      title?: string
      username?: string
    }
    date: number
    text?: string
    entities?: Array<{
      type: string
      offset: number
      length: number
    }>
  }
}
