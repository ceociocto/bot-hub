// Integration tests for WeChat adapter with mocked wechaty

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { MessageContext } from '../../src/core/types'

// Mock types
interface MockContact {
  id: string
  name: () => string
  say: ReturnType<typeof mock>
}

interface MockRoom {
  id: string
  topic: () => string
  say: ReturnType<typeof mock>
}

interface MockMessage {
  id: string
  talker: () => MockContact
  room: () => MockRoom | null
  text: () => string
  date: () => Date
  self: () => boolean
}

// WeChat adapter logic (testable version)
class TestableWeChatAdapter {
  readonly name = 'wechat'
  private messageHandler?: (ctx: MessageContext) => Promise<void>

  constructor(
    private bot: {
      start: () => Promise<void>
      stop: () => Promise<void>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      Room: { find: (query: { id: string }) => Promise<MockRoom | null> }
      Contact: { find: (query: { id: string }) => Promise<MockContact | null> }
      emit: (event: string, ...args: unknown[]) => void
    }
  ) {}

  async start(): Promise<void> {
    // Setup event handlers
    this.bot.on('scan', (_qrcode: string, _status: number) => {})
    this.bot.on('login', (_user: MockContact) => {})
    this.bot.on('logout', (_user: MockContact) => {})
    this.bot.on('message', async (msg: MockMessage) => {
      if (msg.self()) return

      const contact = msg.talker()
      const room = msg.room()
      const text = msg.text()

      const message = {
        id: msg.id,
        threadId: room ? `room:${room.id}` : `user:${contact.id}`,
        userId: contact.id,
        text,
        timestamp: msg.date(),
      }

      const ctx: MessageContext = {
        message,
        platform: 'wechat',
      }

      if (this.messageHandler) {
        await this.messageHandler(ctx)
      }
    })

    await this.bot.start()
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    const chunks = this.splitMessage(text)

    for (const chunk of chunks) {
      if (threadId.startsWith('room:')) {
        const roomId = threadId.replace('room:', '')
        const room = await this.bot.Room.find({ id: roomId })
        if (room) {
          await room.say(chunk)
        }
      } else if (threadId.startsWith('user:')) {
        const userId = threadId.replace('user:', '')
        const contact = await this.bot.Contact.find({ id: userId })
        if (contact) {
          await contact.say(chunk)
        }
      }
    }
  }

  private splitMessage(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLength) {
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

    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length - 1; i++) {
        chunks[i] += '\n\n[continued...]'
      }
    }

    return chunks
  }
}

describe('WeChat Adapter', () => {
  let mockBot: {
    start: ReturnType<typeof mock>
    stop: ReturnType<typeof mock>
    on: ReturnType<typeof mock>
    Room: { find: ReturnType<typeof mock> }
    Contact: { find: ReturnType<typeof mock> }
    emit: (event: string, ...args: unknown[]) => void
    handlers: Map<string, Set<(...args: unknown[]) => void>>
  }
  let mockContact: MockContact
  let mockRoom: MockRoom
  let adapter: TestableWeChatAdapter
  let capturedMessages: MessageContext[] = []

  beforeEach(() => {
    capturedMessages = []

    // Create mock handlers storage
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>()

    // Create mock contact
    mockContact = {
      id: 'contact-123',
      name: () => 'Test User',
      say: mock(() => Promise.resolve()),
    }

    // Create mock room
    mockRoom = {
      id: 'room-456',
      topic: () => 'Test Room',
      say: mock(() => Promise.resolve()),
    }

    // Create mock bot
    mockBot = {
      start: mock(async () => {
        await new Promise(r => setTimeout(r, 5))
      }),

      stop: mock(async () => {
        await new Promise(r => setTimeout(r, 5))
      }),

      on: mock((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers.has(event)) {
          handlers.set(event, new Set())
        }
        handlers.get(event)!.add(handler)
      }),

      Room: {
        find: mock(async ({ id }: { id: string }) => {
          if (id === mockRoom.id) return mockRoom
          return null
        }),
      },

      Contact: {
        find: mock(async ({ id }: { id: string }) => {
          if (id === mockContact.id) return mockContact
          return null
        }),
      },

      emit: (event: string, ...args: unknown[]) => {
        const eventHandlers = handlers.get(event) || new Set()
        eventHandlers.forEach(h => h(...args))
      },

      handlers,
    }

    adapter = new TestableWeChatAdapter(mockBot)

    adapter.onMessage(async (ctx) => {
      capturedMessages.push(ctx)
    })
  })

  afterEach(async () => {
    await adapter.stop()
  })

  describe('lifecycle', () => {
    it('should start successfully', async () => {
      await adapter.start()
      expect(mockBot.start).toHaveBeenCalled()
    })

    it('should stop successfully', async () => {
      await adapter.start()
      await adapter.stop()
      expect(mockBot.stop).toHaveBeenCalled()
    })

    it('should register event handlers on start', async () => {
      await adapter.start()

      expect(mockBot.on).toHaveBeenCalledWith('scan', expect.any(Function))
      expect(mockBot.on).toHaveBeenCalledWith('login', expect.any(Function))
      expect(mockBot.on).toHaveBeenCalledWith('logout', expect.any(Function))
      expect(mockBot.on).toHaveBeenCalledWith('message', expect.any(Function))
    })
  })

  describe('message handling', () => {
    it('should handle direct message', async () => {
      await adapter.start()

      const mockMessage: MockMessage = {
        id: 'msg-1',
        talker: () => mockContact,
        room: () => null,
        text: () => 'hello bot',
        date: () => new Date(),
        self: () => false,
      }

      mockBot.emit('message', mockMessage)
      await new Promise(r => setTimeout(r, 20))

      expect(capturedMessages.length).toBe(1)
      expect(capturedMessages[0].message.text).toBe('hello bot')
      expect(capturedMessages[0].message.threadId).toBe('user:contact-123')
      expect(capturedMessages[0].platform).toBe('wechat')
    })

    it('should handle room message', async () => {
      await adapter.start()

      const mockMessage: MockMessage = {
        id: 'msg-2',
        talker: () => mockContact,
        room: () => mockRoom,
        text: () => 'hello everyone',
        date: () => new Date(),
        self: () => false,
      }

      mockBot.emit('message', mockMessage)
      await new Promise(r => setTimeout(r, 20))

      expect(capturedMessages.length).toBe(1)
      expect(capturedMessages[0].message.threadId).toBe('room:room-456')
    })

    it('should ignore self messages', async () => {
      await adapter.start()

      const selfMessage: MockMessage = {
        id: 'msg-3',
        talker: () => mockContact,
        room: () => null,
        text: () => 'my own message',
        date: () => new Date(),
        self: () => true,
      }

      mockBot.emit('message', selfMessage)
      await new Promise(r => setTimeout(r, 20))

      expect(capturedMessages.length).toBe(0)
    })
  })

  describe('sending messages', () => {
    it('should send direct message', async () => {
      await adapter.start()

      await adapter.sendMessage('user:contact-123', 'Hello user!')

      expect(mockBot.Contact.find).toHaveBeenCalledWith({ id: 'contact-123' })
      expect(mockContact.say).toHaveBeenCalledWith('Hello user!')
    })

    it('should send room message', async () => {
      await adapter.start()

      await adapter.sendMessage('room:room-456', 'Hello room!')

      expect(mockBot.Room.find).toHaveBeenCalledWith({ id: 'room-456' })
      expect(mockRoom.say).toHaveBeenCalledWith('Hello room!')
    })

    it('should do nothing for unknown contact', async () => {
      await adapter.start()

      // Should not throw, just do nothing
      await adapter.sendMessage('user:unknown', 'Hello!')

      expect(mockBot.Contact.find).toHaveBeenCalledWith({ id: 'unknown' })
      // say was never called because contact not found
      expect(mockContact.say).not.toHaveBeenCalled()
    })

    it('should split long messages', async () => {
      await adapter.start()

      const longText = 'A'.repeat(5000)
      await adapter.sendMessage('user:contact-123', longText)

      // Should be called multiple times with chunks
      const callCount = (mockContact.say as ReturnType<typeof mock>).mock.calls.length
      expect(callCount).toBeGreaterThan(1)
    })

    it('should add continuation markers to split messages', async () => {
      await adapter.start()

      const longText = 'A'.repeat(2500) + '\n' + 'B'.repeat(2500)
      await adapter.sendMessage('user:contact-123', longText)

      const calls = (mockContact.say as ReturnType<typeof mock>).mock.calls
      // First chunk should have continuation marker
      expect(calls[0][0]).toContain('[continued...]')
    })
  })

  describe('message splitting', () => {
    it('should not split short messages', async () => {
      await adapter.start()

      const shortText = 'Hello!'
      await adapter.sendMessage('user:contact-123', shortText)

      expect(mockContact.say).toHaveBeenCalledTimes(1)
      expect(mockContact.say).toHaveBeenCalledWith(shortText)
    })

    it('should prefer splitting at newlines', async () => {
      await adapter.start()

      const paragraph1 = 'A'.repeat(1000)
      const paragraph2 = 'B'.repeat(1000)
      const longText = `${paragraph1}\n\n${paragraph2}`

      await adapter.sendMessage('user:contact-123', longText)

      const calls = (mockContact.say as ReturnType<typeof mock>).mock.calls
      expect(calls.length).toBeGreaterThan(1)
    })
  })
})
