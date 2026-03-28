// ACPAdapter — bridges ACP protocol to IM-Hub's AgentAdapter interface.
//
// NOTE: `sessionId` is unused in v1 because ACP is stateless over HTTP.
// It is reserved for future ACP session support.

import type { AgentAdapter, ChatMessage } from '../../../core/types.js'
import type { ACPAgentConfig, ACPManifest } from './types.js'
import { ACPClient } from './acp-client.js'

export class ACPAdapter implements AgentAdapter {
  readonly name: string
  readonly aliases: string[]
  private client: ACPClient

  constructor(config: ACPAgentConfig) {
    this.name = config.name
    this.aliases = config.aliases || []
    this.client = new ACPClient(config)
  }

  async isAvailable(): Promise<boolean> {
    return this.client.healthCheck()
  }

  async *sendPrompt(_sessionId: string, prompt: string, history?: ChatMessage[]): AsyncGenerator<string> {
    // Try streaming first, fall back to sync.
    // NOTE: Fallback creates a new task; if the streaming task was partially
    // processed, the agent may repeat work. Acceptable for v1.
    try {
      for await (const chunk of this.client.streamPrompt(prompt, history)) {
        yield chunk
      }
    } catch (streamError) {
      const errMsg = streamError instanceof Error ? streamError.message : String(streamError)
      console.warn(`[ACP] Streaming failed, falling back to sync: ${errMsg}`)
      const response = await this.client.sendPromptSync(prompt, history)
      if (response) yield response
    }
  }

  /** Get the agent manifest for display (not part of AgentAdapter interface) */
  async getManifest(): Promise<ACPManifest | undefined> {
    try {
      return await this.client.fetchManifest()
    } catch {
      return undefined
    }
  }
}
