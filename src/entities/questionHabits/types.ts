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
  /** Choice-option conventions, e.g. a final "None of the options are correct" (F). */
  | 'options'
  /** Marks shown per question / sub-part. */
  | 'marks'
  /** Students rely on a provided data / formula sheet. */
  | 'data_sheet'
  /** How strictly significant figures are graded. */
  | 'sig_figs'
  /** Context stories, including details not needed for the answer. */
  | 'context'

export const QUESTION_HABIT_CATEGORIES: readonly QuestionHabitCategory[] = [
  'types',
  'structure',
  'wording',
  'notation',
  'numbers',
  'traps',
  'answer_format',
  'difficulty',
  'options',
  'marks',
  'data_sheet',
  'sig_figs',
  'context',
]

export function isQuestionHabitCategory(value: unknown): value is QuestionHabitCategory {
  return (
    typeof value === 'string' && (QUESTION_HABIT_CATEGORIES as readonly string[]).includes(value)
  )
}

/** Where a question came from. */
export type QuestionHabitSourceKind = 'homework' | 'practice' | 'syllabus' | 'exam'

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

// --- Professor conventions ------------------------------------------------------

/**
 * Conventions question generators follow explicitly (beyond the free-text
 * habits block), read from the items of the matching categories.
 */
export type ProfessorConvention =
  'none_of_above' | 'marks_per_part' | 'data_sheet' | 'context_story' | 'sig_figs'

export interface ProfessorConventions {
  conventions: ProfessorConvention[]
  /** `none_of_above`: the professor's own wording, from an evidence quote when one shows it. */
  noneOptionLabel?: string
  /**
   * Several questions share one figure / graph (e.g. three multiple choice on
   * one supply-and-demand graph). Kept apart from `conventions`, which the
   * quiz and practice prompts read: only the AI mock paper uses it (it groups
   * such questions of the past paper, `detectFigureGroups`).
   */
  figureGroups?: boolean
}

/**
 * A habit saying questions come in groups that share one figure: "questions
 * 3–5 refer to the same graph", "MCQs come in sets of three based on one
 * diagram", "根据下图回答第 3–5 题", "同一张图".
 */
export const FIGURE_GROUP_PATTERN =
  /\b(?:share|shares|sharing|refer to|based on|use|uses|using|about)\b[^.\n]{0,40}\b(?:same|one|a single|single|shared|common|following|above)\s+(?:graph|figure|diagram|chart|table|exhibit)|(?:groups?|sets?|blocks?|series)\s+of\s+(?:\d+|two|three|four|five|several)\s+(?:multiple[- ]choice\s+)?(?:questions|items|mcqs?|mcs?)\b[^.\n]{0,40}\b(?:graph|figure|diagram|chart|table|exhibit)|questions?\s+\d+\s*(?:-|–|—|to|through)\s*\d+[^.\n]{0,40}\b(?:graph|figure|diagram|chart|table)|(?:graph|figure|diagram|chart|table)[^.\n]{0,40}questions?\s+\d+\s*(?:-|–|—|to|through)\s*\d+|同一(?:张|幅|个)?(?:图|图表|表)|根据(?:下|上|该)?图[^。\n]{0,10}回答[^。\n]{0,6}\d+\s*[-–—~～至到]\s*\d+|共用(?:一张|一幅|同一)?图/i

/** "None of the options are correct", "以上都不对", "none of the above" … */
export const NONE_OPTION_PATTERN =
  /none of (?:the )?(?:above|options|these|answers)|no correct (?:option|answer)|以上(?:都|均|皆)?(?:不|非)|都不(?:对|正确)|均不正确|以上皆非/i

/** The final option's wording from a quote such as "F. None of the options are correct". */
function noneLabelFrom(quote: string): string | undefined {
  const line = quote
    .split(/\n|(?=\b[A-F][.)]\s)/)
    .map((part) => part.trim())
    .find((part) => NONE_OPTION_PATTERN.test(part))
  if (!line) return undefined
  const label = line
    .replace(/^\(?[A-Fa-f][.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return label.length >= 6 && label.length <= 80 ? label : undefined
}

export function professorConventions(
  profile: QuestionHabitsProfile | undefined,
): ProfessorConventions {
  if (!profile || !habitsEnabled(profile)) return { conventions: [] }
  const found = new Set<ProfessorConvention>()
  let noneOptionLabel: string | undefined
  let figureGroups = false
  for (const item of profile.items) {
    if (!item.statement.trim()) continue
    if (
      FIGURE_GROUP_CATEGORIES.has(item.category) &&
      (FIGURE_GROUP_PATTERN.test(item.statement) ||
        item.evidence.some((evidence) => FIGURE_GROUP_PATTERN.test(evidence.quote)))
    )
      figureGroups = true
    switch (item.category) {
      case 'options': {
        const quotes = item.evidence.map((evidence) => evidence.quote)
        if (
          NONE_OPTION_PATTERN.test(item.statement) ||
          quotes.some((q) => NONE_OPTION_PATTERN.test(q))
        ) {
          found.add('none_of_above')
          noneOptionLabel ??= quotes.map(noneLabelFrom).find(Boolean)
        }
        break
      }
      case 'marks':
        found.add('marks_per_part')
        break
      case 'data_sheet':
        found.add('data_sheet')
        break
      case 'context':
        found.add('context_story')
        break
      case 'sig_figs':
        found.add('sig_figs')
        break
      default:
        break
    }
  }
  const order: ProfessorConvention[] = [
    'none_of_above',
    'marks_per_part',
    'data_sheet',
    'context_story',
    'sig_figs',
  ]
  return {
    conventions: order.filter((convention) => found.has(convention)),
    ...(noneOptionLabel ? { noneOptionLabel } : {}),
    ...(figureGroups ? { figureGroups: true } : {}),
  }
}

/** Categories in which a habit may describe questions sharing one figure. */
const FIGURE_GROUP_CATEGORIES = new Set<QuestionHabitCategory>([
  'structure',
  'types',
  'options',
  'context',
  'wording',
])

/** The habits items about significant figures (shown next to the course's grading rule). */
export function sigFigHabitItems(profile: QuestionHabitsProfile | undefined): QuestionHabitItem[] {
  return profile ? profile.items.filter((item) => item.category === 'sig_figs') : []
}
