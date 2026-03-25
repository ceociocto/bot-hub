// OpenCode CLI agent adapter
// Uses `opencode run --format json` for programmatic interaction

import { spawn } from 'child_process'
import type { AgentAdapter } from '../../../core/types.js'

interface OpenCodePart {
  type: string
  text?: string
}

interface OpenCodeEvent {
  type: string
  content?: string
  text?: string
  message?: string
  error?: string
  part?: OpenCodePart
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode'
  readonly aliases = ['oc', 'opencodeai']

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('opencode', ['--version'], { stdio: 'ignore' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[OpenCode] sendPrompt called, prompt: ${prompt}`)

    const response = await this.callOpenCode(prompt)
    console.log(`[OpenCode] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callOpenCode(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('opencode', [
        'run',
        '--format', 'json',
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
            const event: OpenCodeEvent = JSON.parse(line)
            console.log('[OpenCode] Event:', JSON.stringify(event))

            // Capture error message
            if (event.type === 'error') {
              errorMessage = event.error || event.message || 'Unknown error'
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
        console.error('[OpenCode stderr]', data.toString())
      })

      proc.on('error', (err) => {
        reject(err)
      })

      proc.on('close', (code) => {
        console.log('[OpenCode] Process closed, code:', code)
        if (code !== 0) {
          // Return user-friendly error message
          let errorMsg = 'OpenCode 执行失败'
          if (errorMessage.includes('auth') || errorMessage.includes('login')) {
            errorMsg = 'OpenCode 未登录或认证已过期'
          } else if (errorMessage.includes('API') || errorMessage.includes('key')) {
            errorMsg = 'OpenCode API 密钥无效'
          } else if (errorMessage.length > 0 && errorMessage.length < 100) {
            errorMsg = errorMessage
          }
          resolve(`❌ OpenCode 错误: ${errorMsg}\n\n请运行 \`opencode auth login\` 配置认证。`)
        } else {
          resolve(fullText)
        }
      })
    })
  }

  private extractText(event: OpenCodeEvent): string {
    // Handle text events with part.text (OpenCode format)
    if (event.type === 'text' && event.part?.text) {
      return event.part.text
    }

    // Handle content events
    if (event.type === 'content' && event.content) {
      return event.content
    }

    // Handle text events with direct text field
    if (event.text) {
      return event.text
    }

    // Handle message field
    if (event.message) {
      return event.message
    }

    return ''
  }
}

// Singleton instance
export const opencodeAdapter = new OpenCodeAdapter()
