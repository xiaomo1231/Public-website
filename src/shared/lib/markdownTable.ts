/**
 * A small, pure Markdown pipe-table parser.
 *
 * Deliberately narrow: it only recognises the GitHub-flavoured pipe-table
 * subset that AI lessons actually use, and it never treats a lone `|` in prose
 * (`|x|`) as a table. Cell content is returned as raw strings; the caller turns
 * each cell into inline spans with the shared inline parser, so there is only
 * one math/code parser in the app.
 */

export type TableAlignment = 'left' | 'center' | 'right'

/** Central caps so a hostile or runaway table cannot bloat the DOM. */
export const TABLE_LIMITS = {
  maxColumns: 12,
  maxRows: 100,
  maxCellLength: 500,
  maxTables: 10,
  /** A delimiter cell needs at least this many dashes (`--` is not a table). */
  minDelimiterDashes: 3,
} as const

const DELIMITER_CELL = new RegExp(`^:?-{${TABLE_LIMITS.minDelimiterDashes},}:?$`)

interface ScannedRow {
  cells: string[]
  hasPipe: boolean
}

/**
 * Split a table row into raw cells.
 *
 * Handles an optional leading/trailing pipe, escaped pipes (`\|`), and pipes
 * inside inline code or inline math (which must not split the row).
 */
function scanRow(line: string): ScannedRow {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && text[text.length - 2] !== '\\') text = text.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let hasPipe = false
  let inCode = false
  let inMath = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    const next = text[i + 1]

    if (!inCode && ch === '\\' && next === '|') {
      current += '|'
      i += 1
      continue
    }
    if (!inMath && ch === '`') {
      inCode = !inCode
      current += ch
      continue
    }
    if (!inCode && !inMath && ch === '$') {
      inMath = true
      current += ch
      continue
    }
    if (inMath && ch === '$') {
      inMath = false
      current += ch
      continue
    }
    if (!inCode && !inMath && ch === '\\' && next === '(') {
      inMath = true
      current += '\\('
      i += 1
      continue
    }
    if (inMath && ch === '\\' && next === ')') {
      inMath = false
      current += '\\)'
      i += 1
      continue
    }
    if (!inCode && !inMath && ch === '|') {
      cells.push(current)
      current = ''
      hasPipe = true
      continue
    }
    current += ch
  }
  cells.push(current)

  return { cells: cells.map((cell) => cell.trim()), hasPipe }
}

/** True when the line contains a pipe that is not escaped or protected. */
function hasUnescapedPipe(line: string): boolean {
  // A leading pipe counts even for a single-column table (`| a |`).
  return scanRow(line).hasPipe || line.trim().startsWith('|') || line.trim().endsWith('|')
}

/** Split a table row into cell strings. */
export function splitTableRow(line: string): string[] {
  return scanRow(line).cells
}

/** Parse a delimiter row into per-column alignment, or `null` if invalid. */
export function parseDelimiterRow(line: string): TableAlignment[] | null {
  // A delimiter row must contain a pipe (so `---` alone is not a table).
  if (!hasUnescapedPipe(line)) return null
  const { cells } = scanRow(line)
  const align: TableAlignment[] = []
  for (const cell of cells) {
    if (!DELIMITER_CELL.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    align.push(left && right ? 'center' : right ? 'right' : 'left')
  }
  return align.length > 0 ? align : null
}

export interface ParsedTable {
  header: string[]
  align: TableAlignment[]
  rows: string[][]
  /** Index of the first line after the table. */
  nextIndex: number
}

function normalizeRow(cells: string[], columns: number): string[] {
  const row = cells.slice(0, columns)
  while (row.length < columns) row.push('')
  return row
}

function withinCellLimit(cells: string[]): boolean {
  return cells.every((cell) => cell.length <= TABLE_LIMITS.maxCellLength)
}

/**
 * Try to parse a table starting at `lines[start]`. Returns `null` when the
 * lines are not a valid table, so the caller can fall back to a paragraph.
 */
export function tryParseTable(
  lines: string[],
  start: number,
  isTerminator: (line: string) => boolean,
): ParsedTable | null {
  const headerLine = lines[start]
  const delimiterLine = lines[start + 1]
  if (headerLine === undefined || delimiterLine === undefined) return null
  if (isTerminator(headerLine) || isTerminator(delimiterLine)) return null
  if (!hasUnescapedPipe(headerLine) && !hasUnescapedPipe(delimiterLine)) return null

  const header = splitTableRow(headerLine)
  const align = parseDelimiterRow(delimiterLine)
  if (!align) return null
  if (header.length === 0 || header.length !== align.length) return null
  if (header.length > TABLE_LIMITS.maxColumns) return null
  if (!withinCellLimit(header)) return null

  const rows: string[][] = []
  let i = start + 2
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') break
    if (isTerminator(line)) break
    if (!hasUnescapedPipe(line)) break
    if (rows.length >= TABLE_LIMITS.maxRows) return null
    const cells = splitTableRow(line)
    if (!withinCellLimit(cells)) return null
    rows.push(normalizeRow(cells, header.length))
    i += 1
  }

  return { header, align, rows, nextIndex: i }
}
