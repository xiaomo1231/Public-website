import { fnv1a } from '@/shared/lib/hash'
import type {
  CompareRecommendation,
  CompareStatus,
  NormalizedCompare,
} from '@/infrastructure/ai/prompts/walkthrough-compare/v1'
import { quoteFoundIn } from '@/entities/questionHabits/types'
import type { LinearSystemCheck, WalkthroughSection } from './walkthrough'

export type { CompareRecommendation, CompareStatus }

/**
 * 与教授答案对照: how one question's walkthrough section compares with the
 * professor's confirmed answer, sub-part by sub-part. Stored on the section;
 * it describes exactly the answer and the text it was made from, so it is
 * stale (and no longer shown) once either changes.
 */
export interface ProfessorCompareItem {
  /** Sub-part letter (`a`), or `''` for a question without sub-parts. */
  label: string
  status: CompareStatus
  note: string
  /** Checked to occur in the professor answer. */
  professorQuote?: string
  /**
   * `result_differs` only: what the local RREF re-check says about the
   * walkthrough's own row reduction for this sub-part.
   */
  localCheck?: 'verified' | 'mismatch'
}

export interface ProfessorCompareReport {
  /** `professorAnswerHash` of the answer compared with. */
  answerHash: string
  /** `compareSectionHash` of the (standard) text compared. */
  sectionHash: string
  items: ProfessorCompareItem[]
  recommendation: CompareRecommendation
  /** What to change, in the model's words (used for 按教授答案修改). */
  suggestion: string
  comparedAt: number
  /** 保持现状: the student chose to keep the section as it is. */
  dismissed?: boolean
}

export function professorAnswerHash(answer: string): string {
  return fnv1a(answer.trim())
}

/** The text a comparison describes: the standard version's conclusion and body. */
export function compareSectionHash(
  section: Pick<WalkthroughSection, 'conclusion' | 'body'>,
): string {
  return fnv1a(JSON.stringify([section.conclusion ?? '', section.body]))
}

/** The stored report, when it still describes this answer and this text. */
export function currentCompare(
  section: WalkthroughSection | undefined,
  professorAnswer: string | undefined,
): ProfessorCompareReport | undefined {
  const report = section?.professorCompare
  if (!report || !professorAnswer || section?.status !== 'ready') return undefined
  return report.answerHash === professorAnswerHash(professorAnswer) &&
    report.sectionHash === compareSectionHash(section)
    ? report
    : undefined
}

/** The section was written following this professor answer (「已按教授答案」). */
export function isAlignedWith(
  section: WalkthroughSection | undefined,
  professorAnswer: string | undefined,
): boolean {
  return Boolean(
    professorAnswer &&
    section?.professorAligned &&
    section.professorAligned.answerHash === professorAnswerHash(professorAnswer),
  )
}

/**
 * A ready section with a professor answer that has been neither written
 * following that answer nor compared with it yet (the toolbar's 「可对照」).
 */
export function awaitsCompare(
  section: WalkthroughSection | undefined,
  professorAnswer: string | undefined,
): boolean {
  return Boolean(
    professorAnswer &&
    section?.status === 'ready' &&
    section.kind === 'question' &&
    !isAlignedWith(section, professorAnswer) &&
    !currentCompare(section, professorAnswer),
  )
}

/**
 * Sub-part letters named in a professor answer: `(a)`, `（b）`, … anywhere,
 * lower case only (a capital `(A)` is more likely a matrix), in order of
 * first appearance.
 */
export function professorAnswerLabels(answer: string): string[] {
  const labels: string[] = []
  for (const match of answer.matchAll(/(?:^|[^\p{L}\p{N}_])[(（]([a-z])[)）]/gu)) {
    const letter = match[1]!
    if (!labels.includes(letter)) labels.push(letter)
  }
  return labels
}

/** `(b)`, `b`, `2(b)`, `（b）` → `b`; `''`, `whole`, `1` → `''`; anything else → null. */
export function normalizeCompareLabel(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  if (!text || text === 'whole' || /^\d+$/.test(text) || text === '整题') return ''
  const bracketed = /[(（]([a-z])[)）]\s*$/.exec(text)
  if (bracketed) return bracketed[1]!
  const bare = /^(?:\d+\s*)?([a-z])[).）]?$/.exec(text)
  return bare ? bare[1]! : null
}

const SEVERITY: Record<CompareStatus, number> = {
  same: 0,
  not_in_professor: 0,
  method_differs: 1,
  result_differs: 2,
  missing_in_walkthrough: 2,
}

const RECOMMENDATION_BY_SEVERITY: CompareRecommendation[] = ['keep', 'align', 'fix']

export interface CompareContext {
  /** Sub-part letters of the question, in order. */
  questionParts: readonly string[]
  professorAnswer: string
  /** The section's local RREF checks (labels like `(a)` or `(a) #2`). */
  checks?: readonly LinearSystemCheck[]
}

export interface ValidatedCompare {
  items: ProfessorCompareItem[]
  recommendation: CompareRecommendation
  suggestion: string
  /** Items dropped for a label that is no sub-part of the question or the answer. */
  droppedLabels: number
  /** Quotes dropped because they do not occur in the professor answer. */
  droppedQuotes: number
}

/**
 * Keep only what can be trusted: labels must be sub-parts of the question or
 * of the professor answer (one item each, in order), quotes must occur in the
 * professor answer, and the recommendation is derived from the statuses (the
 * model's own word only fills in when nothing is left to derive it from).
 * Null when no item survives.
 */
export function validateCompare(
  reply: NormalizedCompare,
  context: CompareContext,
): ValidatedCompare | null {
  const answerParts = professorAnswerLabels(context.professorAnswer)
  const order = [
    '',
    ...context.questionParts,
    ...answerParts.filter((part) => !context.questionParts.includes(part)),
  ]
  const allowed = new Set(order)
  const byLabel = new Map<string, ProfessorCompareItem>()
  let droppedLabels = 0
  let droppedQuotes = 0
  for (const raw of reply.items) {
    const label = normalizeCompareLabel(raw.label)
    if (label === null || !allowed.has(label)) {
      droppedLabels += 1
      continue
    }
    if (byLabel.has(label)) continue
    let quote = raw.professorQuote
    if (quote && !quoteFoundIn(quote, context.professorAnswer)) {
      droppedQuotes += 1
      quote = undefined
    }
    const localCheck =
      raw.status === 'result_differs' ? checkVerdict(label, context.checks ?? []) : undefined
    byLabel.set(label, {
      label,
      status: raw.status,
      note: raw.note,
      ...(quote ? { professorQuote: quote } : {}),
      ...(localCheck ? { localCheck } : {}),
    })
  }
  const items = order.flatMap((label) => {
    const item = byLabel.get(label)
    return item ? [item] : []
  })
  if (items.length === 0) return null
  const severity = Math.max(...items.map((item) => SEVERITY[item.status]))
  const recommendation = RECOMMENDATION_BY_SEVERITY[severity]!
  return {
    items,
    recommendation,
    suggestion: recommendation === 'keep' ? '' : reply.suggestion,
    droppedLabels,
    droppedQuotes,
  }
}

/** The local RREF re-check of the walkthrough's own work for one sub-part. */
function checkVerdict(
  label: string,
  checks: readonly LinearSystemCheck[],
): ProfessorCompareItem['localCheck'] {
  const own = label ? checks.filter((check) => check.label.includes(`(${label})`)) : checks
  if (own.length === 0) return undefined
  return own.every((check) => check.rrefMatches && check.kindMatches) ? 'verified' : 'mismatch'
}

/** Most of the suggestion `regenerateSection` accepts. */
const ALIGN_SUGGESTION_CHARS = 1_000

/**
 * The revision request for 按教授答案修改: every sub-part that is not the
 * same, with what to change, then the model's own suggestion — within the
 * length a revision request keeps.
 */
export function alignSuggestion(
  report: Pick<ProfessorCompareReport, 'items' | 'suggestion'>,
  language: 'zh' | 'en',
): string {
  const zh = language === 'zh'
  const lines = [
    zh
      ? '请按教授答案修改：沿用教授的方法、步骤顺序、行变换、记号与答案形式；其它方法或额外检验放在后面并标为补充。'
      : 'Rewrite following the professor’s answer: use the professor’s method, step order, row operations, notation and answer form; put other methods or extra checks after it, marked as supplementary.',
  ]
  for (const item of report.items) {
    if (item.status === 'same') continue
    const part = item.label ? `(${item.label})` : zh ? '整题' : 'Whole question'
    const what = zh ? STATUS_ZH[item.status] : STATUS_EN[item.status]
    lines.push(`- ${part} ${what}${item.note ? `: ${item.note}` : ''}`)
  }
  if (report.suggestion.trim()) lines.push(report.suggestion.trim())
  const text = lines.join('\n')
  return text.length > ALIGN_SUGGESTION_CHARS
    ? `${text.slice(0, ALIGN_SUGGESTION_CHARS - 1)}…`
    : text
}

const STATUS_ZH: Record<CompareStatus, string> = {
  same: '一致',
  method_differs: '方法与教授不同',
  result_differs: '结果与教授不同',
  missing_in_walkthrough: '讲解缺少这一小题',
  not_in_professor: '教授未给出解答',
}

const STATUS_EN: Record<CompareStatus, string> = {
  same: 'same',
  method_differs: 'method differs from the professor',
  result_differs: 'result differs from the professor',
  missing_in_walkthrough: 'missing in the walkthrough',
  not_in_professor: 'no professor solution',
}
