/**
 * 教授出题习惯档案: how the professor writes questions, read from the
 * professor's own questions (recognised homework questions, imported
 * Professor Practice questions and the question-like passages of past exams /
 * syllabi). Project-level; stored on the `CourseContext` row
 * (`CourseContext.questionHabits`), so it is exported, restored and deleted
 * with the course. No Dexie table of its own.
 *
 * Every AI-written item carries at least one evidence quote that was found
 * verbatim (after normalisation) in the text that was sent; items without
 * verifiable evidence are never stored. Items the student wrote or edited
 * (`userEdited`) are never changed or removed by an update.
 */

export type QuestionHabitCategory =
  | 'types'
  | 'structure'
  | 'wording'
  | 'notation'
  | 'numbers'
  | 'traps'
  | 'answer_format'
  | 'difficulty'

export const QUESTION_HABIT_CATEGORIES: readonly QuestionHabitCategory[] = [
  'types',
  'structure',
  'wording',
  'notation',
  'numbers',
  'traps',
  'answer_format',
  'difficulty',
]

export function isQuestionHabitCategory(value: unknown): value is QuestionHabitCategory {
  return (
    typeof value === 'string' && (QUESTION_HABIT_CATEGORIES as readonly string[]).includes(value)
  )
}

/** Where a question came from. */
export type QuestionHabitSourceKind = 'homework' | 'practice' | 'syllabus'

/** One verbatim example backing an item. */
export interface QuestionHabitEvidence {
  documentId: string
  kind?: QuestionHabitSourceKind
  /** `HomeworkQuestion.id` (homework) or `PracticeQuestion.id` (practice). */
  questionId?: string
  /** The homework set the question belongs to (for the link). */
  setId?: string
  chunkId?: string
  /** Copied from the question text (checked locally before it is stored). */
  quote: string
}

export interface QuestionHabitItem {
  id: string
  category: QuestionHabitCategory
  statement: string
  evidence: QuestionHabitEvidence[]
  /** Written or edited by the student: an AI update never touches it. */
  userEdited?: boolean
  createdAt: number
  updatedAt: number
}

/** A document whose questions have been analysed, with the fingerprint of what was read. */
export interface QuestionHabitSource {
  documentId: string
  kind: QuestionHabitSourceKind
  /** Fingerprint of every question text of the document (`habitSourceHash`). */
  hash: string
  analyzedAt: number
}

export interface QuestionHabitsProfile {
  items: QuestionHabitItem[]
  sources: QuestionHabitSource[]
  /** 「模仿教授出题」; absent = on. */
  enabled?: boolean
  promptVersion?: string
  updatedAt: number
}

/** Prompt block budget: about 600 tokens. */
export const HABITS_BLOCK_MAX_CHARS = 1_800
const STATEMENT_MAX = 240

export function habitsEnabled(profile: QuestionHabitsProfile | undefined): boolean {
  return profile !== undefined && profile.enabled !== false && profile.items.length > 0
}

/**
 * The compact professor-style block for question-writing prompts: one line per
 * item, the items with the most evidence first (student-written items count as
 * strong evidence), cut at `maxChars`. `undefined` when the profile is off or
 * empty, so prompts stay byte-identical without it.
 */
export function buildHabitsBlock(
  profile: QuestionHabitsProfile | undefined,
  maxChars = HABITS_BLOCK_MAX_CHARS,
): string | undefined {
  if (!profile || !habitsEnabled(profile)) return undefined
  const ranked = profile.items
    .map((item, index) => ({ item, index, weight: item.userEdited ? 99 : item.evidence.length }))
    .filter(({ item }) => item.statement.trim().length > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  const lines: string[] = []
  let used = 0
  for (const { item } of ranked) {
    const statement = item.statement.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_MAX)
    const line = `- [${item.category}] ${statement}`
    if (used + line.length + 1 > maxChars) continue
    lines.push(line)
    used += line.length + 1
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}

// --- Evidence ------------------------------------------------------------------

/** NFKC, lower case, unified quotes / dashes, whitespace collapsed. */
export function normalizeEvidenceText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Shortest quote that can count as evidence (normalised characters). */
export const MIN_QUOTE_CHARS = 4

/** True when `quote` occurs in `source` after normalisation. */
export function quoteFoundIn(quote: string, source: string): boolean {
  const needle = normalizeEvidenceText(quote)
  if (needle.length < MIN_QUOTE_CHARS) return false
  return normalizeEvidenceText(source).includes(needle)
}

// --- Linear-system hints -----------------------------------------------------------

/**
 * Hints for the local linear-system constructor, read from the items' own
 * words (no AI): the matrix sizes the professor uses, whether the numbers stay
 * integers, and whether systems are given as augmented matrices or equations.
 */
export interface LinearStyleHints {
  rows?: { min: number; max: number }
  vars?: { min: number; max: number }
  /** Systems are solved without fractions along the way. */
  integerOnly?: boolean
  presentation?: 'matrix' | 'equations'
}

const HINT_CATEGORIES = new Set<QuestionHabitCategory>([
  'numbers',
  'structure',
  'notation',
  'types',
  'difficulty',
])

export function linearStyleHints(profile: QuestionHabitsProfile | undefined): LinearStyleHints {
  if (!profile || !habitsEnabled(profile)) return {}
  const rows: number[] = []
  const vars: number[] = []
  let integer = false
  let fractions = false
  let matrix = false
  let equations = false
  for (const item of profile.items) {
    if (!HINT_CATEGORIES.has(item.category)) continue
    const text = item.statement.normalize('NFKC')
    const augmented = /augmented|增广/i.test(text)
    for (const match of text.matchAll(/(\d)\s*[×xX*✕]\s*(\d)/g)) {
      const m = Number(match[1])
      const n = Number(match[2]) - (augmented ? 1 : 0)
      if (m >= 2 && m <= 4 && n >= 2 && n <= 5) {
        rows.push(m)
        vars.push(n)
      }
    }
    if (/integer|whole number|整数/i.test(text)) integer = true
    if (
      /fraction|decimal|分数|小数/i.test(text) &&
      !/no fraction|without fraction|不含分数|没有分数|无分数/i.test(text)
    )
      fractions = true
    if (/no fraction|without fraction|不含分数|没有分数|无分数/i.test(text)) integer = true
    if (augmented) matrix = true
    if (
      /as (a system of )?equations|written as equations|方程组形式|写成方程组|以方程组/i.test(text)
    )
      equations = true
  }
  return {
    ...(rows.length
      ? {
          rows: { min: Math.min(...rows), max: Math.max(...rows) },
          vars: { min: Math.min(...vars), max: Math.max(...vars) },
        }
      : {}),
    ...(integer && !fractions ? { integerOnly: true } : {}),
    ...(matrix !== equations ? { presentation: matrix ? 'matrix' : 'equations' } : {}),
  }
}
