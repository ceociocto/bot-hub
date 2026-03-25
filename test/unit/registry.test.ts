// Unit tests for plugin registry

import { describe, it, expect, beforeEach, vi } from 'bun:test'
import type { MessengerAdapter, AgentAdapter, MessageContext } from '../../src/core/types'

// Create fresh registry for each test
class TestRegistry {
  private messengers = new Map<string, MessengerAdapter>()
  private agents = new Map<string, AgentAdapter>()
  private agentAliases = new Map<string, string>()

  registerMessenger(adapter: MessengerAdapter): void {
    if (this.messengers.has(adapter.name)) {
      console.warn(`Messenger "${adapter.name}" already registered, overwriting`)
    }
    this.messengers.set(adapter.name, adapter)
  }

  registerAgent(adapter: AgentAdapter): void {
    if (this.agents.has(adapter.name)) {
      console.warn(`Agent "${adapter.name}" already registered, overwriting`)
    }
    this.agents.set(adapter.name, adapter)

    for (const alias of adapter.aliases) {
      if (this.agentAliases.has(alias)) {
        console.warn(`Agent alias "${alias}" already registered, overwriting`)
      }
      this.agentAliases.set(alias, adapter.name)
    }
  }

  getMessenger(name: string): MessengerAdapter | undefined {
    return this.messengers.get(name)
  }

  getAgent(name: string): AgentAdapter | undefined {
    return this.agents.get(name)
  }

  findAgent(nameOrAlias: string): AgentAdapter | undefined {
    const agent = this.agents.get(nameOrAlias)
    if (agent) return agent

    const realName = this.agentAliases.get(nameOrAlias)
    if (realName) {
      return this.agents.get(realName)
    }

    return undefined
  }

  listMessengers(): string[] {
    return Array.from(this.messengers.keys())
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys())
  }
}

// Mock adapters
const mockMessenger: MessengerAdapter = {
  name: 'test-messenger',
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  onMessage: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}

const mockAgent: AgentAdapter = {
  name: 'test-agent',
  aliases: ['ta', 'testagent'],
  isAvailable: vi.fn().mockResolvedValue(true),
  sendPrompt: vi.fn(),
}

const mockAgent2: AgentAdapter = {
  name: 'another-agent',
  aliases: ['aa'],
  isAvailable: vi.fn().mockResolvedValue(true),
  sendPrompt: vi.fn(),
}

describe('PluginRegistry', () => {
  let registry: TestRegistry

  beforeEach(() => {
    registry = new TestRegistry()
    vi.clearAllMocks()
  })

  describe('registerMessenger', () => {
    it('should register a messenger adapter', () => {
      registry.registerMessenger(mockMessenger)
      expect(registry.getMessenger('test-messenger')).toBe(mockMessenger)
    })

    it('should warn on duplicate messenger registration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerMessenger(mockMessenger)
      registry.registerMessenger(mockMessenger)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      )

      warnSpy.mockRestore()
    })

    it('should overwrite on duplicate registration', () => {
      registry.registerMessenger(mockMessenger)

      const newMessenger: MessengerAdapter = {
        ...mockMessenger,
        name: 'test-messenger',
      }

      registry.registerMessenger(newMessenger)
      expect(registry.getMessenger('test-messenger')).toBe(newMessenger)
    })
  })

  describe('registerAgent', () => {
    it('should register an agent adapter', () => {
      registry.registerAgent(mockAgent)
      expect(registry.getAgent('test-agent')).toBe(mockAgent)
    })

    it('should register agent aliases', () => {
      registry.registerAgent(mockAgent)

      expect(registry.findAgent('ta')).toBe(mockAgent)
      expect(registry.findAgent('testagent')).toBe(mockAgent)
    })

    it('should warn on duplicate agent registration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerAgent(mockAgent)
      registry.registerAgent(mockAgent)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      )

      warnSpy.mockRestore()
    })

    it('should warn on duplicate alias registration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerAgent(mockAgent)

      // Agent with conflicting alias
      const conflictingAgent: AgentAdapter = {
        name: 'conflicting-agent',
        aliases: ['ta'], // Same as mockAgent
        isAvailable: vi.fn().mockResolvedValue(true),
        sendPrompt: vi.fn(),
      }

      registry.registerAgent(conflictingAgent)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('alias "ta" already registered')
      )

      warnSpy.mockRestore()
    })
  })

  describe('findAgent', () => {
    it('should find agent by exact name', () => {
      registry.registerAgent(mockAgent)
      expect(registry.findAgent('test-agent')).toBe(mockAgent)
    })

    it('should find agent by alias', () => {
      registry.registerAgent(mockAgent)
      expect(registry.findAgent('ta')).toBe(mockAgent)
      expect(registry.findAgent('testagent')).toBe(mockAgent)
    })

    it('should return undefined for unknown agent', () => {
      expect(registry.findAgent('nonexistent')).toBeUndefined()
    })

    it('should prioritize exact name over alias', () => {
      // Agent with name matching another's alias
      const nameAgent: AgentAdapter = {
        name: 'ta', // Same as mockAgent's alias
        aliases: [],
        isAvailable: vi.fn().mockResolvedValue(true),
        sendPrompt: vi.fn(),
      }

      registry.registerAgent(mockAgent)
      registry.registerAgent(nameAgent)

      // Should return the agent with exact name match
      expect(registry.findAgent('ta')).toBe(nameAgent)
    })
  })

  describe('listMessengers', () => {
    it('should return empty array when no messengers registered', () => {
      expect(registry.listMessengers()).toEqual([])
    })

    it('should return list of messenger names', () => {
      registry.registerMessenger(mockMessenger)
      registry.registerMessenger({ ...mockMessenger, name: 'messenger-2' })

      expect(registry.listMessengers()).toContain('test-messenger')
      expect(registry.listMessengers()).toContain('messenger-2')
    })
  })

  describe('listAgents', () => {
    it('should return empty array when no agents registered', () => {
      expect(registry.listAgents()).toEqual([])
    })

    it('should return list of agent names', () => {
      registry.registerAgent(mockAgent)
      registry.registerAgent(mockAgent2)

      expect(registry.listAgents()).toContain('test-agent')
      expect(registry.listAgents()).toContain('another-agent')
    })
  })
})
