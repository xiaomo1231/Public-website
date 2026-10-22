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
 * Lines of a professor answer key that carry marks ("M1", "A1", "B1", "[2]",
 * "(1 mark)", "2分"): the professor's own marking scheme, shown verbatim and
 * never mixed with platform estimates. Empty when the key states no marks.
 */
export function markingSchemeLines(answerText: string | undefined): string[] {
  if (!answerText) return []
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
