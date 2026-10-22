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

// --- Display-time layout helpers (2k) ----------------------------------------

const MATRIX_BLOCK =
  /\\begin\{(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|array)\}[\s\S]*?\\end\{\1\}/g

/** Fractions inside matrices are typeset full size (`\dfrac`), so they stay readable. */
export function dfracInMatrices(text: string): string {
  if (!text.includes('\\begin{')) return text
  return text.replace(MATRIX_BLOCK, (block) => block.replace(/\\t?frac(?=\s*[{\d])/g, '\\dfrac'))
}

/**
 * A term is bold only where it first appears: a later `**term**` of the same
 * text (no maths, no numbers) is shown in normal weight.
 */
export function dedupeBoldTerms(text: string): string {
  if (!text.includes('**')) return text
  const seen = new Set<string>()
  return text.replace(/\*\*([^*\n]{1,60}?)\*\*/g, (whole, inner: string) => {
    if (/[$\\=\d]/.test(inner)) return whole
    const key = inner.trim().toLowerCase()
    if (!key) return whole
    if (seen.has(key)) return inner
    seen.add(key)
    return whole
  })
}

/** Everything the walkthrough applies to its text before rendering it. */
export function formatWalkthroughText(text: string): string {
  return dedupeBoldTerms(dfracInMatrices(tidyBoxedPunctuation(text)))
}

/** A body cut at its `### (a) …` sub-part headings (the text before has no label). */
export function splitSubparts(body: string): Array<{ label?: string; text: string }> {
  const lines = body.split('\n')
  const segments: Array<{ label?: string; text: string[] }> = [{ text: [] }]
  for (const line of lines) {
    const heading = /^\s{0,3}#{2,3}\s*[(（]([a-z])[)）]/i.exec(line)
    if (heading) segments.push({ label: heading[1]!.toLowerCase(), text: [line] })
    else segments[segments.length - 1]!.text.push(line)
  }
  return segments
    .map((segment) => ({
      ...(segment.label ? { label: segment.label } : {}),
      text: segment.text.join('\n'),
    }))
    .filter((segment) => segment.label || segment.text.trim())
}

/**
 * The answer of each sub-part from a conclusion such as
 * "(a)(b) no solution; (c) infinitely many solutions" — only labels that can
 * be read unambiguously.
 */
export function conclusionByPart(conclusion: string): Map<string, string> {
  const result = new Map<string, string>()
  const marks = [
    ...conclusion.matchAll(/(?:^|[\n;；。,，]|\s)\s*((?:[(（][a-z][)）]\s*[、,，]?\s*)+)/gi),
  ]
  for (const [index, mark] of marks.entries()) {
    const labels = [...mark[1]!.matchAll(/[(（]([a-z])[)）]/gi)].map((item) =>
      item[1]!.toLowerCase(),
    )
    const start = mark.index! + mark[0].length
    const end = index + 1 < marks.length ? marks[index + 1]!.index! : conclusion.length
    const answer = conclusion
      .slice(start, end)
      .trim()
      .replace(/^[:：]\s*/, '')
      .replace(/[;；,，]\s*$/, '')
      .trim()
    if (!answer) continue
    for (const label of labels) if (!result.has(label)) result.set(label, answer)
  }
  return result
}
