// GitHub Copilot CLI agent adapter
// Supports multiple installation methods:
// 1. GitHub CLI extension: `gh copilot` (recommended)
// 2. Standalone npm: `copilot` command
// 3. VS Code extension: bundled copilot CLI
// 4. Homebrew (macOS): `brew install copilot-cli`
// 5. WinGet (Windows): `winget install GitHub.Copilot`

import { access, constants, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentAdapter } from '../../../core/types.js'
import { crossSpawn, isWindows, isMac } from '../../../utils/cross-platform.js'

// Installation method detection result
interface CopilotInstall {
  type: 'gh-ext' | 'standalone' | 'vscode' | 'homebrew' | 'winget'
  command: string
  args: string[]
}

/**
 * Check if a command exists and can be executed
 */
async function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = crossSpawn(cmd, ['--version'], { stdio: 'ignore' })
    proc.on('error', () => resolve(false))
    proc.on('close', (code) => resolve(code === 0))
  })
}

/**
 * Check if GitHub CLI has copilot extension
 */
async function checkGHCopilot(): Promise<CopilotInstall | null> {
  // Check if gh is available
  const ghExists = await commandExists('gh')
  if (!ghExists) return null

  // Check if copilot extension is installed
  return new Promise((resolve) => {
    const proc = crossSpawn('gh', ['copilot', '--version'], { stdio: 'ignore' })
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ type: 'gh-ext', command: 'gh', args: ['copilot'] })
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Check if standalone copilot command exists
 */
async function checkStandaloneCopilot(): Promise<CopilotInstall | null> {
  const exists = await commandExists('copilot')
  if (exists) {
    return { type: 'standalone', command: 'copilot', args: [] }
  }
  return null
}

/**
 * Get Copilot CLI binary path from VS Code extension.
 * Used as fallback if no command is found in PATH.
 */
async function findVSCodeCopilot(): Promise<CopilotInstall | null> {
  // macOS: standard location
  if (isMac) {
    const macPath = join(
      homedir(),
      'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot'
    )
    try {
      await access(macPath, constants.X_OK)
      return { type: 'vscode', command: macPath, args: [] }
    } catch {
      // Continue to other checks
    }
  }

  // Windows: need to find the extension folder (versioned)
  if (isWindows) {
    const extensionsDir = join(homedir(), '.vscode', 'extensions')
    try {
      const entries = await readdir(extensionsDir, { withFileTypes: true })
      const copilotDir = entries.find(
        (entry) => entry.isDirectory() && entry.name.startsWith('github.copilot-chat-')
      )
      if (copilotDir) {
        const copilotBin = join(extensionsDir, copilotDir.name, 'copilotCli', 'copilot.exe')
        try {
          await access(copilotBin, constants.X_OK)
          return { type: 'vscode', command: copilotBin, args: [] }
        } catch {
          // Continue
        }
      }
    } catch {
      // Ignore readdir errors
    }
  }

  // Linux: standard location
  const linuxPath = join(
    homedir(),
    '.vscode/extensions/github.copilot-chat/copilotCli/copilot'
  )
  try {
    await access(linuxPath, constants.X_OK)
    return { type: 'vscode', command: linuxPath, args: [] }
  } catch {
    return null
  }
}

// Cached installation info
let cachedInstall: CopilotInstall | null = null

/**
 * Detect Copilot installation method
 * Priority: gh copilot > standalone > VS Code extension
 */
async function detectCopilotInstall(): Promise<CopilotInstall | null> {
  if (cachedInstall) return cachedInstall

  // 1. Check GitHub CLI extension (recommended)
  cachedInstall = await checkGHCopilot()
  if (cachedInstall) return cachedInstall

  // 2. Check standalone copilot command
  cachedInstall = await checkStandaloneCopilot()
  if (cachedInstall) return cachedInstall

  // 3. Check VS Code extension
  cachedInstall = await findVSCodeCopilot()
  return cachedInstall
}

export class CopilotAdapter implements AgentAdapter {
  readonly name = 'copilot'
  readonly aliases = ['gh', 'github', 'copilotcli', 'ghcp']

  async isAvailable(): Promise<boolean> {
    const install = await detectCopilotInstall()
    return install !== null
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[Copilot] sendPrompt called, prompt: ${prompt}`)

    const install = await detectCopilotInstall()
    if (!install) {
      yield `❌ Copilot CLI 未找到。

安装方式 (选择其一):
  npm i -g @github/copilot
  gh extension install github/gh-copilot
  brew install copilot-cli (macOS)
  winget install GitHub.Copilot (Windows)

或安装 VS Code Copilot Chat 扩展。`
      return
    }

    console.log(`[Copilot] Using installation: ${install.type} (${install.command})`)
    const response = await this.callCopilot(prompt, install)
    console.log(`[Copilot] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callCopilot(prompt: string, install: CopilotInstall): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build command args based on installation type
      let args: string[]
      if (install.type === 'gh-ext') {
        // gh copilot suggest "prompt"
        args = [...install.args, 'suggest', prompt, '--prompt-only']
      } else {
        // copilot -p "prompt" -s
        args = [...install.args, '-p', prompt, '-s']
      }

      const proc = crossSpawn(install.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.error('[Copilot stderr]', data.toString())
      })

      proc.on('error', (err) => {
        reject(err)
      })

      proc.on('close', (code) => {
        console.log('[Copilot] Process closed, code:', code)

        // Check for quota error
        if (stderr.includes('402') || stderr.includes('no quota') || stderr.includes('insufficient')) {
          resolve(`❌ Copilot 额度不足，请检查您的 GitHub Copilot 订阅。

💡 可以使用以下命令切换到其他 Agent：
• /claude - 切换到 Claude Code
• /codex - 切换到 OpenAI Codex
• /agents - 查看所有可用 Agent`)
          return
        }

        if (code !== 0) {
          reject(new Error(`Copilot exited with code ${code}: ${stderr}`))
        } else {
          const result = stdout.trim()
          if (!result) {
            resolve(`❌ Copilot 返回空响应，可能是额度不足或网络问题。

💡 可以使用以下命令切换到其他 Agent：
• /claude - 切换到 Claude Code
• /codex - 切换到 OpenAI Codex
• /agents - 查看所有可用 Agent`)
          } else {
            resolve(result)
          }
        }
      })
    })
  }
}

// Singleton instance
export const copilotAdapter = new CopilotAdapter()
