import type { LayoutWarning } from '@/entities/chunk/layoutWarnings'
import {
  collapseDoubledMathGlyphs,
  foldMathAlphanumerics,
  hasMathAlphanumerics,
  repairFontPrivateUse,
  type FontEncodingKind,
} from './fontGlyphs'

/**
 * Turn pdf.js text items into reading lines.
 *
 * pdf.js returns glyph runs in paint order with their baseline position and
 * font size. Mathematics is where that goes wrong: exponents and subscripts
 * sit on their own baseline, a stacked fraction is two runs above and below
 * the line, and a table is a grid of runs. Everything here works from that
 * geometry only, and is deliberately conservative — when the evidence is not
 * clear the text is kept exactly as it was, and the line is flagged with a
 * `LayoutWarning` so the student can be told to check it against the page.
 */

/**
 * Structural type for an item returned from `page.getTextContent().items`.
 * pdfjs-dist v6 doesn't export the type alias directly, so we declare the
 * minimum surface we need.
 */
export interface PdfTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
  hasEOL?: boolean
}

export interface LaidOutLine {
  /** The line's text; a detected table is one multi-line Markdown block. */
  text: string
  /** Baseline font size, used to rejoin a title broken over several lines. */
  height: number
  /** Baseline y (PDF user space, larger = higher on the page). */
  y?: number
  table?: boolean
  /** Set by title joining: the line is a heading whatever its length. */
  heading?: boolean
  warnings?: LayoutWarning[]
}

/** Font of each item, as a classified encoding kind. */
export type FontKindLookup = (fontName: string | undefined) => FontEncodingKind | undefined

interface Item extends PdfTextItem {
  str: string
  /** Text came from Mathematical Alphanumeric Symbols (Cambria Math exports). */
  math?: boolean
  /** A stacked fraction rebuilt from a numerator and a denominator run. */
  fraction?: boolean
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '−': '⁻',
  '+': '⁺',
}
const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '-': '₋',
  '−': '₋',
  '+': '₊',
}

const SCRIPT_NUMBER = /^[-−+]?\d+$/
const DEGREE = /^[◦°∘]$/
const SUBSCRIPT_LETTERS = /^[A-Za-z]{1,3}$/
const RAISED_OPERATOR = /^[√∑∫∏∮]$/
/** Large-delimiter pieces: a matrix or a cases block whose layout is lost. */
const BIG_DELIMITER = /[⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦⎧⎨⎩⎪⎫⎬⎭]/

function itemHeight(item: PdfTextItem): number {
  const height = item.height ?? Math.abs(item.transform?.[3] ?? 0)
  return height > 2 ? height : 12
}

function isBlank(item: Item): boolean {
  return item.str.trim() === ''
}

function yOf(item: PdfTextItem): number | undefined {
  return item.transform?.[5]
}

function xOf(item: PdfTextItem): number | undefined {
  return item.transform?.[4]
}

function endOf(item: PdfTextItem): number | undefined {
  const x = xOf(item)
  return x !== undefined && item.width !== undefined ? x + item.width : undefined
}

/** Per-item glyph repair: font-specific dingbats, doubled and styled maths glyphs. */
function prepareItems(items: PdfTextItem[], fontKind?: FontKindLookup): Item[] {
  // Doubled maths glyphs confirmed by an item's own geometry somewhere on the
  // page: the exporter did it to every equation, whatever font run it is in.
  let doubled = false
  for (const raw of items) {
    if (typeof raw.str !== 'string' || !hasMathAlphanumerics(raw.str)) continue
    if (collapseDoubledMathGlyphs(raw.str, raw.width, itemHeight(raw)) !== raw.str) doubled = true
  }
  const out: Item[] = []
  for (const raw of items) {
    if (typeof raw.str !== 'string') continue
    let str = repairFontPrivateUse(raw.str, fontKind?.(raw.fontName))
    let math = false
    if (hasMathAlphanumerics(str)) {
      str = foldMathAlphanumerics(
        collapseDoubledMathGlyphs(str, raw.width, itemHeight(raw), doubled),
      )
      math = true
    }
    out.push({ ...raw, str, ...(math ? { math } : {}) })
  }
  return out
}

/** Some PDFs paint a combining vector arrow before the letter it sits over.
 * pdf.js follows paint order, so move only a geometrically overlapping arrow
 * after its single-letter base. The original page remains the authority. */
function orderVectorMarks<T extends PdfTextItem>(items: T[]): T[] {
  const ordered = [...items]
  for (let index = 0; index < ordered.length; index++) {
    const mark = ordered[index]
    if (mark?.str !== '⃗') continue
    let baseIndex = index + 1
    while (ordered[baseIndex]?.str?.trim() === '') baseIndex++
    const base = ordered[baseIndex]
    const markX = mark.transform?.[4]
    const baseX = base?.transform?.[4]
    const markY = mark.transform?.[5]
    const baseY = base?.transform?.[5]
    if (
      !base ||
      !/^[A-Za-z]$/.test(base.str ?? '') ||
      markX === undefined ||
      baseX === undefined ||
      base.width === undefined ||
      markY === undefined ||
      baseY === undefined ||
      Math.abs(markY - baseY) > itemHeight(base) * 0.3 ||
      markX < baseX - 1 ||
      markX > baseX + base.width + 1
    )
      continue
    ordered.splice(index, 1)
    ordered.splice(baseIndex, 0, mark)
    index = baseIndex
  }
  return ordered
}

/** A fraction part that needs no parentheses: one number, symbol or `(…)` group. */
function isAtomic(text: string): boolean {
  return /^[\p{L}\p{N}.,′⁰¹²³⁴⁵⁶⁷⁸⁹⁻_{}]+$/u.test(text) || /^\([^()]*\)[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]*$/.test(text)
}

function fractionText(numerator: string, denominator: string): string {
  const wrap = (part: string) => (isAtomic(part) ? part : `(${part})`)
  return `${wrap(numerator)}/${wrap(denominator)}`
}

function rangeOf(group: Item[]): { start: number; end: number } | undefined {
  let start = Infinity
  let end = -Infinity
  for (const item of group) {
    const x = xOf(item)
    const e = endOf(item)
    if (x === undefined || e === undefined) return undefined
    start = Math.min(start, x)
    end = Math.max(end, e)
  }
  return Number.isFinite(start) ? { start, end } : undefined
}

/**
 * Rebuild stacked fractions. A run painted above the current baseline
 * immediately followed by a run below it, horizontally overlapping and
 * roughly symmetric about the baseline, is a numerator over a denominator
 * (the fraction bar itself is a drawn line, not text). Small stacked digits
 * (`½` set as a raised 1 over a lowered 2) qualify too, but small stacked
 * scripts attached to a letter (`x` with both an exponent and an index) do
 * not. When the shape is stacked but not clearly a fraction, the items are
 * left alone and the line is flagged.
 */
function rebuildFractions(items: Item[]): { items: Item[]; flagged: Set<Item> } {
  const out: Item[] = []
  const flagged = new Set<Item>()
  let base: Item | undefined
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    if (isBlank(item) || !base) {
      out.push(item)
      if (!isBlank(item)) base = item
      i++
      continue
    }
    const baseY = yOf(base)
    const baseH = itemHeight(base)
    const y = yOf(item)
    if (baseY === undefined || y === undefined || y - baseY < baseH * 0.25) {
      out.push(item)
      // Same baseline, or a new line below (a subscript sits much closer).
      // A smaller script glyph on (nearly) the same baseline never becomes the base.
      if (y === undefined || baseY === undefined) base = item
      else if (Math.abs(y - baseY) <= baseH * 0.25 && itemHeight(item) >= baseH * 0.85) base = item
      else if (baseY - y > baseH * 0.9) base = item
      i++
      continue
    }
    // Collect the numerator (above), then the denominator (below).
    const numerator: Item[] = []
    let j = i
    while (j < items.length) {
      const next = items[j]!
      const ny = yOf(next)
      if (isBlank(next)) {
        j++
        continue
      }
      if (ny === undefined || ny - baseY < baseH * 0.25 || ny - baseY > baseH * 1.0) break
      numerator.push(next)
      j++
    }
    const denominator: Item[] = []
    let k = j
    while (k < items.length) {
      const next = items[k]!
      const ny = yOf(next)
      if (isBlank(next)) {
        k++
        continue
      }
      if (ny === undefined || baseY - ny < baseH * 0.25 || baseY - ny > baseH * 1.0) break
      denominator.push(next)
      k++
    }
    if (numerator.length === 0 || denominator.length === 0) {
      out.push(item)
      i++
      continue
    }
    const after = items.slice(k).find((next) => !isBlank(next))
    const afterY = after ? yOf(after) : undefined
    const numY = yOf(numerator[0]!)!
    const denY = yOf(denominator[0]!)!
    const up = numY - baseY
    const down = baseY - denY
    const numRange = rangeOf(numerator)
    const denRange = rangeOf(denominator)
    const overlap =
      numRange && denRange
        ? Math.min(numRange.end, denRange.end) - Math.max(numRange.start, denRange.start)
        : -1
    const narrower =
      numRange && denRange
        ? Math.min(numRange.end - numRange.start, denRange.end - denRange.start)
        : 0
    const small = [...numerator, ...denominator].every(
      (part) => itemHeight(part) < baseH * 0.85 || isBlank(part),
    )
    const baseEnd = endOf(base)
    const attached =
      baseEnd !== undefined && numRange !== undefined && numRange.start - baseEnd < baseH * 0.15
    const numText = groupLines(numerator).map((line) => line.text)
    const denText = groupLines(denominator).map((line) => line.text)
    const resumes =
      afterY === undefined || Math.abs(afterY - baseY) <= baseH * 0.35 || afterY < denY - baseH
    const shaped =
      Math.abs(up - down) <= Math.max(up, down) * 0.35 + 1 &&
      overlap > 0 &&
      overlap >= narrower * 0.5 &&
      resumes &&
      numText.length === 1 &&
      denText.length === 1
    const digitsOnly = /^\d+$/.test(numText[0] ?? '') && /^\d+$/.test(denText[0] ?? '')
    const scriptsOnLetter = small && attached && /[\p{L})\]]$/u.test(base.str.trim())
    if (shaped && !scriptsOnLetter && (!small || digitsOnly)) {
      const fraction: Item = {
        str: fractionText(numText[0]!, denText[0]!),
        transform: [1, 0, 0, 1, Math.min(numRange!.start, denRange!.start), baseY],
        width: Math.max(numRange!.end, denRange!.end) - Math.min(numRange!.start, denRange!.start),
        height: baseH,
        fraction: true,
      }
      out.push(fraction)
      base = fraction
      i = k
      continue
    }
    // Stacked but not clearly a fraction: keep the text, flag the line.
    if (overlap > 0 && (!small || !attached)) flagged.add(item)
    out.push(item)
    i++
  }
  return { items: out, flagged }
}

/** An item starting under the previous item (a subscript set below an exponent). */
function stackedUnderPrevious(previous: Item | undefined, x: number | undefined): boolean {
  const start = previous ? xOf(previous) : undefined
  const end = previous ? endOf(previous) : undefined
  return x !== undefined && start !== undefined && end !== undefined && x >= start - 1 && x < end
}

interface LineRecord {
  text: string
  y?: number
  height: number
  cells: Array<{ x: number; end: number; text: string }>
  warnings: Set<LayoutWarning>
}

/**
 * Group items into lines. A raised / lowered glyph has its own baseline, so a
 * fixed threshold would tear `R²` into three lines: items join while their
 * baselines fit inside the larger glyph's height. Whitespace items carry no
 * reliable geometry (pdf.js gives them zero height) and never move the
 * baseline. Geometry is evidence for a script, never for inventing a symbol.
 */
function groupLines(items: Item[], flagged: Set<Item> = new Set()): LineRecord[] {
  const lines: LineRecord[] = []
  let current = ''
  let baselineY: number | undefined
  let baselineHeight = 12
  let previous: Item | undefined
  let cellStarts: Array<{ x: number; end: number; start: number }> = []
  let warnings = new Set<LayoutWarning>()
  /** Index of the closing brace of the subscript group being written, if any. */
  let subscriptClose: number | undefined

  const flush = () => {
    const joined = current.replace(/\s+/g, ' ').trim()
    if (joined) {
      const cells = cellStarts.map((cell, index) => ({
        x: cell.x,
        end: cell.end,
        text: current
          .slice(cell.start, cellStarts[index + 1]?.start ?? current.length)
          .replace(/\s+/g, ' ')
          .trim(),
      }))
      if (BIG_DELIMITER.test(joined)) warnings.add('matrix')
      lines.push({
        text: joined,
        ...(baselineY !== undefined ? { y: baselineY } : {}),
        height: baselineHeight,
        cells,
        warnings,
      })
    }
    current = ''
    baselineY = undefined
    baselineHeight = 12
    previous = undefined
    cellStarts = []
    warnings = new Set()
    subscriptClose = undefined
  }

  for (const item of items) {
    const str = item.str
    if (!str) continue
    if (isBlank(item)) {
      if (current && !/\s$/.test(current)) current += ' '
      continue
    }
    const y = yOf(item)
    const height = itemHeight(item)
    // A radical or big operator is set raised (its baseline is its top), but
    // belongs to the line it opens.
    const operator = RAISED_OPERATOR.test(str.trim())
    if (
      baselineY !== undefined &&
      y !== undefined &&
      Math.abs(baselineY - y) > Math.max(2, Math.max(baselineHeight, height) * 0.55) &&
      !(operator && y > baselineY && y - baselineY <= Math.max(baselineHeight, height) * 1.0)
    ) {
      flush()
    }
    if (flagged.has(item)) warnings.add('fraction')
    const x = xOf(item)
    const previousEnd = previous ? endOf(previous) : undefined
    const gap = x !== undefined && previousEnd !== undefined ? x - previousEnd : undefined
    const closeToPrevious = gap !== undefined && gap >= -1 && gap < baselineHeight * 0.45
    const scriptOffset = Math.max(0.8, baselineHeight * 0.12)
    const smaller = height < baselineHeight * 0.85
    const raised =
      y !== undefined && baselineY !== undefined && y - baselineY > scriptOffset && smaller
    const lowered =
      y !== undefined && baselineY !== undefined && baselineY - y > scriptOffset && smaller
    const trimmed = str.trim()
    let handled = false

    const nearScript = gap !== undefined && gap >= -1 && gap < baselineHeight * 0.6
    const insertSubscript = (text: string) => {
      current = `${current.slice(0, subscriptClose)}${text}${current.slice(subscriptClose)}`
      subscriptClose! += text.length
    }

    if (nearScript && (raised || lowered) && SCRIPT_NUMBER.test(trimmed)) {
      const table = raised ? SUPERSCRIPT : SUBSCRIPT
      const script = [...trimmed].map((char) => table[char] ?? char).join('')
      if (lowered && subscriptClose !== undefined) {
        insertSubscript(trimmed)
      } else {
        current = current.trimEnd()
        // `5.7521 x10` + raised `-1`: the x is a times sign.
        if (raised) current = current.replace(/(\d\s?)x(\s?10)$/, '$1×$2')
        current += script
      }
      handled = true
    } else if (raised && DEGREE.test(trimmed) && gap !== undefined && gap < baselineHeight) {
      current = `${current.trimEnd()}°`
      handled = true
    } else if (
      lowered &&
      SUBSCRIPT_LETTERS.test(trimmed) &&
      (closeToPrevious || stackedUnderPrevious(previous, x))
    ) {
      const stacked = /\p{L}([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)$/u.exec(current)
      if (subscriptClose !== undefined) {
        insertSubscript(trimmed)
        handled = true
      } else if (/\p{L}$/u.test(current)) {
        current = `${current}_{${trimmed}}`
        subscriptClose = current.length - 1
        handled = true
      } else if (stacked) {
        // `v²` then a lowered `fs` under the exponent: `v_{fs}²`.
        const at = current.length - stacked[1]!.length
        current = `${current.slice(0, at)}_{${trimmed}}${current.slice(at)}`
        subscriptClose = at + trimmed.length + 2
        handled = true
      }
    } else if (closeToPrevious && raised && /[\p{L}]/u.test(trimmed)) {
      // A raised letter (an exponent like eˣ) is kept as written, but flagged.
      warnings.add('superscript')
    }

    // A script item can carry the space that follows it (`0 ` in `v_{A0} =`).
    if (handled && /\s$/.test(str) && !/\s$/.test(current)) current += ' '

    if (!handled) {
      subscriptClose = undefined
      if (!current) {
        current = str
        cellStarts = x !== undefined ? [{ x, end: endOf(item) ?? x, start: 0 }] : []
      } else {
        const newCell =
          gap !== undefined && x !== undefined && gap > Math.max(baselineHeight * 1.6, 18)
        const mathDecimal =
          item.math && previous?.math && /\d\.\s?$/.test(current) && /^\d/.test(trimmed)
        let separator: string
        if (mathDecimal) {
          current = current.trimEnd()
          separator = ''
        } else if (item.fraction || previous?.fraction) {
          separator = /\s$/.test(current) || /^[\s,.;:)\]]/.test(str) ? '' : ' '
        } else {
          separator =
            /\s$/.test(current) ||
            /^\s/.test(str) ||
            (gap !== undefined && gap < Math.min(baselineHeight, height) * 0.18)
              ? ''
              : ' '
        }
        if (newCell) {
          current = current.trimEnd() + ' '
          cellStarts.push({ x: x!, end: endOf(item) ?? x!, start: current.length })
          current += str.trimStart()
        } else {
          current += separator + str
        }
      }
    }
    const lastCell = cellStarts[cellStarts.length - 1]
    const end = endOf(item)
    if (lastCell && end !== undefined) lastCell.end = Math.max(lastCell.end, end)
    if (y !== undefined && !operator && (baselineY === undefined || height > baselineHeight)) {
      baselineY = y
      baselineHeight = height
    }
    previous = item
  }
  flush()
  return lines
}

const NUMERIC_CELL = /^[-−+]?[\d.,/]+$/

function columnsAligned(a: LineRecord, b: LineRecord): boolean {
  const tolerance = Math.max(3, Math.min(a.height, b.height) * 0.5)
  return a.cells.every((cell, index) => {
    const other = b.cells[index]!
    return (
      Math.abs(cell.x - other.x) <= tolerance ||
      Math.abs(cell.end - other.end) <= tolerance ||
      Math.abs((cell.x + cell.end) / 2 - (other.x + other.end) / 2) <= tolerance
    )
  })
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * Rebuild tables from rows of cells that line up in clear columns: at least
 * three consecutive lines with the same number (≥2) of short cells, every
 * column aligned (left, right or centre). Two-column prose has long cells and
 * is left alone; a grid of bare numbers is more likely a matrix whose brackets
 * were lost, so it is flagged rather than turned into a table.
 */
function detectTables(lines: LineRecord[]): LaidOutLine[] {
  const out: LaidOutLine[] = []
  let i = 0
  while (i < lines.length) {
    const first = lines[i]!
    const columns = first.cells.length
    let j = i + 1
    if (columns >= 2) {
      while (
        j < lines.length &&
        lines[j]!.cells.length === columns &&
        columnsAligned(first, lines[j]!)
      )
        j++
    }
    const run = lines.slice(i, j)
    const cells = run.flatMap((line) => line.cells.map((cell) => cell.text))
    const shortCells =
      cells.length > 0 &&
      cells.every((text) => text.length > 0 && text.length <= 60) &&
      cells.reduce((sum, text) => sum + text.length, 0) / cells.length <= 24
    const numeric = cells.length > 0 && cells.every((text) => NUMERIC_CELL.test(text))
    if (columns >= 2 && run.length >= 3 && shortCells && !numeric) {
      const rows = run.map(
        (line) => `| ${line.cells.map((cell) => escapeCell(cell.text)).join(' | ')} |`,
      )
      const separator = `| ${new Array(columns).fill('---').join(' | ')} |`
      const warnings = new Set<LayoutWarning>()
      for (const line of run) for (const warning of line.warnings) warnings.add(warning)
      // Several bare numbers in one cell: narrow columns were probably merged.
      if (cells.some((text) => /^(?:[-−+]?\d[\d.,]*\s+){1,}[-−+]?\d[\d.,]*$/.test(text)))
        warnings.add('table')
      out.push({
        text: [rows[0]!, separator, ...rows.slice(1)].join('\n'),
        height: first.height,
        ...(first.y !== undefined ? { y: first.y } : {}),
        table: true,
        ...(warnings.size > 0 ? { warnings: [...warnings] } : {}),
      })
      i = j
      continue
    }
    if (columns >= 2 && run.length >= 2 && shortCells) {
      // Aligned like a grid but not clearly a table: keep the text, flag it.
      for (const line of run) line.warnings.add(numeric ? 'matrix' : 'table')
    }
    for (const line of run) {
      out.push({
        text: line.text,
        height: line.height,
        ...(line.y !== undefined ? { y: line.y } : {}),
        ...(line.warnings.size > 0 ? { warnings: [...line.warnings] } : {}),
      })
    }
    i = j
  }
  return out
}

/** Lay out one page's text items as reading lines (tables as Markdown blocks). */
export function layoutTextItems(items: PdfTextItem[], fontKind?: FontKindLookup): LaidOutLine[] {
  const prepared = orderVectorMarks(prepareItems(items, fontKind))
  const { items: rebuilt, flagged } = rebuildFractions(prepared)
  return detectTables(groupLines(rebuilt, flagged))
}

/** The reading lines of a page, as plain strings. */
export function groupTextItemsIntoLines(items: PdfTextItem[], fontKind?: FontKindLookup): string[] {
  return layoutTextItems(items, fontKind).flatMap((line) => line.text.split('\n'))
}
