// Integration tests for message routing flow
// Tests the full flow: message → parse → route → agent → response

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

// Types
interface Message {
  id: string
  threadId: string
  userId: string
  text: string
  timestamp: Date
}

interface MessageContext {
  message: Message
  platform: string
  agent?: string
  session?: Session
}

interface Session {
  id: string
  threadId: string
  platform: string
  agent: string
  createdAt: Date
  lastActivity: Date
  ttl: number
}

type ParsedMessage =
  | { type: 'default'; prompt: string }
  | { type: 'command'; command: 'status' | 'help' | 'agents' }
  | { type: 'agent'; agent: string; prompt: string }
  | { type: 'error'; prompt: string; error: string }

interface AgentAdapter {
  name: string
  aliases: string[]
  isAvailable(): Promise<boolean>
  sendPrompt(sessionId: string, prompt: string): AsyncGenerator<string>
}

// Test registry
class TestRegistry {
  private agents = new Map<string, AgentAdapter>()
  private agentAliases = new Map<string, string>()

  registerAgent(adapter: AgentAdapter): void {
    this.agents.set(adapter.name, adapter)
    for (const alias of adapter.aliases) {
      this.agentAliases.set(alias, adapter.name)
    }
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

  listAgents(): string[] {
    return Array.from(this.agents.keys())
  }
}

// Test router
function createRouter(registry: TestRegistry) {
  function parseMessage(text: string): ParsedMessage {
    const trimmed = text.trim()

    if (!trimmed) {
      return { type: 'default', prompt: '' }
    }

    const match = trimmed.match(/^\/(\S+)\s*(.*)/)
    if (!match) {
      return { type: 'default', prompt: trimmed }
    }

    const [, cmd, rest] = match

    if (cmd === 'status') return { type: 'command', command: 'status' }
    if (cmd === 'help') return { type: 'command', command: 'help' }
    if (cmd === 'agents') return { type: 'command', command: 'agents' }

    const agent = registry.findAgent(cmd)
    if (agent) {
      return { type: 'agent', agent: agent.name, prompt: rest }
    }

    return { type: 'error', prompt: trimmed, error: `Unknown command: ${cmd}` }
  }

  async function routeMessage(
    parsed: ParsedMessage,
    ctx: { threadId: string; platform: string; defaultAgent: string }
  ): Promise<string> {
    switch (parsed.type) {
      case 'command': {
        return handleBuiltInCommand(parsed.command)
      }

      case 'agent': {
        const agent = registry.findAgent(parsed.agent)
        if (!agent) {
          return `❌ Agent "${parsed.agent}" not found.`
        }
        if (!parsed.prompt) {
          return `✅ Switched to ${agent.name}`
        }
        // Actually call the agent
        const responses: string[] = []
        for await (const chunk of agent.sendPrompt(ctx.threadId, parsed.prompt)) {
          responses.push(chunk)
        }
        return responses.join('')
      }

      case 'error': {
        return `❓ ${parsed.error}`
      }

      case 'default': {
        const agent = registry.findAgent(ctx.defaultAgent)
        if (!agent) {
          return `❌ Default agent not configured.`
        }
        if (!parsed.prompt) {
          return '💬 Send a message to start!'
        }
        // Actually call the agent
        const responses: string[] = []
        for await (const chunk of agent.sendPrompt(ctx.threadId, parsed.prompt)) {
          responses.push(chunk)
        }
        return responses.join('')
      }
    }
  }

  function handleBuiltInCommand(command: 'status' | 'help' | 'agents'): string {
    switch (command) {
      case 'status':
        return `📊 Bot Hub Status\n\nPlatform: Connected\nAgent: Ready`

      case 'help':
        return `📖 Bot Hub Commands\n\n/agents - List available agents\n/status - Show status\n/<agent> <prompt> - Switch agent`

      case 'agents':
        const agents = registry.listAgents()
        if (agents.length === 0) {
          return '⚠️ No agents registered.'
        }
        return `🤖 Available Agents\n\n${agents.map(a => `• ${a}`).join('\n')}`
    }
  }

  return { parseMessage, routeMessage }
}

// Mock agent that returns predictable responses
function createMockAgent(name: string, aliases: string[], response: string): AgentAdapter {
  return {
    name,
    aliases,
    isAvailable: async () => true,
    sendPrompt: async function* (sessionId: string, prompt: string) {
      yield `[${name}] Response to "${prompt}" (session: ${sessionId})`
    },
  }
}

// Mock agent that simulates streaming
function createStreamingAgent(name: string): AgentAdapter {
  return {
    name,
    aliases: [name.slice(0, 2)],
    isAvailable: async () => true,
    sendPrompt: async function* (_sessionId: string, prompt: string) {
      const words = prompt.split(' ')
      for (let i = 0; i < words.length; i++) {
        await new Promise(r => setTimeout(r, 10))
        yield `[${name}] Word ${i + 1}: ${words[i]}\n`
      }
      yield `[${name}] Done!`
    },
  }
}

describe('Router Integration', () => {
  let registry: TestRegistry
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    registry = new TestRegistry()
    router = createRouter(registry)
  })

  describe('full message flow', () => {
    it('should route plain message to default agent', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], 'Hello!'))

      const parsed = router.parseMessage('hello world')
      const response = await router.routeMessage(parsed, {
        threadId: 'thread-1',
        platform: 'wechat',
        defaultAgent: 'claude-code',
      })

      expect(response).toContain('claude-code')
      expect(response).toContain('hello world')
    })

    it('should route command to agent by alias', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], 'Response'))

      const parsed = router.parseMessage('/cc explain this')
      const response = await router.routeMessage(parsed, {
        threadId: 'thread-1',
        platform: 'wechat',
        defaultAgent: 'other-agent',
      })

      expect(response).toContain('claude-code')
      expect(response).toContain('explain this')
    })

    it('should handle built-in commands without agent', async () => {
      // No agents registered

      const statusResult = await router.routeMessage(
        { type: 'command', command: 'status' },
        { threadId: 't1', platform: 'wechat', defaultAgent: 'none' }
      )
      expect(statusResult).toContain('Status')

      const helpResult = await router.routeMessage(
        { type: 'command', command: 'help' },
        { threadId: 't1', platform: 'wechat', defaultAgent: 'none' }
      )
      expect(helpResult).toContain('Commands')

      const agentsResult = await router.routeMessage(
        { type: 'command', command: 'agents' },
        { threadId: 't1', platform: 'wechat', defaultAgent: 'none' }
      )
      expect(agentsResult).toContain('No agents')
    })

    it('should list registered agents', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], ''))
      registry.registerAgent(createMockAgent('codex', ['cx'], ''))

      const result = await router.routeMessage(
        { type: 'command', command: 'agents' },
        { threadId: 't1', platform: 'wechat', defaultAgent: 'none' }
      )

      expect(result).toContain('claude-code')
      expect(result).toContain('codex')
    })
  })

  describe('streaming responses', () => {
    it('should collect all streamed chunks', async () => {
      registry.registerAgent(createStreamingAgent('streamer'))

      const parsed = router.parseMessage('/streamer one two three')
      const response = await router.routeMessage(parsed, {
        threadId: 't1',
        platform: 'wechat',
        defaultAgent: 'none',
      })

      expect(response).toContain('Word 1: one')
      expect(response).toContain('Word 2: two')
      expect(response).toContain('Word 3: three')
      expect(response).toContain('Done')
    })
  })

  describe('error handling', () => {
    it('should handle unknown agent', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], ''))

      const parsed = router.parseMessage('/unknown-agent hello')
      const response = await router.routeMessage(parsed, {
        threadId: 't1',
        platform: 'wechat',
        defaultAgent: 'claude-code',
      })

      expect(response).toContain('Unknown command')
    })

    it('should handle missing default agent', async () => {
      const response = await router.routeMessage(
        { type: 'default', prompt: 'hello' },
        { threadId: 't1', platform: 'wechat', defaultAgent: 'nonexistent' }
      )

      expect(response).toContain('not configured')
    })

    it('should handle agent switch without prompt', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], ''))

      const parsed = router.parseMessage('/cc')
      const response = await router.routeMessage(parsed, {
        threadId: 't1',
        platform: 'wechat',
        defaultAgent: 'none',
      })

      expect(response).toContain('Switched to claude-code')
    })
  })

  describe('multi-platform scenarios', () => {
    it('should handle messages from different platforms', async () => {
      registry.registerAgent(createMockAgent('claude-code', ['cc'], ''))

      // WeChat message
      const wechatParsed = router.parseMessage('hello')
      const wechatResponse = await router.routeMessage(wechatParsed, {
        threadId: 'wechat-thread-1',
        platform: 'wechat',
        defaultAgent: 'claude-code',
      })

      // Telegram message
      const telegramParsed = router.parseMessage('hello')
      const telegramResponse = await router.routeMessage(telegramParsed, {
        threadId: 'telegram-thread-1',
        platform: 'telegram',
        defaultAgent: 'claude-code',
      })

      expect(wechatResponse).toContain('claude-code')
      expect(telegramResponse).toContain('claude-code')
    })
  })
})

describe('End-to-end message flow simulation', () => {
  it('should simulate complete user interaction', async () => {
    // Setup
    const registry = new TestRegistry()
    const router = createRouter(registry)
    const agent = createMockAgent('claude-code', ['cc', 'claude'], 'AI response')

    registry.registerAgent(agent)

    const ctx = {
      threadId: 'user:12345',
      platform: 'wechat',
      defaultAgent: 'claude-code',
    }

    // User sends first message
    let parsed = router.parseMessage('hello')
    let response = await router.routeMessage(parsed, ctx)
    expect(response).toContain('hello')

    // User asks for help
    parsed = router.parseMessage('/help')
    response = await router.routeMessage(parsed, ctx)
    expect(response).toContain('Commands')

    // User checks status
    parsed = router.parseMessage('/status')
    response = await router.routeMessage(parsed, ctx)
    expect(response).toContain('Status')

    // User switches agent (same agent, but via alias)
    parsed = router.parseMessage('/cc explain code')
    response = await router.routeMessage(parsed, ctx)
    expect(response).toContain('explain code')
  })
})
