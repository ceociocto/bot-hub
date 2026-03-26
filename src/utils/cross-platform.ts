// Cross-platform utilities for Windows compatibility

import { spawn, SpawnOptions, ChildProcess } from 'child_process'
import { platform, homedir } from 'os'
import { join } from 'path'

export const isWindows = platform() === 'win32'
export const isMac = platform() === 'darwin'
export const isLinux = platform() === 'linux'

/**
 * Cross-platform spawn wrapper that automatically handles Windows compatibility.
 * On Windows, it sets shell: true to enable command execution.
 *
 * Note: When using stdio: ['ignore', 'pipe', 'pipe'], stdout and stderr are guaranteed to be non-null.
 */
export function crossSpawn(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): ChildProcess {
  const spawnOptions: SpawnOptions = {
    ...options,
    // On Windows, we need shell: true for commands like 'claude', 'opencode', etc.
    // to be found in PATH and executed properly.
    shell: isWindows ? (options.shell ?? true) : options.shell,
  }
  return spawn(command, args, spawnOptions)
}

/**
 * Get Copilot CLI binary path based on the current platform.
 * Copilot CLI is installed by VS Code extension in different locations per OS.
 */
export function getCopilotBinPath(): string {
  if (isWindows) {
    // Windows: VS Code extensions are in %USERPROFILE%\.vscode\extensions
    // The copilot CLI should be in the global storage
    return join(
      homedir(),
      '.vscode',
      'extensions',
      'github.copilot-chat-*/copilotCli/copilot.exe'
    )
  } else if (isMac) {
    // macOS
    return join(
      homedir(),
      'Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot'
    )
  } else {
    // Linux
    return join(
      homedir(),
      '.vscode/extensions/github.copilot-chat/copilotCli/copilot'
    )
  }
}

/**
 * Check if a command exists in PATH.
 * Uses 'where' on Windows, 'which' on Unix.
 */
export function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCmd = isWindows ? 'where' : 'which'
    const proc = crossSpawn(checkCmd, [command], { stdio: 'ignore' })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

/**
 * Get the correct newline character for the current platform.
 */
export const EOL = isWindows ? '\r\n' : '\n'
