/**
 * Multiple-choice answer keys marked by position: the key is the exam paper
 * itself with a small highlight stamp, circle or highlight annotation placed
 * over the chosen option letter. The text layer does not say which option is
 * chosen; only where the marks sit does.
 *
 * Deterministic and local: every mark box is compared with the boxes of the
 * option labels (`(a)`, `b)`, `C.`) of each question on the page. A question
 * gets an answer only when exactly one of its options is clearly covered;
 * anything else is reported as ambiguous and left to the student. Nothing is
 * guessed from the wording.
 */

/** A text item in page coordinates (PDF units, y grows upwards; `y` = baseline). */
export interface PositionedText {
  str: string
  x: number
  y: number
  width: number
  height: number
}

/** A mark painted on the page (image stamp, annotation, highlight), as a box. */
export interface MarkBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface MarkedOption {
  /** Printed question number (`7`). */
  question: string
  /** Option letter, lower case (`c`). */
  option: string
  /** The option's own text after its label (`1.25; lower`), when printed. */
  text: string
}

export interface MarkedOptionsResult {
  marked: MarkedOption[]
  /** Questions with a mark that covers several of their options. */
  ambiguous: string[]
}

const QUESTION_START =
  /^\s*(?:\(\s*(\d{1,3})\s*\.?\s*\)|(\d{1,3})\s*[.)](?!\d)|Q(?:uestion)?\s*(\d{1,3})\s*[.:)]?)(?=\s|$)/i
const OPTION_START = /^\s*(?:\(\s*([a-fA-F])\s*\)|([a-fA-F])\s*[).])(?=\s|$)/

/** Marks larger than this (points) are figures, not stamps. */
const MAX_MARK_WIDTH = 80
const MAX_MARK_HEIGHT = 160
const MIN_MARK_AREA = 12

interface OptionBox {
  question: string
  letter: string
  box: MarkBox
  text: string
}

function overlap(a: MarkBox, b: MarkBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

function area(box: MarkBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0)
}

/** Is this box a plausible mark (not a figure, not a hairline)? */
export function isMarkSized(box: MarkBox): boolean {
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  return w <= MAX_MARK_WIDTH && h <= MAX_MARK_HEIGHT && w * h >= MIN_MARK_AREA
}

function optionBoxes(items: readonly PositionedText[]): OptionBox[] {
  // Reading order: top to bottom, then left to right.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  // Question labels: "(7.)" / "Q7" style when the page has them; bare "7."
  // only at the left margin (a "$ 24." inside a sentence is no label).
  const labelled = sorted.filter((item) => {
    const q = QUESTION_START.exec(item.str)
    return !!q && !q[2]
  })
  const left = Math.min(...sorted.filter((item) => item.str.trim()).map((item) => item.x))
  const isQuestion = (item: PositionedText): string | undefined => {
    const q = QUESTION_START.exec(item.str)
    if (!q) return undefined
    if (q[2] !== undefined) return labelled.length === 0 && item.x <= left + 24 ? q[2] : undefined
    return q[1] ?? q[3]
  }
  const out: OptionBox[] = []
  let question: string | undefined
  for (const item of sorted) {
    const q = isQuestion(item)
    if (q) {
      question = q
      continue
    }
    const o = OPTION_START.exec(item.str)
    if (!o || !question) continue
    const letter = (o[1] ?? o[2])!.toLowerCase()
    // The label part of the item: a share of its width by characters.
    const labelChars = o[0].trimEnd().length
    const share = item.str.length > 0 ? Math.min(1, labelChars / item.str.length) : 1
    const labelWidth = Math.max(item.width * share, item.height * 0.8)
    const height = item.height > 0 ? item.height : 10
    const rest = item.str.slice(o[0].length).trim()
    // Text of the option on the same line (it may be split into several items).
    const sameLine = sorted
      .filter((other) => other !== item && Math.abs(other.y - item.y) < 2 && other.x > item.x)
      .sort((a, b) => a.x - b.x)
      .map((other) => other.str.trim())
    out.push({
      question,
      letter,
      box: {
        x0: item.x - 1,
        y0: item.y - height * 0.3,
        x1: item.x + labelWidth + 1,
        y1: item.y + height * 0.9,
      },
      text: [rest, ...sameLine].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    })
  }
  return out
}

/**
 * Which option of each question carries a mark. A mark can cover the letters
 * of two questions (one stamp image spanning both): each question then takes
 * the single option of its own that the mark covers.
 */
export function findMarkedOptions(
  items: readonly PositionedText[],
  marks: readonly MarkBox[],
): MarkedOptionsResult {
  const options = optionBoxes(items)
  const stamps = marks.filter(isMarkSized)
  if (options.length === 0 || stamps.length === 0) return { marked: [], ambiguous: [] }
  const byQuestion = new Map<string, Map<string, { option: OptionBox; score: number }>>()
  for (const stamp of stamps) {
    for (const option of options) {
      const covered = overlap(stamp, option.box) / Math.max(1, area(option.box))
      if (covered < 0.3) continue
      const scores = byQuestion.get(option.question) ?? new Map()
      const previous = scores.get(option.letter)
      scores.set(option.letter, { option, score: Math.max(previous?.score ?? 0, covered) })
      byQuestion.set(option.question, scores)
    }
  }
  const marked: MarkedOption[] = []
  const ambiguous: string[] = []
  for (const [question, scores] of byQuestion) {
    const ranked = [...scores.values()].sort((a, b) => b.score - a.score)
    const [best, second] = ranked
    if (!best) continue
    if (second && second.score > best.score * 0.6) {
      ambiguous.push(question)
      continue
    }
    marked.push({ question, option: best.option.letter, text: best.option.text })
  }
  marked.sort((a, b) => Number(a.question) - Number(b.question))
  return { marked, ambiguous: ambiguous.sort((a, b) => Number(a) - Number(b)) }
}

/**
 * The answer-key line for a marked option, in a form the answer parser reads
 * as a labelled answer (`Answer 7: (c) 1.25; lower`).
 */
export function markedAnswerLine(mark: MarkedOption): string {
  return `Answer ${mark.question}: (${mark.option})${mark.text ? ` ${mark.text}` : ''}`
}
