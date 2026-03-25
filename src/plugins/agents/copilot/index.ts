// GitHub Copilot CLI agent adapter
// Uses `copilot -p "prompt" -s` for programmatic interaction

import { spawn } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentAdapter } from '../../../core/types.js'

// Copilot CLI binary path (installed by VS Code extension)
const COPILOT_BIN = join(
  homedir(),
  'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot'
)

export class CopilotAdapter implements AgentAdapter {
  readonly name = 'copilot'
  readonly aliases = ['gh', 'github', 'copilotcli']

  async isAvailable(): Promise<boolean> {
    // Check if binary exists (don't require quota to pass availability check)
    const fs = await import('fs')
    try {
      await fs.promises.access(COPILOT_BIN, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[Copilot] sendPrompt called, prompt: ${prompt}`)

    const response = await this.callCopilot(prompt)
    console.log(`[Copilot] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callCopilot(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(COPILOT_BIN, [
        '-p', prompt,
        '-s',  // suppress stats, output only response
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
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
