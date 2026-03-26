// Claude Code agent adapter
// Uses --print --output-format stream-json for programmatic interaction

import type { AgentAdapter } from '../../../core/types.js'
import { crossSpawn } from '../../../utils/cross-platform.js'

interface ClaudeMessage {
  type: string
  subtype?: string
  message?: {
    content: Array<{ type: string; text?: string; thinking?: string }>
    role: string
  }
  result?: string
  error?: string
  is_error?: boolean
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code'
  readonly aliases = ['cc', 'claude', 'claudecode']

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = crossSpawn('claude', ['--version'], { stdio: 'ignore' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async *sendPrompt(_sessionId: string, prompt: string): AsyncGenerator<string> {
    console.log(`[ClaudeCode] sendPrompt called, prompt: ${prompt}`)

    // Use a promise to wait for the full response
    const response = await this.callClaude(prompt)
    console.log(`[ClaudeCode] Response length: ${response.length}`)

    if (response) {
      yield response
    }
  }

  private callClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = crossSpawn('claude', [
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        prompt,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let fullText = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
        const lines = stdout.split('\n')
        stdout = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const msg: ClaudeMessage = JSON.parse(line)
            console.log('[ClaudeCode] Message type:', msg.type)
            const text = this.extractText(msg)
            if (text) {
              fullText += text
            }
          } catch {
            // Skip malformed JSON
          }
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.error('[ClaudeCode stderr]', data.toString())
      })

      proc.on('error', (err) => {
        reject(err)
      })

      proc.on('close', (code) => {
        console.log('[ClaudeCode] Process closed, code:', code)
        if (code !== 0) {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`))
        } else {
          resolve(fullText)
        }
      })
    })
  }

  private extractText(msg: ClaudeMessage): string {
    if (msg.type === 'assistant' && msg.message?.content) {
      const textParts: string[] = []
      for (const item of msg.message.content) {
        if (item.type === 'text' && item.text) {
          textParts.push(item.text)
        }
      }
      return textParts.join('')
    }
    return ''
  }

  stop(): void {
    // No persistent process to stop
  }
}

// Singleton instance
export const claudeCodeAdapter = new ClaudeCodeAdapter()
