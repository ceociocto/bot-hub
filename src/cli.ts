#!/usr/bin/env node
// bot-hub CLI

import { program } from 'commander'
import { homedir } from 'os'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { registry } from './core/registry.js'
import { sessionManager } from './core/session.js'
import { parseMessage, routeMessage } from './core/router.js'
import type { MessageContext } from './core/types.js'

const CONFIG_DIR = join(homedir(), '.bot-hub')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

interface Config {
  messengers: string[]
  agents: string[]
  defaultAgent: string
  [key: string]: unknown
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {
      messengers: [],
      agents: [],
      defaultAgent: 'claude-code',
    }
  }
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
}

program
  .name('bot-hub')
  .description('Universal messenger-to-agent bridge')
  .version('0.0.1.0')

program
  .command('start')
  .description('Start the bot-hub server')
  .action(async () => {
    console.log('🚀 Starting bot-hub...')

    const config = await loadConfig()
    console.log(`Config loaded from ${CONFIG_FILE}`)

    // Initialize session manager
    await sessionManager.start()

    // Load plugins
    await registry.loadBuiltInPlugins()

    // Get messengers to start
    const messengersToStart = config.messengers.length > 0
      ? config.messengers
      : ['wechat-ilink'] // Default to wechat-ilink

    // Start messenger adapters
    for (const name of messengersToStart) {
      const messenger = registry.getMessenger(name)
      if (!messenger) {
        console.warn(`⚠️ Messenger "${name}" not found, skipping`)
        continue
      }

      // Set up message handler
      messenger.onMessage(async (ctx: MessageContext) => {
        await handleMessage(ctx, config.defaultAgent)
      })

      try {
        await messenger.start()
        console.log(`✅ Started messenger: ${name}`)
      } catch (error) {
        console.error(`❌ Failed to start messenger ${name}:`, error)
      }
    }

    console.log('\n✅ Bot hub is running!')
    console.log('Press Ctrl+C to stop')

    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down...')
      sessionManager.stop()

      // Stop all messengers
      for (const name of registry.listMessengers()) {
        const messenger = registry.getMessenger(name)
        if (messenger) {
          await messenger.stop()
        }
      }

      process.exit(0)
    })

    // Wait forever
    await new Promise(() => {})
  })

/**
 * Handle incoming message from any messenger
 */
async function handleMessage(ctx: MessageContext, defaultAgent: string): Promise<void> {
  const { message, platform } = ctx
  console.log(`[handleMessage] Received: "${message.text}" from ${message.threadId}`)

  const messenger = registry.getMessenger(platform === 'wechat' ? 'wechat-ilink' : platform)

  if (!messenger) {
    console.error(`No messenger found for platform: ${platform}`)
    return
  }

  // Start typing indicator if supported
  const stopTyping = async () => {
    if (messenger.sendTyping) {
      try {
        await messenger.sendTyping(message.threadId, false)
      } catch {
        // Ignore typing errors
      }
    }
  }

  try {
    // Send typing indicator
    if (messenger.sendTyping) {
      messenger.sendTyping(message.threadId, true).catch(() => {
        // Ignore typing errors
      })
    }

    // Parse the message
    const parsed = parseMessage(message.text)
    console.log(`[handleMessage] Parsed:`, parsed)

    // Route to appropriate handler
    const result = await routeMessage(parsed, {
      threadId: message.threadId,
      platform,
      defaultAgent,
    })
    console.log(`[handleMessage] Route result type:`, typeof result)

    // Handle response (string or async generator)
    if (typeof result === 'string') {
      console.log(`[handleMessage] Sending string response:`, result.substring(0, 100))
      await stopTyping()
      await messenger.sendMessage(message.threadId, result)
    } else {
      // Stream response chunks
      console.log(`[handleMessage] Streaming response...`)
      let fullResponse = ''
      for await (const chunk of result) {
        fullResponse += chunk
        console.log(`[handleMessage] Chunk received, length:`, chunk.length)
      }

      await stopTyping()

      if (fullResponse) {
        console.log(`[handleMessage] Full response length:`, fullResponse.length)
        await messenger.sendMessage(message.threadId, fullResponse)
      } else {
        console.log(`[handleMessage] No response generated`)
      }
    }
  } catch (error) {
    console.error('Error handling message:', error)
    await stopTyping()
    await messenger.sendMessage(
      message.threadId,
      '❌ An error occurred processing your message. Please try again.'
    )
  }
}

program
  .command('config [component]')
  .description('Configure a messenger or agent')
  .action(async (component?: string) => {
    if (!component) {
      console.log('Available components to configure:')
      console.log('\nMessengers:')
      console.log('  wechat  - WeChat adapter')
      console.log('\nAgents:')
      console.log('  claude  - Claude Code agent')
      console.log('\nUsage: bot-hub config <component>')
      return
    }

    const config = await loadConfig()

    switch (component) {
      case 'wechat':
        console.log('📱 Configuring WeChat adapter...')
        console.log('Fetching QR code...\n')

        // Import the iLink adapter for QR login
        const { ILinkWeChatAdapter } = await import('./plugins/messengers/wechat/ilink-adapter.js')
        const adapter = new ILinkWeChatAdapter()

        try {
          // Get QR code URL and token
          const { qrUrl, qrToken } = await adapter.startQRLogin()

          console.log('📱 Scan this QR code with WeChat:\n')
          console.log(qrUrl)
          console.log('\n')

          // Poll for login status
          const credentials = await adapter.waitForQRLogin(qrToken, (status) => {
            console.log(`[${new Date().toLocaleTimeString()}] ${status}`)
          })

          if (credentials) {
            console.log(`\n✅ Logged in as ${credentials.userId}`)
            console.log(`   Bot ID: ${credentials.accountId}`)

            // Add wechat-ilink to config
            if (!config.messengers.includes('wechat-ilink')) {
              config.messengers.push('wechat-ilink')
            }
          } else {
            console.log('\n❌ Login failed or timed out')
            return
          }
        } catch (error) {
          console.error('\n❌ Failed to configure WeChat:', error)
          return
        }
        break

      case 'claude':
        console.log('🤖 Configuring Claude Code agent...')
        // Check if claude CLI is available
        const { spawn } = await import('child_process')
        const checkProcess = spawn('claude', ['--version'], { stdio: 'ignore' })
        checkProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Claude Code CLI found!')
          } else {
            console.log('❌ Claude Code CLI not found.')
            console.log('Install with: npm install -g @anthropic-ai/claude-code')
          }
        })
        if (!config.agents.includes('claude-code')) {
          config.agents.push('claude-code')
        }
        config.defaultAgent = 'claude-code'
        break

      default:
        console.log(`Unknown component: ${component}`)
        console.log('Run "bot-hub config" to see available components.')
        return
    }

    await saveConfig(config)
    console.log(`\n✅ Configuration saved to ${CONFIG_FILE}`)
  })

program
  .command('agents')
  .description('List available agents')
  .action(() => {
    const agents = registry.listAgents()
    if (agents.length === 0) {
      console.log('No agents registered yet.')
      console.log('Run "bot-hub config claude" to configure Claude Code.')
      return
    }
    console.log('🤖 Available Agents:\n')
    for (const name of agents) {
      console.log(`  ${name}`)
    }
  })

program
  .command('messengers')
  .description('List available messengers')
  .action(() => {
    const messengers = registry.listMessengers()
    if (messengers.length === 0) {
      console.log('No messengers registered yet.')
      console.log('Run "bot-hub config wechat" to configure WeChat.')
      return
    }
    console.log('📱 Available Messengers:\n')
    for (const name of messengers) {
      console.log(`  ${name}`)
    }
  })

program.parse()
