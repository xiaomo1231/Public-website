import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface HomeworkAnswerCheckInput {
  question: string
  studentAnswer: string
  referenceAnswer: string
  referenceKind: 'professor' | 'ai_solution'
  sourceText: string
  language: 'zh' | 'en'
}

export function buildSystemPrompt(): string {
  return [
    'Assess ONE student homework answer against the supplied reference and question.',
    'Return JSON only: {"status":"ready","similarityPercent":0-100,"verdict":"correct|partial|incorrect|uncertain","feedback":"...","matchedPoints":["..."],"missingPoints":["..."]} or {"status":"insufficient","reason":"..."}.',
    'similarityPercent estimates semantic coverage of the required answer, NOT word overlap, certainty, a score, or a grade. Give credit for mathematically equivalent forms and valid alternative methods.',
    'Judge the final answer AND essential reasoning when the question asks for steps, proof, explanation, or units. Do not claim correctness from matching keywords. Explain any discrepancy concretely.',
    'A professor answer is a confirmed reference for this question, but extraction can be imperfect. An AI solution is unverified: check its claims against the question and source; if unreliable or missing crucial conditions, return insufficient or uncertain.',
    'Do not invent missing parts of a diagram, source, professor answer, or student work. If the question or reference is too incomplete to assess, return insufficient with a specific reason.',
    'Feedback must be neutral and actionable. Never judge student ability or call a mistake careless. No markdown fence or prose outside JSON.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkAnswerCheckInput): string {
  return [
    `Reply in ${input.language === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    `Reference kind: ${input.referenceKind === 'professor' ? 'confirmed professor answer' : 'unverified AI worked solution'}.`,
    untrustedContentWrapper('CURRENT QUESTION', input.question),
    input.sourceText.trim() ? untrustedContentWrapper('QUESTION SOURCE PASSAGES', input.sourceText) : '',
    untrustedContentWrapper('REFERENCE ANSWER', input.referenceAnswer),
    untrustedContentWrapper('STUDENT ANSWER', input.studentAnswer),
    'Return JSON only.',
  ].filter(Boolean).join('\n')
}

export type NormalizedAnswerAssessment =
  | { status: 'ready'; similarityPercent: number; verdict: 'correct' | 'partial' | 'incorrect' | 'uncertain'; feedback: string; matchedPoints: string[]; missingPoints: string[] }
  | { status: 'insufficient'; reason: string }

export function normalizeAssessment(raw: unknown): NormalizedAnswerAssessment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 3000) : ''
  if (row.status === 'insufficient') {
    const reason = text(row.reason)
    return reason ? { status: 'insufficient', reason } : null
  }
  if (row.status !== 'ready' || typeof row.similarityPercent !== 'number' ||
    !Number.isInteger(row.similarityPercent) || row.similarityPercent < 0 || row.similarityPercent > 100 ||
    !['correct', 'partial', 'incorrect', 'uncertain'].includes(String(row.verdict))) return null
  const feedback = text(row.feedback)
  if (!feedback) return null
  const list = (value: unknown): string[] | null => Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map(text).filter(Boolean).slice(0, 8) : null
  const matchedPoints = list(row.matchedPoints)
  const missingPoints = list(row.missingPoints)
  if (!matchedPoints || !missingPoints) return null
  return {
    status: 'ready', similarityPercent: row.similarityPercent,
    verdict: row.verdict as 'correct' | 'partial' | 'incorrect' | 'uncertain',
    feedback, matchedPoints, missingPoints,
  }
}
