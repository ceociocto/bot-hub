#!/usr/bin/env node
// im-hub CLI

import { program } from 'commander'
import { homedir } from 'os'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { registry } from './core/registry.js'
import { sessionManager } from './core/session.js'
import { parseMessage, routeMessage } from './core/router.js'
import { crossSpawn, isMac, isWindows } from './utils/cross-platform.js'
import type { MessageContext } from './core/types.js'
import {
  checkMessengerConfig,
  checkAgentAvailability,
  runMessengerOnboarding,
  formatAgentInstallHint,
  formatMessengerStartError,
  loadConfig as loadOnboardingConfig,
  saveConfig as saveOnboardingConfig,
  type Config as OnboardingConfig,
} from './core/onboarding.js'

// Helper to format agent install hint for missing agents
function formatMissingAgentHint(missing: string[]): string {
  return formatAgentInstallHint(missing)
}

const CONFIG_DIR = join(homedir(), '.im-hub')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

type Config = OnboardingConfig

async function loadConfig(): Promise<Config> {
  return loadOnboardingConfig()
}

async function saveConfig(config: Config): Promise<void> {
  return saveOnboardingConfig(config)
}

program
  .name('im-hub')
  .description('Universal messenger-to-agent bridge')
  .version('0.0.1.0')

program
  .command('start')
  .description('Start the im-hub server')
  .action(async () => {
    console.log('🚀 Starting im-hub...')

    let config = await loadConfig()
    console.log(`Config loaded from ${CONFIG_FILE}`)

    // Initialize session manager
    await sessionManager.start()

    // Load plugins FIRST (agents won't be registered until this runs)
    await registry.loadBuiltInPlugins()

    // Load ACP (remote) agents from config
    if (config.acpAgents?.length) {
      await registry.loadACPAgents(config.acpAgents)
    }

    // ============================================
    // ONBOARDING CHECKS (before default fill!)
    // ============================================

    // Check messengers BEFORE the default fill
    const onboardingResult = checkMessengerConfig(config)
    if (onboardingResult.needsOnboarding) {
      console.log('👋 No messengers configured.\n')
      const newConfig = await runMessengerOnboarding(config)
      if (!newConfig) {
        console.log('\n❌ Onboarding cancelled.')
        console.log('Run "im-hub config <messenger>" to configure manually.')
        process.exit(1)
      }
      config = newConfig
      await saveConfig(config)
    }

    // Check agents (async, AFTER plugins loaded)
    const agentResult = await checkAgentAvailability()
    if (agentResult.allMissing) {
      console.log('\n⚠️ No coding agents found!')
      console.log(formatAgentInstallHint(agentResult.missing))
      console.log('\nInstall at least one agent, then run im-hub start again.')
      process.exit(1)
    } else if (agentResult.missing.length > 0) {
      console.log('⚠️ Some agents not available:', agentResult.missing.join(', '))
      console.log('   ' + formatAgentInstallHint(agentResult.missing))
      console.log('')
    }

    // Set defaultAgent to first available installed agent
    if (agentResult.available.length > 0) {
      config.defaultAgent = agentResult.available[0]
    }

    // ============================================
    // START MESSENGERS
    // ============================================

    // Get messengers to start (now config.messengers is populated)
    const messengersToStart = config.messengers.length > 0
      ? config.messengers
      : ['wechat-ilink'] // Fallback default

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
        const errMsg = error instanceof Error ? error.message : String(error)
        console.error(`❌ Failed to start messenger ${name}:`)
        console.error(`   ${errMsg}`)
        // Show actionable next step, not stack trace
        const hint = formatMessengerStartError(name, error)
        if (hint !== errMsg) {
          console.error(`   ${hint}`)
        }
      }
    }

    console.log('\n✅ IM hub is running!')
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
  const { message, platform, channelId } = ctx
  console.log(`[handleMessage] Received: "${message.text}" from ${message.threadId}`)
  console.log(`[handleMessage] platform=${platform}, channelId=${channelId}`)

  const messengerName = platform === 'wechat' ? 'wechat-ilink' : platform
  console.log(`[handleMessage] Getting messenger: ${messengerName}`)
  const messenger = registry.getMessenger(messengerName)

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
      channelId: ctx.channelId,
      platform,
      defaultAgent,
    })
    console.log(`[handleMessage] Route result type:`, typeof result)

    // Handle response (string or async generator)
    if (typeof result === 'string') {
      console.log(`[handleMessage] Sending string response:`, result.substring(0, 100))
      await stopTyping()

      // For Feishu, use cards for better formatting
      if (platform === 'feishu' && messenger.sendCard) {
        const { CardBuilder } = await import('./plugins/messengers/feishu/card-builder.js')
        const card = new CardBuilder()
          .addMarkdown(result)
          .addAgentBadge(ctx.session?.agent || defaultAgent)
          .build()
        await messenger.sendCard(message.threadId, card)
      } else {
        await messenger.sendMessage(message.threadId, result)
      }
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

        // For Feishu, use cards for better formatting
        if (platform === 'feishu' && messenger.sendCard) {
          const { CardBuilder } = await import('./plugins/messengers/feishu/card-builder.js')
          const card = new CardBuilder()
            .addMarkdown(fullResponse)
            .addAgentBadge(ctx.session?.agent || defaultAgent)
            .build()
          await messenger.sendCard(message.threadId, card)
        } else {
          await messenger.sendMessage(message.threadId, fullResponse)
        }
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
      console.log('  wechat   - WeChat adapter')
      console.log('  telegram - Telegram adapter')
      console.log('  feishu   - Feishu/Lark adapter')
      console.log('\nAgents:')
      console.log('  claude   - Claude Code agent')
      console.log('  codex    - OpenAI Codex CLI agent')
      console.log('  opencode - OpenCode CLI agent')
      console.log('  copilot  - GitHub Copilot CLI agent')
      console.log('\nRemote Agents:')
      console.log('  agent    - Add a remote ACP agent')
      console.log('\nUsage: im-hub config <component>')
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
        const checkClaude = crossSpawn('claude', ['--version'], { stdio: 'ignore' })
        checkClaude.on('close', (code) => {
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

      case 'codex':
        console.log('🤖 Configuring Codex agent...')
        const checkCodex = crossSpawn('codex', ['--version'], { stdio: 'ignore' })
        checkCodex.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Codex CLI found!')
          } else {
            console.log('❌ Codex CLI not found.')
            console.log('Install with: npm install -g @openai/codex')
          }
        })
        if (!config.agents.includes('codex')) {
          config.agents.push('codex')
        }
        config.defaultAgent = 'codex'
        break

      case 'opencode':
        console.log('🤖 Configuring OpenCode agent...')
        const checkOpenCode = crossSpawn('opencode', ['--version'], { stdio: 'ignore' })
        checkOpenCode.on('error', () => {
          console.log('❌ OpenCode CLI not found.')
          console.log('Install with: npm i -g opencode-ai')
        })
        checkOpenCode.on('close', (code) => {
          if (code === 0) {
            console.log('✅ OpenCode CLI found!')
          }
        })
        if (!config.agents.includes('opencode')) {
          config.agents.push('opencode')
        }
        config.defaultAgent = 'opencode'
        break

      case 'telegram':
        console.log('📱 Configuring Telegram adapter...')
        console.log('To get a bot token:')
        console.log('1. Open Telegram and search for @BotFather')
        console.log('2. Send /newbot and follow instructions')
        console.log('3. Copy the bot token\n')

        const { createInterface } = await import('readline')
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        })

        const token = await new Promise<string>((resolve) => {
          rl.question('Enter your bot token: ', (answer) => {
            resolve(answer.trim())
          })
        })

        if (!token) {
          console.log('❌ Bot token is required')
          return
        }

        const channelId = await new Promise<string>((resolve) => {
          rl.question('Enter channel ID (optional, press Enter for default): ', (answer) => {
            resolve(answer.trim() || 'default')
          })
        })

        rl.close()

        config.telegram = { botToken: token, channelId }
        if (!config.messengers.includes('telegram')) {
          config.messengers.push('telegram')
        }

        console.log('✅ Telegram bot token saved')
        console.log(`   Channel ID: ${channelId}`)
        break

      case 'feishu':
        console.log('📱 Configuring Feishu adapter (WebSocket long polling mode)...')
        console.log('To create a Feishu bot:')
        console.log('1. Go to https://open.feishu.cn/app')
        console.log('2. Create a custom bot app')
        console.log('3. Enable Bot capability')
        console.log('4. Configure event subscriptions (Subscribe to "im.message.receive_v1" event)')
        console.log('5. Go to Permissions management and enable: im:message, im:message.p2p_msg:readonly, im:message:send_as_bot')
        console.log('6. Create a version and publish it')
        console.log('7. Copy App ID and App Secret\n')

        const { createInterface: createRl } = await import('readline')
        const feishuRl = createRl({
          input: process.stdin,
          output: process.stdout,
        })

        const appId = await new Promise<string>((resolve) => {
          feishuRl.question('Enter App ID: ', (answer) => {
            resolve(answer.trim())
          })
        })

        const appSecret = await new Promise<string>((resolve) => {
          feishuRl.question('Enter App Secret: ', (answer) => {
            resolve(answer.trim())
          })
        })

        feishuRl.close()

        if (!appId || !appSecret) {
          console.log('❌ App ID and App Secret are required')
          return
        }

        config.feishu = {
          appId,
          appSecret
        }
        if (!config.messengers.includes('feishu')) {
          config.messengers.push('feishu')
        }

        console.log('✅ Feishu bot credentials saved')
        console.log(`\n✅ Using WebSocket long polling mode - no webhook configuration needed!`)
        console.log(`   The bot will automatically connect to Feishu servers.`)
        break

      case 'opencode':
        console.log('🤖 Configuring OpenCode agent...')
        // Check if opencode CLI is available
        const openCodeAvailable = await new Promise<boolean>((resolve) => {
          const proc = crossSpawn('opencode', ['--version'], { stdio: 'ignore' })
          proc.on('error', () => resolve(false))
          proc.on('close', (code) => resolve(code === 0))
        })
        if (openCodeAvailable) {
          console.log('✅ OpenCode CLI found!')
          console.log('\nTo authenticate, run: opencode auth login')
        } else {
          console.log('❌ OpenCode CLI not found.')
          console.log('Install with: npm i -g opencode-ai@latest')
          console.log('Or visit: https://github.com/anomalyco/opencode')
        }
        if (!config.agents.includes('opencode')) {
          config.agents.push('opencode')
        }
        config.defaultAgent = 'opencode'
        break

      case 'copilot':
        console.log('🤖 Configuring GitHub Copilot CLI agent...')
        // Check if copilot CLI is available (multiple installation methods)
        const { CopilotAdapter } = await import('./plugins/agents/copilot/index.js')
        const copilotAdapter = new CopilotAdapter()
        const copilotAvailable = await copilotAdapter.isAvailable()
        if (copilotAvailable) {
          console.log('✅ GitHub Copilot CLI found!')
        } else {
          console.log('❌ GitHub Copilot CLI not found.')
          console.log('\n安装方式 (选择其一):')
          console.log('  npm i -g @github/copilot')
          console.log('  gh extension install github/gh-copilot')
          if (isMac) {
            console.log('  brew install copilot-cli')
          }
          if (isWindows) {
            console.log('  winget install GitHub.Copilot')
          }
          console.log('  或安装 VS Code Copilot Chat 扩展')
          console.log('\n详情: https://github.com/features/copilot/cli')
        }
        if (!config.agents.includes('copilot')) {
          config.agents.push('copilot')
        }
        config.defaultAgent = 'copilot'
        break

      case 'agent':
        console.log('🔌 Configuring remote ACP agent...')
        console.log('This adds a remote agent that speaks the Agent Communication Protocol.')
        console.log('ACP is an open standard (https://agentcommunicationprotocol.dev)\n')

        const { createInterface: createAgentRl } = await import('readline')
        const agentRl = createAgentRl({ input: process.stdin, output: process.stdout })

        const agentName = await new Promise<string>((resolve) => {
          agentRl.question('Agent name (e.g. openclaw-dev): ', (answer) => resolve(answer.trim()))
        })
        if (!agentName) { console.log('❌ Name is required'); agentRl.close(); return }

        const agentAlias = await new Promise<string>((resolve) => {
          agentRl.question('Aliases, comma-separated (optional): ', (answer) => resolve(answer.trim()))
        })

        const endpoint = await new Promise<string>((resolve) => {
          agentRl.question('ACP endpoint URL (e.g. http://localhost:8080): ', (answer) => resolve(answer.trim()))
        })
        if (!endpoint) { console.log('❌ Endpoint is required'); agentRl.close(); return }

        console.log('\nAuthentication type:')
        console.log('  1. none')
        console.log('  2. apikey')
        console.log('  3. bearer')
        const authTypeInput = await new Promise<string>((resolve) => {
          agentRl.question('Choose (1-3, default: none): ', (answer) => resolve(answer.trim() || '1'))
        })
        const authTypeMap: Record<string, 'none' | 'apikey' | 'bearer'> = { '1': 'none', '2': 'apikey', '3': 'bearer' }
        const authType = authTypeMap[authTypeInput] || 'none'

        let auth: { type: 'none' | 'apikey' | 'bearer'; token?: string } | undefined
        if (authType !== 'none') {
          const token = await new Promise<string>((resolve) => {
            agentRl.question('Auth token: ', (answer) => resolve(answer.trim()))
          })
          if (!token) { console.log('❌ Token is required when auth is enabled'); agentRl.close(); return }
          auth = { type: authType, token }
        }
        agentRl.close()

        // Validate connection
        console.log('\n🔍 Testing connection...')
        const { ACPClient } = await import('./plugins/agents/acp/acp-client.js')
        const testClient = new ACPClient({ name: agentName, endpoint, auth: auth as any })
        try {
          const manifest = await testClient.fetchManifest()
          console.log(`✅ Connected! Agent: ${manifest.name}`)
          if (manifest.description) console.log(`   ${manifest.description}`)
        } catch (e: any) {
          console.log(`⚠️  Connection failed: ${e.message}`)
          console.log('   Agent will be saved but may not work until endpoint is available.')
        }

        // Save
        if (!config.acpAgents) config.acpAgents = []
        const existing = config.acpAgents.findIndex(a => a.name === agentName)
        const agentConfig = {
          name: agentName,
          aliases: agentAlias?.split(',').map(s => s.trim()).filter(Boolean) || [],
          endpoint,
          auth,
          enabled: true
        }

        if (existing >= 0) {
          config.acpAgents[existing] = agentConfig
        } else {
          config.acpAgents.push(agentConfig)
        }
        break

      default:
        console.log(`Unknown component: ${component}`)
        console.log('Run "im-hub config" to see available components.')
        return
    }

    await saveConfig(config)
    console.log(`\n✅ Configuration saved to ${CONFIG_FILE}`)
  })

program
  .command('agents')
  .description('List available agents')
  .action(async () => {
    const agents = registry.listAgents()
    if (agents.length === 0) {
      console.log('No agents registered yet.')
      console.log('Run "im-hub config claude" to configure Claude Code.')
      console.log('Run "im-hub config agent" to add a remote ACP agent.')
      return
    }

    console.log('🤖 Checking agents...\n')

    // Check all agents in parallel to avoid slow sequential timeouts
    const results = await Promise.allSettled(
      agents.map(async (name) => {
        const agent = registry.getAgent(name)
        const available = await agent?.isAvailable().catch(() => false)

        // Check if this is an ACP agent with extra info
        let info = ''
        try {
          const { ACPAdapter } = await import('./plugins/agents/acp/acp-adapter.js')
          if (agent instanceof ACPAdapter) {
            const manifest = await agent.getManifest().catch(() => undefined)
            if (manifest) {
              info = ` — ${manifest.description || 'Remote ACP agent'}`
            }
          }
        } catch { /* not an ACP agent */ }

        return { name, available, aliases: agent?.aliases || [], info }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, available, aliases, info } = result.value
        const aliasStr = aliases.length ? ` (${aliases.join(', ')})` : ''
        console.log(`  ${available ? '✅' : '❌'} ${name}${aliasStr}${info}`)
      }
    }
  })

program
  .command('messengers')
  .description('List available messengers')
  .action(() => {
    const messengers = registry.listMessengers()
    if (messengers.length === 0) {
      console.log('No messengers registered yet.')
      console.log('Run "im-hub config wechat" to configure WeChat.')
      return
    }
    console.log('📱 Available Messengers:\n')
    for (const name of messengers) {
      console.log(`  ${name}`)
    }
  })

program.parse()
