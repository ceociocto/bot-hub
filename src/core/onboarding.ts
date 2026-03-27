// Onboarding module - friendly first-run experience
// Handles messenger config checks, agent availability, and interactive setup

import { createInterface } from 'readline'
import { homedir } from 'os'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { registry } from './registry.js'

const CONFIG_DIR = join(homedir(), '.im-hub')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// ============================================
// Types
// ============================================

export interface OnboardingResult {
  needsOnboarding: boolean
  availableMessengers: MessengerInfo[]
  warnings?: string[]
}

export interface MessengerInfo {
  id: string
  displayName: string
  description: string
}

export interface AgentCheckResult {
  available: string[]
  missing: string[]
  allMissing: boolean
}

export interface AgentInstallHint {
  agent: string
  npmPackage: string
  command: string
}

export interface Config {
  messengers: string[]
  agents: string[]
  defaultAgent: string
  telegram?: { botToken: string; channelId?: string }
  feishu?: { appId: string; appSecret: string; channelId?: string }
  [key: string]: unknown
}

// ============================================
// Constants
// ============================================

const AVAILABLE_MESSENGERS: MessengerInfo[] = [
  { id: 'wechat-ilink', displayName: 'WeChat', description: 'Scan QR to login' },
  { id: 'telegram', displayName: 'Telegram', description: 'Bot token from @BotFather' },
  { id: 'feishu', displayName: 'Feishu/Lark', description: 'App ID and Secret' },
]

const AGENT_PACKAGES: Record<string, AgentInstallHint> = {
  'claude-code': { agent: 'claude-code', npmPackage: '@anthropic-ai/claude-code', command: 'claude' },
  'codex': { agent: 'codex', npmPackage: '@openai/codex', command: 'codex' },
  'copilot': { agent: 'copilot', npmPackage: '@github/copilot', command: 'copilot' },
  'opencode': { agent: 'opencode', npmPackage: 'opencode-ai', command: 'opencode' },
}

// ============================================
// Agent availability cache
// ============================================

let agentCheckCache: AgentCheckResult | null = null

// ============================================
// Config helpers (extracted for reuse)
// ============================================

export async function loadConfig(): Promise<Config> {
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

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
}

// ============================================
// Readline helper
// ============================================

function createPromptInterface(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

// ============================================
// 1. checkMessengerConfig (SYNC)
// ============================================

/**
 * Check if messengers are configured.
 * IMPORTANT: This checks the config.messengers array BEFORE any default fill.
 */
export function checkMessengerConfig(config: Config): OnboardingResult {
  if (config.messengers.length === 0) {
    return {
      needsOnboarding: true,
      availableMessengers: AVAILABLE_MESSENGERS,
    }
  }

  return {
    needsOnboarding: false,
    availableMessengers: [],
    warnings: [],
  }
}

// ============================================
// 2. checkAgentAvailability (ASYNC, CACHED)
// ============================================

/**
 * Check which agents are available.
 * MUST be called AFTER registry.loadBuiltInPlugins().
 * Result is cached for the session.
 */
export async function checkAgentAvailability(): Promise<AgentCheckResult> {
  // Return cached result if available
  if (agentCheckCache) {
    return agentCheckCache
  }

  const agentNames = registry.listAgents()
  const available: string[] = []
  const missing: string[] = []

  for (const name of agentNames) {
    const agent = registry.findAgent(name)
    if (agent) {
      try {
        const isAvail = await agent.isAvailable()
        if (isAvail) {
          available.push(name)
        } else {
          missing.push(name)
        }
      } catch {
        missing.push(name)
      }
    }
  }

  const result: AgentCheckResult = {
    available,
    missing,
    allMissing: available.length === 0,
  }

  // Cache the result
  agentCheckCache = result
  return result
}

/**
 * Check if a specific agent is available (uses cache)
 */
export async function isAgentAvailableCached(agentName: string): Promise<boolean> {
  const result = await checkAgentAvailability()
  return result.available.includes(agentName)
}

// ============================================
// 3. formatAgentInstallHint
// ============================================

/**
 * Generate friendly install message for missing agents
 */
export function formatAgentInstallHint(missing: string[]): string {
  if (missing.length === 0) return ''

  const getInstallHint = (name: string): string => {
    const hint = AGENT_PACKAGES[name]
    if (!hint) return `npm i -g ${name}`
    return `npm i -g ${hint.npmPackage}`
  }

  if (missing.length === 1) {
    return `Install ${missing[0]}: ${getInstallHint(missing[0])}`
  }

  const hints = missing.map((name) => `  - ${name}: ${getInstallHint(name)}`)
  return `Install agents:\n${hints.join('\n')}`
}

/**
 * Format error message when agent is not available
 */
export function formatAgentNotAvailableError(agentName: string): string {
  let installHint: string

  if (agentName === 'copilot') {
    installHint = `安装方式 (选择其一):
  npm i -g @github/copilot
  gh extension install github/gh-copilot
  brew install copilot-cli (macOS)
  winget install GitHub.Copilot (Windows)
  或安装 VS Code Copilot Chat 扩展`
  } else {
    const hint = AGENT_PACKAGES[agentName]
    installHint = hint ? `npm i -g ${hint.npmPackage}` : `npm i -g ${agentName}`
  }

  return `❌ ${agentName} is not installed or not available.\n\n${installHint}\n\nOr try another agent:\n  /cc - Claude Code\n  /cx - Codex\n  /co - Copilot\n  /oc - OpenCode`
}

// ============================================
// 4. runMessengerOnboarding
// ============================================

/**
 * Interactive onboarding flow.
 * Returns updated config on success, null on failure/cancel.
 */
export async function runMessengerOnboarding(config: Config): Promise<Config | null> {
  // Non-interactive fallback
  if (!process.stdin.isTTY) {
    console.log('❌ No messengers configured. Run interactively:')
    console.log('   im-hub config wechat')
    console.log('   im-hub config telegram')
    console.log('   im-hub config feishu')
    return null
  }

  const rl = createPromptInterface()

  try {
    while (true) {
      // Show menu
      console.log('\n📱 Let\'s set up a messenger:\n')
      AVAILABLE_MESSENGERS.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.displayName} - ${m.description}`)
      })
      console.log(`  Q. Quit and configure manually\n`)

      const choice = await prompt(rl, 'Select a messenger (1-3 or Q): ')

      // Handle quit
      if (choice.toLowerCase() === 'q' || choice === '') {
        console.log('\n❌ Onboarding cancelled.')
        console.log('Run "im-hub config <messenger>" to configure manually.')
        return null
      }

      const index = parseInt(choice, 10) - 1
      if (index < 0 || index >= AVAILABLE_MESSENGERS.length) {
        console.log('Invalid choice. Please enter 1-3 or Q.')
        continue
      }

      const selected = AVAILABLE_MESSENGERS[index]

      // Run the config flow
      const result = await configureMessenger(selected.id, config, rl)

      if (result) {
        rl.close()
        return result
      }

      // Config failed - show retry menu
      console.log(`\n❌ Failed to configure ${selected.displayName}.`)
      const retry = await prompt(rl, '[R] Retry, [S] Select different, [Q] Quit: ')

      if (retry.toLowerCase() === 'q') {
        rl.close()
        return null
      } else if (retry.toLowerCase() === 's') {
        continue // Back to menu
      }
      // 'r' or anything else = retry same messenger (loop continues)
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`\n❌ Onboarding error: ${errMsg}`)
    rl.close()
    return null
  }
}

// ============================================
// Messenger config flows
// ============================================

async function configureMessenger(
  messengerId: string,
  config: Config,
  rl: ReturnType<typeof createInterface>
): Promise<Config | null> {
  switch (messengerId) {
    case 'wechat-ilink':
      return configureWeChat(config, rl)
    case 'telegram':
      return configureTelegram(config, rl)
    case 'feishu':
      return configureFeishu(config, rl)
    default:
      console.log(`Unknown messenger: ${messengerId}`)
      return null
  }
}

async function configureWeChat(config: Config, _rl: ReturnType<typeof createInterface>): Promise<Config | null> {
  console.log('\n📱 Configuring WeChat...')
  console.log('Fetching QR code...\n')

  try {
    const { ILinkWeChatAdapter } = await import('../plugins/messengers/wechat/ilink-adapter.js')
    const adapter = new ILinkWeChatAdapter()

    const { qrUrl, qrToken } = await adapter.startQRLogin()

    console.log('📱 Scan this QR code with WeChat:\n')
    console.log(qrUrl)
    console.log('\n')

    const credentials = await adapter.waitForQRLogin(qrToken, (status) => {
      console.log(`[${new Date().toLocaleTimeString()}] ${status}`)
    })

    if (credentials) {
      console.log(`\n✅ Logged in as ${credentials.userId}`)
      console.log(`   Bot ID: ${credentials.accountId}`)

      if (!config.messengers.includes('wechat-ilink')) {
        config.messengers.push('wechat-ilink')
      }

      return config
    } else {
      console.log('\n❌ Login failed or timed out')
      return null
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`\n❌ Failed to configure WeChat: ${errMsg}`)
    return null
  }
}

async function configureTelegram(config: Config, rl: ReturnType<typeof createInterface>): Promise<Config | null> {
  console.log('\n📱 Configuring Telegram...')
  console.log('To get a bot token:')
  console.log('1. Open Telegram and search for @BotFather')
  console.log('2. Send /newbot and follow instructions')
  console.log('3. Copy the bot token\n')

  const token = await prompt(rl, 'Enter your bot token: ')

  if (!token) {
    console.log('❌ Bot token is required')
    return null
  }

  const channelId = await prompt(rl, 'Enter channel ID (optional, press Enter for default): ')

  config.telegram = { botToken: token, channelId: channelId || 'default' }
  if (!config.messengers.includes('telegram')) {
    config.messengers.push('telegram')
  }

  console.log('✅ Telegram bot token saved')
  console.log(`   Channel ID: ${config.telegram.channelId}`)

  return config
}

async function configureFeishu(config: Config, rl: ReturnType<typeof createInterface>): Promise<Config | null> {
  console.log('\n📱 Configuring Feishu (WebSocket long polling mode)...')
  console.log('To create a Feishu bot:')
  console.log('1. Go to https://open.feishu.cn/app')
  console.log('2. Create a custom bot app')
  console.log('3. Enable Bot capability')
  console.log('4. Configure event subscriptions (Subscribe to "Receive Message" event)')
  console.log('5. Copy App ID and App Secret\n')

  const appId = await prompt(rl, 'Enter App ID: ')
  const appSecret = await prompt(rl, 'Enter App Secret: ')

  if (!appId || !appSecret) {
    console.log('❌ App ID and App Secret are required')
    return null
  }

  config.feishu = { appId, appSecret }
  if (!config.messengers.includes('feishu')) {
    config.messengers.push('feishu')
  }

  console.log('✅ Feishu bot credentials saved')
  console.log('\n✅ Using WebSocket long polling mode - no webhook configuration needed!')
  console.log('   The bot will automatically connect to Feishu servers.')

  return config
}

// ============================================
// Error message formatter for messenger.start()
// ============================================

/**
 * Format a user-friendly error message for messenger startup failures
 */
export function formatMessengerStartError(messengerName: string, error: unknown): string {
  const errMsg = error instanceof Error ? error.message : String(error)

  // Check for credential/auth errors
  if (errMsg.toLowerCase().includes('credentials') || errMsg.toLowerCase().includes('auth')) {
    const configName = messengerName.replace('-ilink', '')
    return `Run "im-hub config ${configName}" to reconfigure.`
  }

  // Generic error
  return errMsg
}
