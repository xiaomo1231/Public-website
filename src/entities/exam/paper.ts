/**
 * Local reading of a past paper's front matter: the time allowed, whether it
 * carries a formula / data sheet, and whether a file name reads like a past
 * paper. All deterministic; nothing is sent anywhere.
 */

/** File-name wording of a past paper / mock paper (suggests the `past_exam` role). */
const PAST_EXAM_NAME =
  /(?:^|[^a-z])(?:exam|exams|midterm|mid-term|final|finals|test|quiz|paper|past\s*paper|mock)(?:[^a-z]|$)|(?:^|[^a-z0-9])f\d{2}t\d(?:[^0-9]|$)|(?:^|[^a-z0-9])[sfwu]\d{2}(?:mt|fe|t\d)(?:[^0-9]|$)|期中|期末|试卷|考卷|真题|模拟卷|模拟考|往年|测验|小测/i

/** Names that are clearly something else (an answer key, a syllabus). */
const NOT_A_PAPER =
  /answer|solution|key|marking|mark\s*scheme|syllabus|handbook|topics|答案|解答|评分|大纲/i

/** Suggest `past_exam` from a file name (the student confirms; never switched silently). */
export function looksLikePastExam(name: string): boolean {
  const base = name.replace(/\.[a-z0-9]+$/i, '')
  return PAST_EXAM_NAME.test(base) && !NOT_A_PAPER.test(base)
}

const HOURS = /(\d+(?:\.\d+)?|one|two|three|four|一|两|二|三|四)\s*(?:hours?|hrs?|h\b|小时)/i
const MINUTES = /(\d{1,3})\s*(?:minutes?|mins?|分钟)/i
const DURATION_CUE =
  /time\s*(?:allowed|allowance|limit)|duration|you\s+(?:have|will\s+have)|exam(?:ination)?\s+time|writing\s+time|working\s+time|答题时间|考试时间|考试时长|时间\s*[:：]|限时|时长/i

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
}

/**
 * Total time stated on the paper, in minutes ("Time allowed: 2 hours",
 * "Duration: 90 minutes", "考试时间：120分钟", "1 hour 30 minutes"). Only lines
 * that say they are about the time are read; `undefined` when none is found.
 */
export function detectExamMinutes(text: string): number | undefined {
  const lines = text.slice(0, 6000).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!DURATION_CUE.test(line)) continue
    const window = `${line} ${lines[index + 1] ?? ''}`
    const hours = window.match(HOURS)
    const minutes = window.match(MINUTES)
    let total = 0
    if (hours) {
      const raw = hours[1]!.toLowerCase()
      total += (WORD_NUMBERS[raw] ?? Number(raw)) * 60
    }
    if (minutes) total += Number(minutes[1])
    if (total >= 5 && total <= 600) return Math.round(total)
  }
  return undefined
}

const SHEET_HEADING =
  /formula\s*sheets?|data\s*sheets?|useful\s+(?:formulae|formulas|equations|information|data)|list\s+of\s+(?:formulae|formulas|equations)|(?:physical\s+)?constants|equation\s*sheet|reference\s+(?:sheet|table)|periodic\s+table|公式表|常用公式|参考公式|常数表|附表|数据表|物理常量/i

export interface SheetChunk {
  id: string
  text: string
  pageNumber?: number
  order: number
}

export interface FormulaSheet {
  /** Pages of the sheet (sorted), when known. */
  pages: number[]
  /** The sheet's chunks, in document order (their text is shown as extracted). */
  chunkIds: string[]
  text: string
}

const EQUATION_LINE = /^[^=\n]{1,40}=[^=\n]{1,80}$/

/** Lines that are mostly equations ("v = u + at", "F = ma"). */
function equationLineCount(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => EQUATION_LINE.test(line) && !/[?？]/.test(line)).length
}

/**
 * The paper's formula / data sheet, when it has one: chunks under a heading
 * such as "Formula sheet", "Data sheet", "Useful formulas", "Physical
 * constants" (and the rest of that page), or a header block of at least four
 * bare equations before the first question. `null` when there is none.
 */
export function findFormulaSheet(chunks: readonly SheetChunk[]): FormulaSheet | null {
  const ordered = [...chunks].sort((a, b) => a.order - b.order)
  const picked = new Map<string, SheetChunk>()
  const sheetPages = new Set<number>()
  for (const chunk of ordered) {
    if (SHEET_HEADING.test(chunk.text.slice(0, 400))) {
      picked.set(chunk.id, chunk)
      if (chunk.pageNumber !== undefined) sheetPages.add(chunk.pageNumber)
    }
  }
  for (const chunk of ordered) {
    if (chunk.pageNumber !== undefined && sheetPages.has(chunk.pageNumber))
      picked.set(chunk.id, chunk)
  }
  if (picked.size === 0) {
    // A header block of equations before the first numbered question.
    const header: SheetChunk[] = []
    for (const chunk of ordered) {
      if (
        /(?:^|\n)\s*(?:question\s*)?1[.)]\s|(?:^|\n)\s*Q\s*1\b|第\s*1\s*题|一、/i.test(chunk.text)
      )
        break
      header.push(chunk)
    }
    const block = header.filter((chunk) => equationLineCount(chunk.text) >= 2)
    if (block.reduce((sum, chunk) => sum + equationLineCount(chunk.text), 0) >= 4)
      for (const chunk of block) picked.set(chunk.id, chunk)
  }
  if (picked.size === 0) return null
  const list = ordered.filter((chunk) => picked.has(chunk.id))
  const pages = [
    ...new Set(list.flatMap((chunk) => (chunk.pageNumber !== undefined ? [chunk.pageNumber] : []))),
  ].sort((a, b) => a - b)
  return {
    pages,
    chunkIds: list.map((chunk) => chunk.id),
    text: list.map((chunk) => chunk.text).join('\n\n'),
  }
}
