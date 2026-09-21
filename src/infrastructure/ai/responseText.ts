/**
 * Response-text normalisation shared by every AI answer that reaches the
 * Markdown/LaTeX renderer.
 *
 * Some models wrap their internal reasoning in `<think>…</think>`. That text is
 * not course content and must never reach the learner — not in a finished
 * answer, not while it is streaming, and not when the stream is cut off before
 * the closing tag arrives.
 *
 * This is preprocessing only: it removes hidden reasoning. It is not an HTML
 * sanitiser, and it does not parse Markdown.
 */

const OPEN_TAG = /^<\s*think(?:ing)?\b[^>]*>/i
const CLOSE_TAG = /<\s*\/\s*think(?:ing)?\s*>/i
/** Longest close tag we might have to hold across a chunk boundary. */
const CLOSE_TAG_MAX = '</thinking>'.length

/** Remove complete and unterminated `<think>` blocks from a finished response. */
export function stripThinkBlocks(input: string): string {
  if (!input || !input.includes('<')) return input

  const withoutComplete = input.replace(
    /<\s*think(?:ing)?\b[^>]*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi,
    '',
  )
  // An unterminated block runs to the end of the response — hide all of it.
  const stripped = withoutComplete.replace(/<\s*think(?:ing)?\b[^>]*>[\s\S]*$/i, '')
  if (stripped === input) return input

  // A removed block can leave blank lines behind; tidy only when we changed
  // something, so think-free content is returned byte-for-byte.
  return stripped.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Stateful filter for streamed deltas.
 *
 * Feed every delta through `push`; only visible text is emitted. It holds a
 * partial `<think>` / `</think>` at the end of a chunk so a tag split across
 * chunks is never shown, and it keeps reasoning hidden if the stream ends
 * before the closing tag.
 */
export class ThinkStreamFilter {
  private buffer = ''
  private insideThink = false
  private readonly emit: (text: string) => void

  constructor(onVisible: (text: string) => void) {
    this.emit = onVisible
  }

  push(delta: string): void {
    this.buffer += delta
    if (this.insideThink) this.drainInside()
    else this.drainOutside()
  }

  /** Call once the stream ends. */
  flush(): void {
    if (this.insideThink) {
      // Unterminated reasoning is never shown.
      this.buffer = ''
      return
    }
    this.drainOutsideFinal()
  }

  private drainOutside(): void {
    for (;;) {
      const lt = this.buffer.indexOf('<')
      if (lt === -1) {
        if (this.buffer) this.emit(this.buffer)
        this.buffer = ''
        return
      }
      if (lt > 0) {
        this.emit(this.buffer.slice(0, lt))
        this.buffer = this.buffer.slice(lt)
      }
      const match = OPEN_TAG.exec(this.buffer)
      if (match && match.index === 0) {
        this.buffer = this.buffer.slice(match[0].length)
        this.insideThink = true
        this.drainInside()
        return
      }
      if (this.buffer.indexOf('>') === -1) {
        // An incomplete tag at the chunk boundary: hold it, show nothing yet.
        return
      }
      // A complete tag that is not `<think>` — keep the '<' as ordinary text.
      this.emit('<')
      this.buffer = this.buffer.slice(1)
    }
  }

  private drainOutsideFinal(): void {
    for (;;) {
      const lt = this.buffer.indexOf('<')
      if (lt === -1) {
        if (this.buffer) this.emit(this.buffer)
        this.buffer = ''
        return
      }
      if (lt > 0) {
        this.emit(this.buffer.slice(0, lt))
        this.buffer = this.buffer.slice(lt)
      }
      const match = OPEN_TAG.exec(this.buffer)
      if (match && match.index === 0) {
        // Unterminated `<think>` at the very end: hide the rest.
        this.buffer = ''
        this.insideThink = true
        return
      }
      this.emit('<')
      this.buffer = this.buffer.slice(1)
    }
  }

  private drainInside(): void {
    for (;;) {
      const match = CLOSE_TAG.exec(this.buffer)
      if (match) {
        this.buffer = this.buffer.slice(match.index + match[0].length)
        this.insideThink = false
        this.drainOutside()
        return
      }
      // Keep only enough tail to detect a close tag split across chunks.
      const keep = Math.min(this.buffer.length, CLOSE_TAG_MAX)
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      return
    }
  }
}
