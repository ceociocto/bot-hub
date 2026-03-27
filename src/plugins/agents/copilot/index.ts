// GitHub Copilot CLI agent adapter
// Uses `github-copilot` CLI for programmatic interaction

import type { AgentAdapter } from '../../../core/types.js'
import { crossSpawn } from '../../../utils/cross-platform.js'

// The CLI command name
const COPILOT_CMD = 'github-copilot'

export class CopilotAdapter implements AgentAdapter {
  readonly name = 'copilot'
  readonly aliases = ['gh', 'github', 'copilotcli']

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = crossSpawn(COPILOT_CMD, ['--version'], { stdio: 'ignore' })
      proc.on('error', () => resolve(false))
      proc.on('close', (code) => resolve(code === 0))
    })
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
      const proc = crossSpawn(COPILOT_CMD, [
        'ask',
        prompt,
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

        // Check for quota error regardless of exit code
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
