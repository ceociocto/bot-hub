// WeChat iLink Bot API Types
// Based on: https://github.com/epiral/weixin-bot/blob/main/docs/protocol-spec.md

// ============================================
// Authentication Types
// ============================================

export interface QRCodeResponse {
  qrcode: string // Polling token
  qrcode_img_content: string // QR URL
}

export type QRCodeStatus = 'wait' | 'scaned' | 'confirmed' | 'expired'

export interface QRCodeStatusResponse {
  status: QRCodeStatus
  bot_token?: string
  ilink_bot_id?: string // Format: ...@im.bot
  ilink_user_id?: string // Format: ...@im.wechat
  baseurl?: string
}

export interface Credentials {
  bot_token: string
  baseUrl: string
  accountId: string // ilink_bot_id
  userId: string // ilink_user_id
  savedAt: string
}

// ============================================
// Message Types
// ============================================

export type MessageType = 1 | 2 // 1 = USER, 2 = BOT
export type MessageState = 0 | 1 | 2 // 0 = NEW, 1 = GENERATING, 2 = FINISH

export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number // 0 = file id only, 1 = with thumbnails
}

export interface TextItem {
  text?: string
}

export interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

export interface VoiceItem {
  media?: CDNMedia
  encode_type?: number // 6 = SILK
  bits_per_sample?: number
  sample_rate?: number
  playtime?: number
  text?: string // Transcription
}

export interface FileItem {
  media?: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export interface VideoItem {
  media?: CDNMedia
  video_size?: number
  play_length?: number
  video_md5?: string
  thumb_media?: CDNMedia
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
}

export interface RefMessage {
  title?: string
  message_item?: MessageItem
}

export interface MessageItem {
  type?: number // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMessage
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

export interface WeixinMessage {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  create_time_ms?: number
  update_time_ms?: number
  delete_time_ms?: number
  session_id?: string
  group_id?: string
  message_type?: MessageType
  message_state?: MessageState
  item_list?: MessageItem[]
  context_token?: string // CRITICAL: Required for replies
}

// ============================================
// API Request/Response Types
// ============================================

export interface GetUpdatesRequest {
  get_updates_buf: string // Opaque cursor, empty string on first call
  base_info: {
    channel_version: string
  }
  sync_buf?: string // Deprecated
}

export interface GetUpdatesResponse {
  ret: number
  msgs?: WeixinMessage[]
  get_updates_buf: string // Next cursor
  longpolling_timeout_ms?: number
  errcode?: number
  errmsg?: string
}

export interface SendMessageRequest {
  msg: {
    from_user_id: string // Usually empty for bot
    to_user_id: string // User to reply to
    client_id: string // Unique message ID
    message_type: MessageType // 2 for BOT
    message_state: MessageState // 2 for FINISH
    context_token: string // From received message
    item_list: MessageItem[]
  }
  base_info: {
    channel_version: string
  }
}

export interface SendMessageResponse {
  ret?: number
  errcode?: number
  errmsg?: string
}

export interface GetConfigRequest {
  ilink_user_id: string
  context_token?: string
  base_info: {
    channel_version: string
  }
}

export interface GetConfigResponse {
  ret: number
  typing_ticket?: string
}

export interface SendTypingRequest {
  ilink_user_id: string
  typing_ticket: string
  status: 1 | 2 // 1 = start, 2 = stop
  base_info: {
    channel_version: string
  }
}

export interface SendTypingResponse {
  ret?: number
  errcode?: number
  errmsg?: string
}

// ============================================
// Error Codes
// ============================================

export const ILINK_ERRORS = {
  SESSION_EXPIRED: -14, // Need to re-login
  NETWORK_ERROR: -1,
  INVALID_PARAMS: -2,
  RATE_LIMITED: -3,
} as const

// ============================================
// Internal Types
// ============================================

export interface PollState {
  getUpdatesBuf: string
  isPolling: boolean
  lastPollTime: number
}

export interface ContextTokenCache {
  userId: string
  contextToken: string
  timestamp: number
}
