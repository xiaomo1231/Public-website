/**
 * Display-time tidying of walkthrough text (nothing stored is rewritten, so
 * walkthroughs written before the prompt rule look right on the next load).
 *
 * A boxed answer that ends a display formula followed by a sentence full stop
 * (`$$x = \boxed{3}.$$`, `$$\boxed{3}$$.`) puts the dot outside the box, far
 * from the text; a conclusion line ending `$\boxed{3}$。` does the same. Only
 * those cases are touched: punctuation after anything else, in the middle of
 * a line, in code, or inside ordinary formulas stays as written.
 */

/** LaTeX spacing that may sit between a box and its stray punctuation. */
const SPACING = String.raw`(?:\s|\\[,;:! ]|\\quad|\\qquad|~)*`
/** The rest of a display formula after its box: only spacing and one stop. */
const DISPLAY_TAIL = new RegExp(
  String.raw`^${SPACING}(?:[.,，。]|\\text\{\s*[.,，。]\s*\})${SPACING}$`,
)
const ONLY_SPACING = new RegExp(`^${SPACING}$`)

/**
 * Where the last `\boxed{…}` of a formula closes, when nothing but spacing
 * (and, with `allowStop`, one sentence stop) follows it; -1 otherwise.
 */
function boxedEnd(math: string, allowStop: boolean): number {
  const start = math.lastIndexOf('\\boxed{')
  if (start < 0) return -1
  let depth = 0
  for (let index = start + '\\boxed'.length; index < math.length; index++) {
    const char = math[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const rest = math.slice(index + 1)
        return ONLY_SPACING.test(rest) || (allowStop && DISPLAY_TAIL.test(rest)) ? index + 1 : -1
      }
    }
  }
  return -1
}

/** A display formula's content without a stop after its final box. */
function tidyDisplay(math: string): { math: string; boxed: boolean } {
  const end = boxedEnd(math, true)
  if (end < 0) return { math, boxed: false }
  const trailing = /\s*$/.exec(math.slice(end))![0]
  return { math: math.slice(0, end) + trailing, boxed: true }
}

/** A stop right after a closing delimiter, up to the end of its line. */
const STOP_AFTER_DISPLAY = /^[ \t]*[.,，。](?=[ \t]*(?:\n|$))/
const STOP_AFTER_INLINE = /^[ \t]*。(?=[ \t]*(?:\n|$))/

export function tidyBoxedPunctuation(text: string): string {
  if (!text.includes('\\boxed')) return text
  let out = ''
  let index = 0
  const length = text.length
  while (index < length) {
    // Code is never touched.
    if (text.startsWith('```', index)) {
      const close = text.indexOf('```', index + 3)
      const end = close < 0 ? length : close + 3
      out += text.slice(index, end)
      index = end
      continue
    }
    const char = text[index]
    if (char === '`') {
      const close = text.indexOf('`', index + 1)
      const end = close < 0 ? length : close + 1
      out += text.slice(index, end)
      index = end
      continue
    }
    if (char === '\\' && text[index + 1] === '[') {
      const close = text.indexOf('\\]', index + 2)
      if (close < 0) {
        out += text.slice(index)
        break
      }
      const { math, boxed } = tidyDisplay(text.slice(index + 2, close))
      out += `\\[${math}\\]`
      index = close + 2
      if (boxed) index += STOP_AFTER_DISPLAY.exec(text.slice(index))?.[0].length ?? 0
      continue
    }
    if (char === '\\') {
      // An escaped character (`\$`) is plain text.
      out += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (char === '$' && text[index + 1] === '$') {
      const close = text.indexOf('$$', index + 2)
      if (close < 0) {
        out += text.slice(index)
        break
      }
      const { math, boxed } = tidyDisplay(text.slice(index + 2, close))
      out += `$$${math}$$`
      index = close + 2
      if (boxed) index += STOP_AFTER_DISPLAY.exec(text.slice(index))?.[0].length ?? 0
      continue
    }
    if (char === '$') {
      const close = inlineClose(text, index + 1)
      if (close < 0) {
        out += char
        index += 1
        continue
      }
      const math = text.slice(index + 1, close)
      out += `$${math}$`
      index = close + 1
      if (boxedEnd(math, false) >= 0) {
        const stop = STOP_AFTER_INLINE.exec(text.slice(index))
        // Keep any spaces before the stop's position out: drop only the stop.
        if (stop) index += stop[0].length
      }
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** The `$` closing an inline formula opened before `from`, on the same paragraph. */
function inlineClose(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '\n' && text[index + 1] === '\n') return -1
    if (char === '$') return text[index + 1] === '$' ? -1 : index
  }
  return -1
}
