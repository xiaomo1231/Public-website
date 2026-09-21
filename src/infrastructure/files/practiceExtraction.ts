/**
 * Deterministic question extraction from professor practice material.
 *
 * This is not "PDF → one text blob → AI → quiz". It keeps the structure the
 * document actually has — question boundaries, numbering, options, an answer
 * key — and only falls back to `unknown`/`short_answer` when the structure is
 * genuinely unclear. Ambiguous output is marked low-confidence so the UI can
 * ask the learner to review it instead of guessing.
 */

import type { PracticeQuestionType } from '@/entities/practice/types'

export type { PracticeQuestionType }

export interface ParsedPracticeQuestion {
  /** The number as written in the document, e.g. "3". */
  number?: string
  prompt: string
  /** Option labels in order, without the leading letter. */
  options: string[]
  answer?: string
  type: PracticeQuestionType
  /** 0–1; drives `verified` vs `needs_review` on import. */
  confidence: number
}

export interface ParsePracticeResult {
  questions: ParsedPracticeQuestion[]
  /** `{ "1": "B", "2": "4.5" }` from an answer-key section. */
  answerKey: Record<string, string>
}

const QUESTION_START = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)、:]\s*(.*)$/i
const QUESTION_WORD = /^\s*Question\s+(\d{1,3})\b[.:)]?\s*(.*)$/i
const OPTION = /^\s*\(?([A-E])[.)、]\s+(.+)$/
const SUBPART = /^\s*\(?([a-e])[.)、]\s+(.+)$/
const ANSWER_KEY_HEADING = /^\s*(answer\s*key|answers?|答案|参考答案)\s*[:：]?\s*$/i
const ANSWER_KEY_ENTRY = /^\s*(\d{1,3})\s*[.)、:]\s*([A-Ea-e]|[-+]?\d+(?:\.\d+)?)\s*$/
const PUA = /[\uE000-\uF8FF]/
const UNRESOLVED = /\[\?\]/

/** Split the document into question body and an optional answer key. */
function splitAnswerKey(text: string): { body: string[]; keyLines: string[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const index = lines.findIndex((line) => ANSWER_KEY_HEADING.test(line))
  if (index === -1) return { body: lines, keyLines: [] }
  return { body: lines.slice(0, index), keyLines: lines.slice(index + 1) }
}

function parseAnswerKey(keyLines: string[]): Record<string, string> {
  const key: Record<string, string> = {}
  for (const line of keyLines) {
    const match = ANSWER_KEY_ENTRY.exec(line)
    if (!match) continue
    key[match[1]!] = match[2]!
  }
  return key
}

function inferType(prompt: string, options: string[], answer: string | undefined): PracticeQuestionType {
  if (options.length >= 2) {
    const labels = options.map((option) => option.trim().toLowerCase())
    if (labels.length === 2 && labels.every((l) => l === 'true' || l === 'false')) return 'true_false'
    return 'single_choice'
  }
  if (/true\s*(or|\/)\s*false/i.test(prompt)) return 'true_false'
  // Explanatory prompts are subjective even when they mention notation.
  if (/\bexplain\b|\bwhy\b|\bdescribe\b|\bdiscuss\b|\bprove\b/i.test(prompt)) return 'short_answer'
  if (answer && /^[-+]?\d+(\.\d+)?$/.test(answer.trim())) return 'numeric'
  if (/\\\(|\\\[|\^|\\frac|=/.test(prompt)) return 'math_expr'
  return 'short_answer'
}

function scoreConfidence(
  prompt: string,
  options: string[],
  answer: string | undefined,
): number {
  let confidence = 0.5
  if (options.length >= 2) confidence += 0.3
  if (answer) confidence += 0.15
  if (prompt.trim().length < 10) confidence -= 0.3
  if (PUA.test(prompt) || UNRESOLVED.test(prompt)) confidence -= 0.4
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))))
}

/**
 * Parse questions from extracted practice text.
 *
 * A question starts at a number (`1.`, `2)`, `Question 3`); uppercase `A.`–`E.`
 * lines become options; lowercase `(a)` lines are kept as sub-parts of the
 * prompt. Answers are only attached when an explicit answer key matches the
 * question number.
 */
export function parsePracticeQuestions(text: string): ParsePracticeResult {
  const { body, keyLines } = splitAnswerKey(text ?? '')
  const answerKey = parseAnswerKey(keyLines)

  interface Draft {
    number?: string
    promptLines: string[]
    options: string[]
  }
  const drafts: Draft[] = []
  let current: Draft | null = null

  for (const line of body) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current) current.promptLines.push('')
      continue
    }

    const start = QUESTION_WORD.exec(line) ?? QUESTION_START.exec(line)
    if (start) {
      // A bare "3." with no text is still a question boundary.
      current = { number: start[1], promptLines: [], options: [] }
      const rest = (start[2] ?? '').trim()
      if (rest) current.promptLines.push(rest)
      drafts.push(current)
      continue
    }

    if (!current) continue

    const option = OPTION.exec(line)
    if (option) {
      current.options.push(option[2]!.trim())
      continue
    }

    const subpart = SUBPART.exec(line)
    if (subpart) {
      current.promptLines.push(`(${subpart[1]}) ${subpart[2]!.trim()}`)
      continue
    }

    current.promptLines.push(trimmed)
  }

  const questions = drafts
    .map((draft) => {
      const prompt = draft.promptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (!prompt) return null
      const answer = draft.number ? answerKey[draft.number] : undefined
      return {
        ...(draft.number ? { number: draft.number } : {}),
        prompt,
        options: draft.options,
        ...(answer ? { answer } : {}),
        type: inferType(prompt, draft.options, answer),
        confidence: scoreConfidence(prompt, draft.options, answer),
      } satisfies ParsedPracticeQuestion
    })
    .filter((question): question is ParsedPracticeQuestion => question !== null)

  return { questions, answerKey }
}
