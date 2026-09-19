/**
 * A deliberately small Markdown parser for AI-generated lesson text.
 *
 * Source material (PDF chunks) is *not* markdown and is rendered with
 * `format: 'plain'`. AI lessons are, so they get this subset:
 *
 *   - headings `#`…`####`
 *   - unordered / ordered lists
 *   - blockquotes
 *   - fenced code blocks
 *   - `**bold**`, `*italic*`, `` `code` ``
 *
 * Math (`\(…\)`, `\[…\]`, `$…$`, `$$…$$`) is parsed alongside markdown so the
 * two can be mixed freely.
 */

export type InlineSpan =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'code'; value: string }

export type MarkdownBlock =
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { kind: 'quote'; spans: InlineSpan[] }
  | { kind: 'code'; value: string }
  /** A line that is nothing but display math. */
  | { kind: 'math'; value: string }

/**
 * Order matters: code spans first (so LaTeX inside them is left alone), then
 * display math, then inline math, then emphasis.
 *
 * Emphasis requires non-space content at both ends, so prose like `a * b * c`
 * is not mistaken for italics.
 */
const INLINE_PATTERN =
  /`([^`]+)`|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(\S[^$\n]*?)\$|\*\*(\S(?:[^*]*?\S)?)\*\*|\*(\S(?:[^*]*?\S)?)\*/g

export function splitInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  let lastIndex = 0
  INLINE_PATTERN.lastIndex = 0

  for (let match = INLINE_PATTERN.exec(text); match; match = INLINE_PATTERN.exec(text)) {
    if (match.index > lastIndex) {
      spans.push({ kind: 'text', value: text.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      spans.push({ kind: 'code', value: match[1] })
    } else if (match[2] !== undefined || match[3] !== undefined) {
      spans.push({ kind: 'math', value: (match[2] ?? match[3] ?? '').trim(), display: true })
    } else if (match[4] !== undefined || match[5] !== undefined) {
      spans.push({ kind: 'math', value: (match[4] ?? match[5] ?? '').trim(), display: false })
    } else if (match[6] !== undefined) {
      spans.push({ kind: 'strong', value: match[6] })
    } else if (match[7] !== undefined) {
      spans.push({ kind: 'em', value: match[7] })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    spans.push({ kind: 'text', value: text.slice(lastIndex) })
  }
  return spans
}

/** Flatten inline spans back to plain text (used for heading classification). */
export function inlineText(spans: InlineSpan[]): string {
  return spans
    .map((span) => (span.kind === 'math' ? span.value : span.value))
    .join('')
}

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^\s*```/
const QUOTE = /^>\s?(.*)$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
/** A line that is nothing but display math, opened and closed on that line. */
const DISPLAY_MATH = /^\s*(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])\s*$/

/**
 * A display-math block that opens on this line and closes on a later one —
 * the usual shape of `\[` … `\]` in AI output.
 */
const DISPLAY_OPEN = /^\s*(?:\\\[|\$\$)/

function closerFor(opener: string): string {
  return opener.startsWith('\\') ? '\\]' : '$$'
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []

  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', spans: splitInline(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      items: list.items.map((item) => splitInline(item)),
    })
    list = null
  }
  const flushQuote = () => {
    if (quote.length === 0) return
    blocks.push({ kind: 'quote', spans: splitInline(quote.join('\n')) })
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // Fenced code — consume verbatim until the closing fence.
    if (FENCE.test(line)) {
      flushAll()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i++
      }
      blocks.push({ kind: 'code', value: body.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    const display = DISPLAY_MATH.exec(line)
    if (display) {
      flushAll()
      blocks.push({ kind: 'math', value: (display[1] ?? display[2] ?? '').trim() })
      continue
    }

    // Multi-line `\[ … \]` / `$$ … $$`.
    const opener = DISPLAY_OPEN.exec(line)
    if (opener) {
      const closer = closerFor(opener[0].trim())
      const rest = line.replace(DISPLAY_OPEN, '')
      const parts = [rest]
      if (!rest.includes(closer)) {
        i++
        while (i < lines.length && !(lines[i] ?? '').includes(closer)) {
          parts.push(lines[i] ?? '')
          i++
        }
        if (i < lines.length) {
          const closing = lines[i] ?? ''
          parts.push(closing.slice(0, closing.indexOf(closer)))
        }
      } else {
        parts[0] = rest.slice(0, rest.indexOf(closer))
      }
      flushAll()
      blocks.push({ kind: 'math', value: parts.join('\n').trim() })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushAll()
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        spans: splitInline(heading[2] ?? ''),
      })
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted) {
      flushParagraph()
      flushList()
      quote.push(quoted[1] ?? '')
      continue
    }

    const unordered = UNORDERED.exec(line)
    const ordered = ORDERED.exec(line)
    if (unordered || ordered) {
      flushParagraph()
      flushQuote()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push((unordered?.[1] ?? ordered?.[1] ?? '').trim())
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  }

  flushAll()
  return blocks
}
