// Shared message splitting utility
// Used by WeChat, Telegram, and other messengers with character limits

export interface SplitOptions {
  /** Maximum characters per chunk */
  maxLength?: number
  /** Add continuation marker to split messages */
  addContinuationMarker?: boolean
  /** Continuation marker text */
  continuationMarker?: string
}

/**
 * Split a long message into chunks that fit within messenger limits.
 * Tries to split at natural boundaries (code blocks, paragraphs, lines).
 */
export function splitMessage(
  text: string,
  options: SplitOptions = {}
): string[] {
  const {
    maxLength = 2000,
    addContinuationMarker = true,
    continuationMarker = '\n\n[continued...]',
  } = options

  if (text.length <= maxLength) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    // Try to split at code block boundary first
    let splitPoint = remaining.lastIndexOf('\n```\n', maxLength)
    if (splitPoint < maxLength / 2) {
      // Try paragraph break
      splitPoint = remaining.lastIndexOf('\n\n', maxLength)
    }
    if (splitPoint < maxLength / 2) {
      // Try line break
      splitPoint = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitPoint < maxLength / 2) {
      // Force split at maxLength
      splitPoint = maxLength
    }

    chunks.push(remaining.slice(0, splitPoint).trim())
    remaining = remaining.slice(splitPoint).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  // Add continuation markers
  if (addContinuationMarker && chunks.length > 1) {
    for (let i = 0; i < chunks.length - 1; i++) {
      chunks[i] += continuationMarker
    }
  }

  return chunks
}
