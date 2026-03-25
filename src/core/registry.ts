// Plugin registry for messengers and agents

import type { MessengerAdapter, AgentAdapter } from './types.js'

/**
 * Global registry for all adapters
 */
class PluginRegistry {
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

    // Register aliases
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
    // Try exact name first
    const agent = this.agents.get(nameOrAlias)
    if (agent) return agent

    // Try alias
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

  async loadBuiltInPlugins(): Promise<void> {
    // Load built-in messengers
    const { ilinkWeChatAdapter } = await import('../plugins/messengers/wechat/ilink-adapter.js')
    this.registerMessenger(ilinkWeChatAdapter)

    // Load built-in agents
    const { claudeCodeAdapter } = await import('../plugins/agents/claude-code/index.js')
    this.registerAgent(claudeCodeAdapter)

    const { codexAdapter } = await import('../plugins/agents/codex/index.js')
    this.registerAgent(codexAdapter)

    const { copilotAdapter } = await import('../plugins/agents/copilot/index.js')
    this.registerAgent(copilotAdapter)

    const { opencodeAdapter } = await import('../plugins/agents/opencode/index.js')
    this.registerAgent(opencodeAdapter)

    console.log(`Plugin registry initialized: ${this.messengers.size} messengers, ${this.agents.size} agents`)
  }
}

// Singleton registry
export const registry = new PluginRegistry()
