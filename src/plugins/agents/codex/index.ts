// OpenAI Codex CLI agent adapter
// Uses `codex exec --json` for programmatic interaction

import { spawn } from 'child_process'
import type { AgentAdapter } from '../../../core/types.js'

interface CodexEvent {
  type: string
  message?: {
    content?: Array<{ type: string; text?: string }>
  } | string
  text?: string
  error?: string
  error_message?: string
}

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex'
  readonly aliases = ['cx', 'openai', 'codexcli']

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('codex', ['--version'], { stdio: 'ignore' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[Codex] sendPrompt called, prompt: ${prompt}`)

    const response = await this.callCodex(prompt)
    console.log(`[Codex] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callCodex(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('codex', [
        'exec',
        '--json',
        '--full-auto',
        '--skip-git-repo-check',
        prompt,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let fullText = ''
      let errorMessage = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
        const lines = stdout.split('\n')
        stdout = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const event: CodexEvent = JSON.parse(line)
            console.log('[Codex] Event type:', event.type)

            // Capture error message
            if (event.type === 'error') {
              const msg = event.message
              errorMessage = typeof msg === 'string' ? msg : (event.error || event.error_message || 'Unknown error')
            }

            const text = this.extractText(event)
            if (text) {
              fullText += text
            }
          } catch {
            // Skip malformed JSON
          }
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.error('[Codex stderr]', data.toString())
      })

      proc.on('error', (err) => {
        reject(err)
      })

      proc.on('close', (code) => {
        console.log('[Codex] Process closed, code:', code)
        if (code !== 0) {
          // Return user-friendly error message
          let errorMsg = 'Codex 执行失败'
          if (errorMessage.includes('expired') || errorMessage.includes('过期')) {
            errorMsg = 'Codex 账号已过期'
          } else if (errorMessage.includes('not found') || errorMessage.includes('不存在')) {
            errorMsg = 'Codex 用户不存在，请重新登录'
          } else if (errorMessage.length > 0 && errorMessage.length < 100) {
            errorMsg = errorMessage
          }
          resolve(`❌ Codex 错误: ${errorMsg}\n\n请运行 \`codex login\` 重新登录。`)
        } else {
          resolve(fullText)
        }
      })
    })
  }

  private extractText(event: CodexEvent): string {
    // Handle message events with content
    if (event.type === 'message' && event.message && typeof event.message === 'object' && event.message.content) {
      const textParts: string[] = []
      for (const item of event.message.content) {
        if (item.type === 'text' && item.text) {
          textParts.push(item.text)
        }
      }
      return textParts.join('')
    }

    // Handle simple text events
    if (event.text) {
      return event.text
    }

    // Handle message field (used in some events)
    if (typeof event.message === 'string') {
      return event.message
    }

    return ''
  }
}

// Singleton instance
export const codexAdapter = new CodexAdapter()
