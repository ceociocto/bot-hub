// Markdown to Telegram HTML converter
// Telegram supports a subset of HTML: <b>, <i>, <u>, <code>, <pre>, <a>

import { marked, type Tokens } from 'marked'

class TelegramRenderer extends marked.Renderer {
  strong({ text }: Tokens.Strong): string {
    return `<b>${this.escapeHtml(text)}</b>`
  }

  em({ text }: Tokens.Em): string {
    return `<i>${this.escapeHtml(text)}</i>`
  }

  code({ text, lang }: Tokens.Code): string {
    const escaped = this.escapeHtml(text)
    if (lang) {
      return `<pre language="${this.escapeAttr(lang)}">${escaped}</pre>`
    }
    return `<pre>${escaped}</pre>`
  }

  codespan({ text }: Tokens.Codespan): string {
    return `<code>${this.escapeHtml(text)}</code>`
  }

  link({ href, text }: Tokens.Link): string {
    return `<a href="${this.escapeAttr(href)}">${this.escapeHtml(text)}</a>`
  }

  // Convert headers to bold
  heading({ text }: Tokens.Heading): string {
    return `<b>${this.escapeHtml(text)}</b>\n\n`
  }

  list({ raw }: Tokens.List): string {
    return `${raw}\n`
  }

  listitem({ text, raw }: Tokens.ListItem): string {
    return `• ${text || raw}\n`
  }

  blockquote({ text }: Tokens.Blockquote): string {
    // Convert to italic with quote marker
    return `<i>${this.escapeHtml(text.replace(/\n/g, '\n> '))}</i>\n\n`
  }

  hr(): string {
    return '\n―――\n\n'
  }

  br(): string {
    return '\n'
  }

  paragraph({ text }: Tokens.Paragraph): string {
    return `${text}\n\n`
  }

  // Escape helpers
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  private escapeAttr(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

/**
 * Convert Markdown to Telegram-compatible HTML
 */
export function markdownToTelegramHtml(markdown: string): string {
  const renderer = new TelegramRenderer()
  const html = marked.parse(markdown, { renderer }) as string
  return html.trim()
}
