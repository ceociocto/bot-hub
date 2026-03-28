// Message router — parses commands and routes to agents

import type { ParsedMessage, MessageContext, ChatMessage } from './types.js'
import { registry } from './registry.js'
import { sessionManager } from './session.js'
import { isAgentAvailableCached, formatAgentNotAvailableError } from './onboarding.js'

/** Built-in coding agent commands forwarded to the active agent */
const AGENT_COMMANDS = new Set(['test', 'review', 'commit', 'push', 'diff', 'shell', 'bug', 'explain'])

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
  if (cmd === 'start') return { type: 'command', command: 'start' }
  if (cmd === 'status') return { type: 'command', command: 'status' }
  if (cmd === 'help') return { type: 'command', command: 'help' }
  if (cmd === 'agents') return { type: 'command', command: 'agents' }
  if (cmd === 'new') return { type: 'command', command: 'new' }

  // Check if it's an agent alias (registered agents take priority over generic commands)
  const agent = registry.findAgent(cmd)
  if (agent) {
    return { type: 'agent', agent: agent.name, prompt: rest }
  }

  // Agent built-in commands (only if no registered agent matches)
  if (AGENT_COMMANDS.has(cmd)) {
    return { type: 'agentCommand', command: cmd, prompt: rest }
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
  ctx: { channelId: string; threadId: string; platform: string; defaultAgent: string }
): Promise<string | AsyncGenerator<string>> {
  switch (parsed.type) {
    case 'command': {
      return handleBuiltInCommand(parsed.command, ctx)
    }

    case 'agentCommand': {
      return handleAgentCommand(parsed.command, parsed.prompt, ctx)
    }

    case 'agent': {
      const agent = registry.findAgent(parsed.agent)
      if (!agent) {
        return `❌ Agent "${parsed.agent}" not found. Use /agents to see available agents.`
      }

      // Check if agent is available at runtime
      if (!(await isAgentAvailableCached(agent.name))) {
        return formatAgentNotAvailableError(agent.name)
      }

      // Always switch the session agent (even without prompt)
      await sessionManager.switchAgent(ctx.platform, ctx.channelId, ctx.threadId, agent.name)

      // If no prompt, just confirm switch
      if (!parsed.prompt) {
        return `✅ Switched to ${agent.name}`
      }

      // Get session and call agent with history
      const session = await sessionManager.getOrCreateSession(
        ctx.platform,
        ctx.channelId,
        ctx.threadId,
        agent.name
      )
      return callAgentWithHistory(agent, session.id, parsed.prompt, session.messages, ctx)
    }

    case 'error': {
      return `❓ ${parsed.error}\n\nUse /help to see available commands.`
    }

    case 'default': {
      // Try to get existing session to use its agent, otherwise fall back to default
      const existingSession = await sessionManager.getExistingSession(ctx.platform, ctx.channelId, ctx.threadId)
      const agentName = existingSession?.agent || ctx.defaultAgent

      const agent = registry.findAgent(agentName)
      if (!agent) {
        return `❌ Agent "${agentName}" not configured.`
      }

      // Check if agent is available at runtime
      if (!(await isAgentAvailableCached(agent.name))) {
        return formatAgentNotAvailableError(agent.name)
      }

      // Empty prompt → just acknowledge
      if (!parsed.prompt) {
        return '💬 Send a message to chat with the agent.'
      }

      // Get or create session, then call agent with history
      const session = await sessionManager.getOrCreateSession(
        ctx.platform,
        ctx.channelId,
        ctx.threadId,
        agentName
      )
      return callAgentWithHistory(agent, session.id, parsed.prompt, session.messages, ctx)
    }
  }
}

/**
 * Call agent with conversation history and save messages
 */
async function callAgentWithHistory(
  agent: ReturnType<typeof registry.findAgent>,
  sessionId: string,
  prompt: string,
  history: ChatMessage[],
  ctx: { channelId: string; threadId: string; platform: string }
): Promise<string | AsyncGenerator<string>> {
  // Save user message
  await sessionManager.addMessage(ctx.platform, ctx.channelId, ctx.threadId, {
    role: 'user',
    content: prompt,
    timestamp: new Date()
  })

  // Call agent with history
  const generator = agent!.sendPrompt(sessionId, prompt, history)

  // For streaming responses, we need to collect the full response to save it
  // Return a wrapper generator that saves the response when complete
  return (async function* (): AsyncGenerator<string> {
    let fullResponse = ''
    try {
      for await (const chunk of generator) {
        fullResponse += chunk
        yield chunk
      }
    } finally {
      // Save assistant response (only if we got some content)
      if (fullResponse.trim()) {
        await sessionManager.addMessage(ctx.platform, ctx.channelId, ctx.threadId, {
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date()
        })
      }
    }
  })()
}

async function handleBuiltInCommand(
  command: 'start' | 'status' | 'help' | 'agents' | 'new',
  ctx: { channelId: string; threadId: string; platform: string }
): Promise<string> {
  switch (command) {
    case 'start':
      return `👋 Welcome to IM Hub!\n\nI'm your AI assistant hub. Send me a message and I'll route it to the right AI agent.\n\nUse /help to see available commands.\nUse /agents to list available AI agents.`

    case 'status':
      return `📊 IM hub Status\n\nPlatform: Connected\nAgent: Ready\n\nSend a message to start!`

    case 'help':
      return `📖 IM hub Commands\n\nBuilt-in Commands:\n/agents - List available agents\n/new - Start a new conversation (clear history)\n/status - Show connection status\n/<agent> <prompt> - Switch to agent and send prompt\n\nAgent Commands:\n/test - Run tests\n/review - Code review\n/commit - Commit changes\n/push - Push to remote\n/diff - Show changes\n/shell - Execute shell commands\n/bug - Find and fix bugs\n/explain - Explain code\n\nExample: /claude explain this code`

    case 'agents':
      const agents = registry.listAgents()
      if (agents.length === 0) {
        return '⚠️ No agents registered yet.'
      }
      return `🤖 Available Agents\n\n${agents.map(a => `• ${a}`).join('\n')}\n\nUse /<agent> to switch.`

    case 'new':
      const session = await sessionManager.resetConversation(ctx.platform, ctx.channelId, ctx.threadId)
      if (session) {
        return `🆕 New conversation started with ${session.agent}.\n\nPrevious context has been cleared.`
      }
      return `🆕 Ready to start a new conversation.\n\nSend a message to begin.`
  }
}

async function handleAgentCommand(
  command: string,
  prompt: string,
  ctx: { channelId: string; threadId: string; platform: string; defaultAgent: string }
): Promise<string | AsyncGenerator<string>> {
  const existingSession = await sessionManager.getExistingSession(ctx.platform, ctx.channelId, ctx.threadId)
  const agentName = existingSession?.agent || ctx.defaultAgent

  const agent = registry.findAgent(agentName)
  if (!agent) {
    return `❌ Agent "${agentName}" not found. Use /agents to see available agents.`
  }

  if (!(await isAgentAvailableCached(agent.name))) {
    return formatAgentNotAvailableError(agent.name)
  }

  const fullPrompt = `/${command} ${prompt}`.trim()

  const session = await sessionManager.getOrCreateSession(
    ctx.platform,
    ctx.channelId,
    ctx.threadId,
    agent.name
  )
  return callAgentWithHistory(agent, session.id, fullPrompt, session.messages, ctx)
}
