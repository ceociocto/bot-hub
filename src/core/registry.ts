// Plugin registry for messengers and agents

import type { MessengerAdapter, AgentAdapter } from './types.js'
import type { ACPAgentConfig } from '../plugins/agents/acp/types.js'

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

  /**
   * Load ACP (remote) agents from config. Uses Promise.allSettled
   * for parallel loading so one slow endpoint doesn't block startup.
   */
  async loadACPAgents(acpConfigs: ACPAgentConfig[]): Promise<void> {
    const enabled = acpConfigs.filter((c) => c.enabled !== false)
    if (enabled.length === 0) return

    const results = await Promise.allSettled(
      enabled.map(async (cfg) => {
        const { ACPAdapter } = await import('../plugins/agents/acp/acp-adapter.js')
        const adapter = new ACPAdapter(cfg)

        const available = await adapter.isAvailable().catch(() => false)
        if (!available) {
          console.warn(`⚠️ ACP agent "${cfg.name}" at ${cfg.endpoint} not reachable, skipping`)
          return
        }

        this.registerAgent(adapter)
        console.log(`✅ Loaded ACP agent: ${cfg.name} (${cfg.endpoint})`)
      })
    )

    // Report any unexpected errors (not connection failures)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(`⚠️ Failed to load ACP agent: ${result.reason}`)
      }
    }
  }

  async loadBuiltInPlugins(): Promise<void> {
    // Load built-in messengers
    const { ilinkWeChatAdapter } = await import('../plugins/messengers/wechat/ilink-adapter.js')
    this.registerMessenger(ilinkWeChatAdapter)

    const { telegramAdapter } = await import('../plugins/messengers/telegram/telegram-adapter.js')
    this.registerMessenger(telegramAdapter)

    const { feishuAdapter } = await import('../plugins/messengers/feishu/index.js')
    this.registerMessenger(feishuAdapter)

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
