import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface HomeworkReviewInput {
  question: string
  sourceText: string
  professorAnswer?: string
  previousSolution?: string
  language: 'zh' | 'en'
}

export function buildSystemPrompt(): string {
  return [
    'You are preparing a complete teaching review for ONE university homework question.',
    'Follow this learning order: understand the question, identify knowledge, choose and justify a method, show each necessary step, explain the result, then check it.',
    'Return strictly valid JSON. Either:',
    '{"status":"ready","questionMeaning":"...","knowledgePoints":["..."],"method":"...","steps":["..."],"explanation":"...","interpretation":"...","check":"..."}',
    'or {"status":"insufficient","reason":"specific missing information"}.',
    'Each field must contain useful teaching content for this exact question. Steps must cover the full derivation and final answer, not just advice to try a method. Explain WHY the method fits and what the result means.',
    'Use the original notation. Use LaTeX in $...$ or $$...$$ when needed. Keep the response readable in the requested language; retain course terminology when useful.',
    'An explicitly confirmed professor answer is a reference for this question. Follow it where it provides a method or result; never present your own added reasoning as the professor’s words.',
    'A previous AI solution is only a fallible aid. Check it against the question and professor answer. Never copy an unsupported claim or invent a diagram edge, formula, source citation, or missing condition.',
    'If a necessary diagram, symbol, or answer is unreadable and you cannot derive the result reliably from the supplied text, return status insufficient with a concrete reason. Do not fabricate a complete review.',
    'Do not grade the student or infer ability. No prose outside JSON and no Markdown fence.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkReviewInput): string {
  return [
    `Write the review in ${input.language === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    untrustedContentWrapper('CURRENT HOMEWORK QUESTION', input.question),
    input.sourceText.trim()
      ? untrustedContentWrapper('CURRENT QUESTION SOURCE PASSAGES', input.sourceText)
      : '',
    input.professorAnswer?.trim()
      ? untrustedContentWrapper('CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION', input.professorAnswer)
      : '',
    input.previousSolution?.trim()
      ? untrustedContentWrapper('PREVIOUS AI WORKED SOLUTION (UNVERIFIED)', input.previousSolution)
      : '',
    'Return JSON only.',
  ].filter(Boolean).join('\n')
}

export type NormalizedHomeworkReview =
  | { status: 'ready'; questionMeaning: string; knowledgePoints: string[]; method: string; steps: string[]; explanation: string; interpretation: string; check: string }
  | { status: 'insufficient'; reason: string }

/** Reject partial output rather than displaying a plausible but incomplete derivation. */
export function normalizeReviewOutput(raw: unknown): NormalizedHomeworkReview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const sentence = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 12_000) : ''
  if (row.status === 'insufficient') {
    const reason = sentence(row.reason)
    return reason ? { status: 'insufficient', reason } : null
  }
  if (row.status !== 'ready') return null
  const questionMeaning = sentence(row.questionMeaning)
  const method = sentence(row.method)
  const explanation = sentence(row.explanation)
  const interpretation = sentence(row.interpretation)
  const check = sentence(row.check)
  const knowledgePoints = Array.isArray(row.knowledgePoints)
    ? row.knowledgePoints.map(sentence).filter(Boolean).slice(0, 8) : []
  const steps = Array.isArray(row.steps)
    ? row.steps.map(sentence).filter(Boolean).slice(0, 16) : []
  if (!questionMeaning || !method || !explanation || !interpretation || !check ||
    knowledgePoints.length === 0 || steps.length === 0) return null
  return { status: 'ready', questionMeaning, knowledgePoints, method, steps, explanation, interpretation, check }
}
