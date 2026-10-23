import { walkthroughSubparts } from '@/entities/homework/splitQuestion'

/**
 * Marks printed on an exam paper, read locally from the question text:
 * "(10 marks)", "[3]", "[3 marks]", "(5 points)", "5 pts", "（5分）", "(共 10 分)".
 * Nothing is guessed: a question or part without a printed mark has none.
 */

export interface PartMarks {
  /** Sub-part letter (`a`, `b`, …); absent for the whole question. */
  label?: string
  marks: number
}

export interface QuestionMarks {
  /** Marks per sub-part, when the parts state them. */
  parts: PartMarks[]
  /** Marks for the whole question: stated for the question, else the sum of its parts. */
  total?: number
}

const MARK_PATTERNS: RegExp[] = [
  // (10 marks) [3 marks] (5 points) [2 pts] (1 mark)
  /[([]\s*(?:total\s*[:：]?\s*)?(\d{1,3}(?:\.5)?)\s*(?:marks?|points?|pts?\.?|m)\s*[)\]]/gi,
  // [3]  — a bare number in square brackets at the end of a line / part
  /\[\s*(\d{1,3}(?:\.5)?)\s*\](?=\s*(?:$|\n|[(（][a-z][)）]))/gi,
  // （5分）(共10分) (5 分)
  /[(（]\s*(?:共|计|本题|本小题)?\s*(\d{1,3}(?:\.5)?)\s*分\s*[)）]/g,
  // 10 marks  /  10分 at the very end of a line
  /(?:^|\s)(\d{1,3}(?:\.5)?)\s*(?:marks|分)\s*[.。]?\s*$/gim,
]

/** All marks stated in a piece of text, in reading order. */
export function marksIn(text: string): number[] {
  const found: Array<{ index: number; value: number }> = []
  const seen = new Set<number>()
  for (const pattern of MARK_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0
      if (seen.has(index)) continue
      const value = Number(match[1])
      if (!Number.isFinite(value) || value <= 0 || value > 200) continue
      seen.add(index)
      found.push({ index, value })
    }
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.value)
}

/**
 * Marks of one question. Parts are read from `(a) … (b) …`; a part counts
 * only when it states exactly one mark. The question total is the mark stated
 * before the first part (when there are parts) or the only mark in the text,
 * else the sum of every part's marks when all parts state one.
 */
export function parseQuestionMarks(prompt: string): QuestionMarks {
  const parts = walkthroughSubparts(prompt)
  if (parts.length >= 2) {
    const partMarks: PartMarks[] = []
    for (const part of parts) {
      const marks = marksIn(part.text)
      if (marks.length === 1) partMarks.push({ label: part.label, marks: marks[0]! })
    }
    const firstPart = prompt.search(/[(（]a[)）]/i)
    const head = firstPart > 0 ? prompt.slice(0, firstPart) : ''
    const headMarks = marksIn(head)
    const sum = partMarks.reduce((total, part) => total + part.marks, 0)
    const total =
      headMarks.length === 1
        ? headMarks[0]
        : partMarks.length === parts.length && partMarks.length > 0
          ? sum
          : undefined
    return { parts: partMarks, ...(total !== undefined ? { total } : {}) }
  }
  const marks = marksIn(prompt)
  return marks.length === 1 ? { parts: [], total: marks[0]! } : { parts: [] }
}

/**
 * One item of a professor's rubric box ("2 pts: Rightward shift of S",
 * "3 marks – explains the direction of change", "2分：画出新均衡").
 */
export interface RubricItem {
  points: number
  /** The item's wording, verbatim (continuation lines joined with a space). */
  text: string
  /** A sub-heading printed above the item inside the box ("Graph"). */
  group?: string
}

const RUBRIC_ITEM =
  /^\s*[-•*]?\s*(\d{1,3}(?:\.5)?)\s*(?:pts?\.?|points?|marks?|分)\s*[:：–—-]\s*(.+)$/i
/** A new question part or question starts: the rubric box has ended. */
const PART_START = /^\s*(?:[(（][a-z][)）]|[a-z][)）]\s|\(?\d{1,3}[.)]\s|question\b|problem\b)/i
/** A short heading inside a rubric box ("Graph", "Explanation"). */
const RUBRIC_HEADING = /^[A-Z一-鿿][\w一-鿿 ]{0,24}:?$/

/**
 * Items of the professor's rubric boxes in an answer key: each starts with
 * its points ("2 pts:"); the lines after it belong to it until the next item,
 * a short heading inside the box ("Graph"), or the next question part. Only
 * printed points are read — a hand-corrected value ("8" crossed out to "10")
 * is not, so the printed value is kept and the proofread page shows the box.
 */
export function parseRubricItems(text: string | undefined): RubricItem[] {
  if (!text) return []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const items: RubricItem[] = []
  let current: RubricItem | undefined
  let continued = 0
  let group: string | undefined
  for (const [index, line] of lines.entries()) {
    const item = RUBRIC_ITEM.exec(line)
    if (item) {
      const points = Number(item[1])
      if (!Number.isFinite(points) || points <= 0 || points > 200) continue
      current = { points, text: item[2]!.trim(), ...(group ? { group } : {}) }
      items.push(current)
      continued = 0
      continue
    }
    if (!current) continue
    // A heading followed by an item opens a group inside the same box.
    if (RUBRIC_HEADING.test(line) && RUBRIC_ITEM.test(lines[index + 1] ?? '')) {
      group = line.replace(/:$/, '')
      current = undefined
      continue
    }
    if (PART_START.test(line) || marksIn(line).length > 0 || continued >= 6) {
      current = undefined
      group = undefined
      continue
    }
    current.text = `${current.text} ${line}`.replace(/\s+/g, ' ')
    continued++
  }
  return items
}

/** A rubric item as one line, as printed ("2 pts: Rightward shift of S"). */
export function formatRubricItem(item: RubricItem): string {
  const unit = item.points === 1 ? 'pt' : 'pts'
  return `${item.group ? `${item.group} · ` : ''}${item.points} ${unit}: ${item.text}`
}

/**
 * Lines of a professor answer key that carry marks ("M1", "A1", "B1", "[2]",
 * "(1 mark)", "2分", rubric boxes "2 pts: …"): the professor's own marking
 * scheme, shown verbatim and never mixed with platform estimates. Empty when
 * the key states no marks.
 */
export function markingSchemeLines(answerText: string | undefined): string[] {
  if (!answerText) return []
  const rubric = parseRubricItems(answerText)
  if (rubric.length > 0) return rubric.map(formatRubricItem).slice(0, 30)
  const lines = answerText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines
    .filter(
      (line) =>
        marksIn(line).length > 0 ||
        /(?:^|[\s,;(])(?:[MABE]\d)(?=$|[\s,;)])/.test(line) ||
        /\d+\s*分(?!之|析|别|布|子|数)/.test(line),
    )
    .slice(0, 30)
}
