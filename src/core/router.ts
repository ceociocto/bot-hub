// Message router — parses commands and routes to agents

import type { ParsedMessage, MessageContext } from './types.js'
import { registry } from './registry.js'
import { sessionManager } from './session.js'

/**
 * Parse a message to determine how to route it
 *
 * Command format: /alias prompt... or /agent-name prompt...
 * Built-in commands: /status, /help, /agents
 */
export function parseMessage(text: string): ParsedMessage {
  const trimmed = text.trim()

  // Empty string → default agent with empty prompt
  if (!trimmed) {
    return { type: 'default', prompt: '' }
  }

  // Check for command prefix
  const match = trimmed.match(/^\/(\S+)\s*(.*)/)
  if (!match) {
    // No command prefix → default agent
    return { type: 'default', prompt: trimmed }
  }

  const [, cmd, rest] = match

  // Built-in commands
  if (cmd === 'status') return { type: 'command', command: 'status' }
  if (cmd === 'help') return { type: 'command', command: 'help' }
  if (cmd === 'agents') return { type: 'command', command: 'agents' }

  // Check if it's an agent alias
  const agent = registry.findAgent(cmd)
  if (agent) {
    return { type: 'agent', agent: agent.name, prompt: rest }
  }

  // Unknown command
  return { type: 'error', prompt: trimmed, error: `Unknown command: ${cmd}` }
}

/**
 * Route a parsed message to the appropriate handler
 * Now supports async generator responses from agents
 */
export async function routeMessage(
  parsed: ParsedMessage,
  ctx: { threadId: string; platform: string; defaultAgent: string }
): Promise<string | AsyncGenerator<string>> {
  switch (parsed.type) {
    case 'command': {
      return handleBuiltInCommand(parsed.command)
    }

    case 'agent': {
      const agent = registry.findAgent(parsed.agent)
      if (!agent) {
        return `❌ Agent "${parsed.agent}" not found. Use /agents to see available agents.`
      }

      // If no prompt, just confirm switch
      if (!parsed.prompt) {
        return `✅ Switched to ${agent.name}`
      }

      // Get or create session, then call agent
      const session = await sessionManager.switchAgent(ctx.platform, ctx.threadId, agent.name)
      return agent.sendPrompt(session.id, parsed.prompt)
    }

    case 'error': {
      return `❓ ${parsed.error}\n\nUse /help to see available commands.`
    }

    case 'default': {
      // Use default agent
      const agent = registry.findAgent(ctx.defaultAgent)
      if (!agent) {
        return `❌ Default agent "${ctx.defaultAgent}" not configured.`
      }

      // Empty prompt → just acknowledge
      if (!parsed.prompt) {
        return '💬 Send a message to chat with the agent.'
      }

      // Get or create session, then call agent
      const session = await sessionManager.getOrCreateSession(
        ctx.platform,
        ctx.threadId,
        ctx.defaultAgent
      )
      return agent.sendPrompt(session.id, parsed.prompt)
    }
  }
}

function handleBuiltInCommand(command: 'status' | 'help' | 'agents'): string {
  switch (command) {
    case 'status':
      return `📊 Bot Hub Status\n\nPlatform: Connected\nAgent: Ready\n\nSend a message to start!`

    case 'help':
      return `📖 Bot Hub Commands\n\n/agents - List available agents\n/status - Show connection status\n/<agent> <prompt> - Switch to agent and send prompt\n\nExample: /claude explain this code`

    case 'agents':
      const agents = registry.listAgents()
      if (agents.length === 0) {
        return '⚠️ No agents registered yet.'
      }
      return `🤖 Available Agents\n\n${agents.map(a => `• ${a}`).join('\n')}\n\nUse /<agent> to switch.`
  }
}
