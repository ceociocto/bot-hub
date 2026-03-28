// Unit tests for message router

import { describe, it, expect, beforeEach, vi } from 'bun:test'
import { parseMessage, routeMessage } from '../../src/core/router'
import { registry } from '../../src/core/registry'
import type { AgentAdapter } from '../../src/core/types'

// Mock agent for testing
async function* mockGenerator(): AsyncGenerator<string> {
  yield 'test response'
}

const mockAgent: AgentAdapter = {
  name: 'test-agent',
  aliases: ['ta', 'testagent'],
  isAvailable: vi.fn().mockResolvedValue(true),
  sendPrompt: vi.fn().mockImplementation(() => mockGenerator()),
}

describe('parseMessage', () => {
  beforeEach(() => {
    // Clear registry before each test
    vi.clearAllMocks()
  })

  describe('default agent routing', () => {
    it('should route plain text to default agent', () => {
      const result = parseMessage('hello world')
      expect(result).toEqual({ type: 'default', prompt: 'hello world' })
    })

    it('should handle empty string as default with empty prompt', () => {
      const result = parseMessage('')
      expect(result).toEqual({ type: 'default', prompt: '' })
    })

    it('should trim whitespace from input', () => {
      const result = parseMessage('  hello world  ')
      expect(result).toEqual({ type: 'default', prompt: 'hello world' })
    })
  })

  describe('built-in commands', () => {
    it('should parse /status command', () => {
      const result = parseMessage('/status')
      expect(result).toEqual({ type: 'command', command: 'status' })
    })

    it('should parse /help command', () => {
      const result = parseMessage('/help')
      expect(result).toEqual({ type: 'command', command: 'help' })
    })

    it('should parse /agents command', () => {
      const result = parseMessage('/agents')
      expect(result).toEqual({ type: 'command', command: 'agents' })
    })

    it('should ignore extra text after built-in commands', () => {
      // Built-in commands don't take arguments
      const result = parseMessage('/status extra text')
      expect(result).toEqual({ type: 'command', command: 'status' })
    })
  })

  describe('agent switching', () => {
    it('should route to agent by alias when registered', () => {
      // Register mock agent
      registry.registerAgent(mockAgent)

      const result = parseMessage('/ta explain this code')
      expect(result).toEqual({
        type: 'agent',
        agent: 'test-agent',
        prompt: 'explain this code',
      })
    })

    it('should route to agent by full name', () => {
      registry.registerAgent(mockAgent)

      const result = parseMessage('/test-agent hello')
      expect(result).toEqual({
        type: 'agent',
        agent: 'test-agent',
        prompt: 'hello',
      })
    })

    it('should handle agent command without prompt', () => {
      registry.registerAgent(mockAgent)

      const result = parseMessage('/ta')
      expect(result).toEqual({
        type: 'agent',
        agent: 'test-agent',
        prompt: '',
      })
    })
  })

  describe('agent commands', () => {
    it('should parse /test as agentCommand', () => {
      const result = parseMessage('/test run unit tests')
      expect(result).toEqual({ type: 'agentCommand', command: 'test', prompt: 'run unit tests' })
    })

    it('should parse agent command without prompt', () => {
      const result = parseMessage('/review')
      expect(result).toEqual({ type: 'agentCommand', command: 'review', prompt: '' })
    })

    it('should parse all supported agent commands', () => {
      const commands = ['test', 'review', 'commit', 'push', 'diff', 'shell', 'bug', 'explain']
      for (const cmd of commands) {
        const result = parseMessage(`/${cmd} some args`)
        expect(result).toEqual({ type: 'agentCommand', command: cmd, prompt: 'some args' })
      }
    })

    it('should route to registered agent instead of generic command when name matches', () => {
      // Register an agent named "test"
      const testAgent: AgentAdapter = {
        name: 'test',
        aliases: [],
        isAvailable: vi.fn().mockResolvedValue(true),
        sendPrompt: vi.fn().mockImplementation(() => mockGenerator()),
      }
      registry.registerAgent(testAgent)

      const result = parseMessage('/test something')
      // Registered agent takes priority over generic agentCommand
      expect(result).toEqual({ type: 'agent', agent: 'test', prompt: 'something' })
    })
  })

  describe('error handling', () => {
    it('should return error for unknown command', () => {
      const result = parseMessage('/unknown command')
      expect(result.type).toBe('error')
      if (result.type === 'error') {
        expect(result.error).toBe('Unknown command: unknown')
        expect(result.prompt).toBe('/unknown command')
      }
    })

    it('should return error for unregistered agent alias', () => {
      const result = parseMessage('/nonexistent-agent prompt')
      expect(result.type).toBe('error')
      if (result.type === 'error') {
        expect(result.error).toContain('Unknown command')
      }
    })
  })
})

describe('routeMessage', () => {
  const ctx = { threadId: 'thread-1', platform: 'wechat', defaultAgent: 'test-agent' }

  beforeEach(() => {
    vi.clearAllMocks()
    registry.registerAgent(mockAgent)
  })

  describe('command routing', () => {
    it('should return status message for /status', async () => {
      const result = await routeMessage({ type: 'command', command: 'status' }, ctx)
      expect(result).toContain('IM hub Status')
    })

    it('should return help message for /help', async () => {
      const result = await routeMessage({ type: 'command', command: 'help' }, ctx)
      expect(result).toContain('IM hub Commands')
    })

    it('should return agents list for /agents', async () => {
      const result = await routeMessage({ type: 'command', command: 'agents' }, ctx)
      expect(result).toContain('Available Agents')
    })
  })

  describe('agent routing', () => {
    it('should switch to agent without prompt', async () => {
      const result = await routeMessage(
        { type: 'agent', agent: 'test-agent', prompt: '' },
        ctx
      )
      expect(result).toContain('Switched to test-agent')
    })

    it('should call agent when prompt provided', async () => {
      const result = await routeMessage(
        { type: 'agent', agent: 'test-agent', prompt: 'hello' },
        ctx
      )
      // Result is an AsyncGenerator when prompt is provided
      expect(typeof result).not.toBe('string')
      // Consume generator
      let text = ''
      for await (const chunk of result as AsyncGenerator<string>) {
        text += chunk
      }
      expect(text).toContain('test response')
    })

    it('should return error when agent not found', async () => {
      const result = await routeMessage(
        { type: 'agent', agent: 'nonexistent', prompt: 'hello' },
        ctx
      )
      expect(result).toContain('not found')
    })
  })

  describe('default routing', () => {
    it('should call default agent when prompt provided', async () => {
      const result = await routeMessage({ type: 'default', prompt: 'hello' }, ctx)
      // Result is an AsyncGenerator when prompt is provided
      expect(typeof result).not.toBe('string')
      // Consume generator
      let text = ''
      for await (const chunk of result as AsyncGenerator<string>) {
        text += chunk
      }
      expect(text).toContain('test response')
    })

    it('should error when default agent not configured', async () => {
      const result = await routeMessage(
        { type: 'default', prompt: 'hello' },
        { ...ctx, defaultAgent: 'nonexistent' }
      )
      expect(result).toContain('not configured')
    })
  })

  describe('error routing', () => {
    it('should return friendly error message', async () => {
      const result = await routeMessage(
        { type: 'error', prompt: '/bad', error: 'Unknown command: bad' },
        ctx
      )
      expect(result).toContain('Unknown command')
      expect(result).toContain('/help')
    })
  })

  describe('agent command routing', () => {
    it('should forward agent command to existing session agent', async () => {
      const result = await routeMessage(
        { type: 'agentCommand', command: 'test', prompt: 'run unit tests' },
        ctx
      )
      // Result is an AsyncGenerator
      expect(typeof result).not.toBe('string')
      let text = ''
      for await (const chunk of result as AsyncGenerator<string>) {
        text += chunk
      }
      // Should contain the forwarded command /test run unit tests
      expect(text).toContain('test response')
    })

    it('should return error when no agent found for agentCommand', async () => {
      const result = await routeMessage(
        { type: 'agentCommand', command: 'test', prompt: '' },
        { threadId: 'thread-no-agent', platform: 'wechat', defaultAgent: 'nonexistent' }
      )
      expect(result).toContain('not found')
    })

    it('should forward agent command without prompt', async () => {
      const result = await routeMessage(
        { type: 'agentCommand', command: 'review', prompt: '' },
        ctx
      )
      expect(typeof result).not.toBe('string')
      let text = ''
      for await (const chunk of result as AsyncGenerator<string>) {
        text += chunk
      }
      expect(text).toContain('test response')
    })
  })
})
