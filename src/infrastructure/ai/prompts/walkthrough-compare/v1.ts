/**
 * 与教授答案对照: compare one question's walkthrough section with the
 * professor's confirmed answer to the same question, sub-part by sub-part,
 * and say whether to keep it, align it with the professor's method, or fix a
 * result. The model only compares; it never rewrites. The reply is checked
 * locally (`entities/homework/professorCompare.ts`): labels must be sub-parts
 * of this question or of the professor answer, quotes must occur in the
 * professor answer, and the recommendation follows from the statuses.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import { languageRule, type WalkthroughPromptLanguage } from '../homework-walkthrough/v1'

export const VERSION = 'v1' as const

export const COMPARE_STATUSES = [
  'same',
  'method_differs',
  'result_differs',
  'missing_in_walkthrough',
  'not_in_professor',
] as const
export type CompareStatus = (typeof COMPARE_STATUSES)[number]

export const COMPARE_RECOMMENDATIONS = ['keep', 'align', 'fix'] as const
export type CompareRecommendation = (typeof COMPARE_RECOMMENDATIONS)[number]

export function buildSystemPrompt(): string {
  return [
    'You compare a study app’s walkthrough of ONE university homework question with the professor’s confirmed answer to the same question. The student is graded against the professor’s answer, so differences in method matter, not only differences in results.',
    'Return strictly valid JSON:',
    '{"items":[{"label":"(a)","status":"same|method_differs|result_differs|missing_in_walkthrough|not_in_professor","note":"...","professorQuote":"..."}],"recommendation":"keep|align|fix","suggestion":"..."}',
    '"items": one entry per sub-part that appears in the question or in the professor answer, in order, labelled like "(a)". For a question without sub-parts use one entry with the label "".',
    'Read the WHOLE professor answer and map its content to the question’s sub-parts by meaning, not only by labels: a professor solution may answer one sub-part inside another one’s solution, and labels such as (a)/(b) inside one solution may name alternative methods ("two ways") rather than the question’s sub-parts. Compare each sub-part of the walkthrough with whatever part of the professor answer covers its content.',
    'status — "same": same method and same result (wording, layout and extra explanation do not count as a difference); "method_differs": same result, but the walkthrough uses a different method, a different order of steps, different row operations or a different answer form than the professor; "result_differs": the final results disagree; "missing_in_walkthrough": the professor answers this sub-part but the walkthrough leaves it out (in the body or the conclusion); "not_in_professor": NO part of the professor answer covers this sub-part’s content (when it is covered elsewhere, e.g. inside another sub-part’s solution, compare with that content instead and say where in the note).',
    '"note": one or two short sentences saying concretely what differs (which method or steps the professor uses instead, which result differs) — or, for "same", what agrees. When the professor answer has an obvious typo (a wrong part reference, a repeated symbol), say so in the note and treat it as a typo, not as a different result.',
    '"professorQuote": a short passage copied EXACTLY from the professor answer (at most one line) that shows the professor’s method or result for this sub-part — from wherever in the answer that content is; leave it out when there is none.',
    '"recommendation": "keep" when every sub-part is "same" or "not_in_professor"; "align" when the results agree but some method differs; "fix" when a result differs or a sub-part is missing.',
    '"suggestion": for "align" or "fix", concrete instructions for rewriting the walkthrough so it follows the professor (which sub-parts, which method, steps or results to adopt), at most five short lines; "" for "keep".',
    'Compare only: do not solve the question again and do not grade the student. No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export interface CompareUserInput {
  label: string
  question: string
  /** Sub-part letters of the question (`a`, `b`, …); empty without sub-parts. */
  parts: string[]
  professorAnswer: string
  conclusion?: string
  body: string
  language: WalkthroughPromptLanguage
}

const WALKTHROUGH_CHARS = 24_000
const ANSWER_CHARS = 16_000

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value
}

export function buildUserPrompt(input: CompareUserInput): string {
  const walkthrough = [
    input.conclusion?.trim() ? `Conclusion: ${input.conclusion.trim()}` : '',
    input.body,
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    `${languageRule(input.language)} This applies to "note" and "suggestion".`,
    `This comparison is for question ${input.label}.`,
    input.parts.length > 0
      ? `Sub-parts of the question: ${input.parts.map((part) => `(${part})`).join(', ')}.`
      : 'The question has no lettered sub-parts (the professor answer may still have some).',
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    untrustedContentWrapper(
      'CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION',
      clip(input.professorAnswer, ANSWER_CHARS),
    ),
    untrustedContentWrapper('WALKTHROUGH SECTION TO COMPARE', clip(walkthrough, WALKTHROUGH_CHARS)),
    'Return JSON only.',
  ].join('\n')
}

// --- Reading the reply ------------------------------------------------------

export interface RawCompareItem {
  label: string
  status: CompareStatus
  note: string
  professorQuote?: string
}

export interface NormalizedCompare {
  items: RawCompareItem[]
  recommendation?: CompareRecommendation
  suggestion: string
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Shape check only; the local validation decides what is kept. */
export function normalizeCompare(raw: unknown): NormalizedCompare | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (!Array.isArray(row.items)) return null
  const items: RawCompareItem[] = []
  for (const value of row.items.slice(0, 30)) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const status = item.status
    if (!COMPARE_STATUSES.includes(status as CompareStatus)) continue
    const quote = str(item.professorQuote, 400)
    items.push({
      label: typeof item.label === 'number' ? String(item.label) : str(item.label, 40),
      status: status as CompareStatus,
      note: str(item.note, 800),
      ...(quote ? { professorQuote: quote } : {}),
    })
  }
  const recommendation = COMPARE_RECOMMENDATIONS.includes(
    row.recommendation as CompareRecommendation,
  )
    ? (row.recommendation as CompareRecommendation)
    : undefined
  return {
    items,
    ...(recommendation ? { recommendation } : {}),
    suggestion: str(row.suggestion, 1_200),
  }
}
