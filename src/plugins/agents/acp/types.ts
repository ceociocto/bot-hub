// ACP (Agent Communication Protocol) types
// Based on the ACP OpenAPI specification
// @see https://github.com/i-am-bee/acp/blob/main/docs/spec/openapi.yaml

/**
 * ACP Agent Manifest — describes agent capabilities.
 * Fetched from GET /agent/card per the ACP spec.
 */
export interface ACPManifest {
  name: string
  description?: string
  version?: string
  capabilities: ACPCapability[]
}

export interface ACPCapability {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

/** ACP Task creation request (POST /tasks) */
export interface ACPCreateTaskRequest {
  input: {
    prompt: string
    history?: Array<{ role: string; content: string }>
  }
  mode: 'sync' | 'stream'
}

/** ACP Task response */
export interface ACPTaskResponse {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: {
    content: string
  }
  error?: {
    code: string
    message: string
  }
}

/**
 * Configuration for a remote ACP agent.
 * Stored in ~/.im-hub/config.json under the "acpAgents" key.
 */
export interface ACPAgentConfig {
  name: string
  aliases?: string[]
  endpoint: string
  auth?: {
    type: 'none' | 'apikey' | 'bearer'
    token?: string
  }
  enabled?: boolean
}
