/**
 * Heading heuristics shared by the extractors and structure detection.
 *
 * Kept free of any extractor so the same rules mark headings in a PDF and
 * decide which chunks may open a chapter.
 */

/** A table-of-contents entry: dot / ellipsis leaders, usually before a page number. */
export const TOC_LEADER = /(?:\.\s*){4,}|…{2,}|(?:\s\.){3,}/

/** "Chapter 1", "Lesson 3", "Lektion 2", "Unit IV", "Lecture 5", "Kapitel 1", "Section 2". */
const KEYWORD_UNIT =
  /^(?:chapter|ch\.|section|lecture|lesson|lektion|lecke|unit|kapitel|module|fejezet)\s+(?:\d{1,3}|[ivxlc]{1,6})\b/i

/** Hungarian ordinal-first units: "2. lecke – BEMUTATKOZÁS", "6.lecke- TESTRÉSZEK", "3. fejezet". */
export const ORDINAL_UNIT =
  /^\s*(\d{1,3})\.\s*(lecke|fejezet|egység|lektion)\b\s*[:.\-–—]?\s*(.*)$/iu

/**
 * Roman-numeral units: "III. Körperteile / Body parts" (title starts with a
 * capital). A lone C or L is an initial ("C. Smith"), not a numeral.
 */
export const ROMAN_UNIT = /^\s*([IVX]|[IVXLC]{2,6})\.\s+(\p{Lu}.*)$/u

/**
 * Heuristic heading detection for one extracted line: a short line that is a
 * numbered unit heading ("Chapter 1", "2. lecke – …", "III. Körperteile"), a
 * Chinese chapter heading, or written in capitals (any script: "BEMUTATKOZÁS").
 * Table-of-contents entries (dot leaders) are never headings.
 */
export function looksLikeHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > 80) return false
  if (TOC_LEADER.test(trimmed) || isNumberedList(trimmed)) return false
  // A unit title may be a question ("8. lecke – MI A PANASZA MOST?").
  if (!/[.。]$/.test(trimmed) && (ORDINAL_UNIT.test(trimmed) || ROMAN_UNIT.test(trimmed)))
    return true
  if (/[.!?。！？]$/.test(trimmed)) return false
  if (/^[\d\s.\-—()()]+$/.test(trimmed)) return false
  if (KEYWORD_UNIT.test(trimmed)) return true
  // All-caps short line, in any alphabet with case (Latin with diacritics,
  // Greek, Cyrillic): at least four characters and no lower-case letter.
  if (
    /^[\p{Lu}\p{M}0-9 \-–:&/,'’()]{4,}$/u.test(trimmed) &&
    (trimmed.match(/\p{Lu}/gu)?.length ?? 0) >= 2
  )
    return true
  if (/^第[一二三四五六七八九十百千零0-9]+[章篇部分单元]/.test(trimmed)) return true
  return false
}

/**
 * Several numbered items on one line ("1: IGAZ, 2: HAMIS, 3: IGAZ" in an
 * answer key): a list, never a heading.
 */
export function isNumberedList(line: string): boolean {
  return (line.match(/(?:^|[\s,;])\d{1,3}\s*[:)]/g)?.length ?? 0) >= 2
}

/** Comparison key for a running header / footer: case, digits and spacing ignored. */
export function runningLineKey(line: string): string {
  return line.normalize('NFC').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

/**
 * Lines repeated on at least half of the pages (running headers and footers:
 * the course title, the author, "Page 3 of 40"). Returned as `runningLineKey`s.
 * Needs at least four pages to say anything.
 */
export function findRunningLines(pages: ReadonlyArray<ReadonlyArray<string>>): Set<string> {
  const running = new Set<string>()
  const pageCount = pages.filter((lines) => lines.length > 0).length
  if (pageCount < 4) return running
  const seen = new Map<string, number>()
  for (const lines of pages) {
    const keys = new Set(lines.map(runningLineKey).filter((key) => key.length > 0))
    for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count >= Math.max(3, pageCount / 2)) running.add(key)
  }
  return running
}
