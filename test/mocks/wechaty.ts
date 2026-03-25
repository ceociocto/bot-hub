// Mock wechaty for testing WeChat adapter

export interface MockWechatyOptions {
  shouldFailStart?: boolean
  shouldFailLogin?: boolean
}

export function createMockWechaty(options: MockWechatyOptions = {}) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  const mockContact = {
    say: vi.fn().mockResolvedValue(undefined),
    name: () => 'Test User',
  }

  const mockRoom = {
    say: vi.fn().mockResolvedValue(undefined),
    topic: () => 'Test Room',
  }

  const mockMessage = {
    talker: () => mockContact,
    room: () => null,
    text: () => 'test message',
    say: vi.fn().mockResolvedValue(undefined),
  }

  return {
    start: vi.fn().mockImplementation(async () => {
      if (options.shouldFailStart) {
        throw new Error('Failed to start')
      }
      // Simulate login event
      const loginHandlers = handlers.get('login') || new Set()
      loginHandlers.forEach(h => h(mockContact))
    }),

    stop: vi.fn().mockResolvedValue(undefined),

    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set())
      }
      handlers.get(event)!.add(handler)
    }),

    emit: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
      const eventHandlers = handlers.get(event) || new Set()
      eventHandlers.forEach(h => h(...args))
    }),

    say: vi.fn().mockResolvedValue(undefined),

    // Expose mocks for assertions
    _mocks: {
      handlers,
      mockContact,
      mockRoom,
      mockMessage,
    },
  }
}

// Mock factory for wechaty module
export function mockWechatyModule(options: MockWechatyOptions = {}) {
  const mockWechaty = createMockWechaty(options)

  return {
    WechatyBuilder: {
      build: vi.fn().mockReturnValue(mockWechaty),
    },
    _mockWechaty: mockWechaty,
  }
}
