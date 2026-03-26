// GitHub Copilot CLI agent adapter
// Uses `copilot -p "prompt" -s` for programmatic interaction

import { access, constants, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentAdapter } from '../../../core/types.js'
import { crossSpawn, isWindows, isMac } from '../../../utils/cross-platform.js'

/**
 * Get Copilot CLI binary path based on the current platform.
 * Copilot CLI is installed by VS Code extension in different locations per OS.
 */
async function findCopilotBin(): Promise<string | null> {
  // macOS: standard location
  if (isMac) {
    const macPath = join(
      homedir(),
      'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot'
    )
    try {
      await access(macPath, constants.X_OK)
      return macPath
    } catch {
      return null
    }
  }

  // Windows: need to find the extension folder (versioned)
  if (isWindows) {
    const extensionsDir = join(homedir(), '.vscode', 'extensions')
    try {
      const entries = await readdir(extensionsDir, { withFileTypes: true })
      // Find copilot-chat extension folder (versioned, e.g., github.copilot-chat-0.20.0)
      const copilotDir = entries.find(
        (entry) => entry.isDirectory() && entry.name.startsWith('github.copilot-chat-')
      )
      if (copilotDir) {
        const copilotBin = join(extensionsDir, copilotDir.name, 'copilotCli', 'copilot.exe')
        try {
          await access(copilotBin, constants.X_OK)
          return copilotBin
        } catch {
          // Binary not executable, continue
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
    return linuxPath
  } catch {
    return null
  }
}

// Cached binary path
let cachedCopilotBin: string | null = null

export class CopilotAdapter implements AgentAdapter {
  readonly name = 'copilot'
  readonly aliases = ['gh', 'github', 'copilotcli']

  async isAvailable(): Promise<boolean> {
    // Check if binary exists (don't require quota to pass availability check)
    if (!cachedCopilotBin) {
      cachedCopilotBin = await findCopilotBin()
    }
    return cachedCopilotBin !== null
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[Copilot] sendPrompt called, prompt: ${prompt}`)

    if (!cachedCopilotBin) {
      cachedCopilotBin = await findCopilotBin()
    }

    if (!cachedCopilotBin) {
      yield `❌ Copilot CLI 未找到。

请确保已安装 VS Code Copilot Chat 扩展。
${isWindows ? 'Windows 用户请确保扩展安装在 %USERPROFILE%\\.vscode\\extensions 目录下。' : ''}`
      return
    }

    const response = await this.callCopilot(prompt, cachedCopilotBin)
    console.log(`[Copilot] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callCopilot(prompt: string, copilotBin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = crossSpawn(copilotBin, [
        '-p', prompt,
        '-s',  // suppress stats, output only response
      ], {
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

        // Check for quota error regardless of exit code (copilot returns 0 even on 402)
        if (stderr.includes('402') || stderr.includes('no quota')) {
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
