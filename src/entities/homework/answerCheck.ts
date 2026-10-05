import type { SourceReference } from '@/entities/courseAnalysis/types'
import { compareMath, numericEquivalent, parseNumeric } from '@/infrastructure/math/expressionEvaluator'
import { fnv1a } from '@/shared/lib/hash'
import type { HomeworkQuestion } from './types'
import { isDeferredProfessorAnswer } from './answerMatching'

export const HOMEWORK_ANSWER_CHECK_VERSION = 'v1'

export type AnswerVerdict = 'correct' | 'partial' | 'incorrect' | 'uncertain'
export type AnswerReferenceKind = 'professor' | 'ai_solution'

export interface HomeworkAnswerCheck {
  method: 'local' | 'ai'
  verdict: AnswerVerdict
  /** AI estimate of semantic coverage, never a course grade. Absent for local checks. */
  similarityPercent?: number
  feedback: string
  matchedPoints?: string[]
  missingPoints?: string[]
  expectedAnswer?: string
  referenceKind: AnswerReferenceKind
  inputHash: string
  language: 'zh' | 'en'
  promptVersion: string
  questionSourceRefs: SourceReference[]
  answerChunkIds: string[]
  createdAt: number
}

export function answerReference(question: HomeworkQuestion): { kind: AnswerReferenceKind; text: string } | null {
  if (question.answerStatus === 'matched') {
    const text = question.answerText?.trim() ?? ''
    return text && !isDeferredProfessorAnswer(text) ? { kind: 'professor', text } : null
  }
  const text = question.solution?.trim() ?? ''
  return text && question.generationStatus === 'ready' ? { kind: 'ai_solution', text } : null
}

export function answerCheckInputHash(
  question: HomeworkQuestion,
  draft: string,
  language: 'zh' | 'en',
  promptVersion = HOMEWORK_ANSWER_CHECK_VERSION,
): string {
  return fnv1a(JSON.stringify({
    questionId: question.id,
    prompt: question.prompt,
    sourceRefs: question.sourceRefs,
    contentFingerprint: question.contentFingerprint,
    answerChunkIds: question.answerChunkIds,
    reference: answerReference(question),
    draft: draft.trim(),
    language,
    promptVersion,
  }))
}

export function currentAnswerCheck(
  question: HomeworkQuestion,
  draft: string,
  language: 'zh' | 'en',
  /** The version the check must have been produced with (prompt + subject). */
  promptVersion: string = HOMEWORK_ANSWER_CHECK_VERSION,
): HomeworkAnswerCheck | null {
  const check = question.answerCheck
  return check && check.language === language && check.promptVersion === promptVersion &&
    check.inputHash === answerCheckInputHash(question, draft, language, promptVersion)
    ? check : null
}

/** Only a clear one-part answer can be checked locally. Longer workings go to semantic review. */
export function checkObjectiveAnswer(
  question: HomeworkQuestion,
  referenceText: string,
  draft: string,
): { verdict: 'correct' | 'incorrect'; expectedAnswer: string } | null {
  const prompt = question.prompt
  if (prompt.length > 280) return null
  if (/(explain|justify|prove|show your work|show that|derive|discuss|why|how|set up|by hand|show steps|解释|证明|推导|说明|为什么|过程|列方程)/i.test(prompt)) return null
  if (/(^|\n)\s*(?:\([a-z]\)|[a-z][.)]|\([1-9]\)|[1-9][.)])\s+/im.test(prompt)) return null
  if (draft.trim().length > 80 || /\n/.test(draft.trim())) return null

  const reference = referenceText.trim()
    .replace(new RegExp(`^${question.number?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '§'}[.)]\\s+`), '')
    .replace(/^(?:answer|ans\.?|答案|解)\s*[:：]\s*/i, '')
    .replace(/^\$([^$]+)\$$/, '$1')
    .replace(/[。.]$/, '')
    .trim()
  const given = draft.trim().replace(/^\$([^$]+)\$$/, '$1').trim()
  if (!reference || reference.length > 80 || !given) return null

  const bool = (value: string): boolean | null => {
    if (/^(true|t|yes|正确|对)$/i.test(value)) return true
    if (/^(false|f|no|错误|错)$/i.test(value)) return false
    return null
  }
  const expectedBool = bool(reference)
  const givenBool = bool(given)
  if (expectedBool !== null && givenBool !== null) {
    return { verdict: expectedBool === givenBool ? 'correct' : 'incorrect', expectedAnswer: reference }
  }

  if (/[A-D][.)]\s+/.test(prompt) && /^[A-D]$/i.test(reference) && /^[A-D]$/i.test(given)) {
    return { verdict: reference.toUpperCase() === given.toUpperCase() ? 'correct' : 'incorrect', expectedAnswer: reference }
  }

  const objectiveCue = /(calculate|compute|evaluate|simplify|solve|find|determine|what is|add|subtract|multiply|divide|计算|求|化简|解|多少|结果)/i.test(prompt)
  if (!objectiveCue) return null
  if (/^[\d\s.,+\-*/^()×÷π√]+$/.test(reference) && /^[\d\s.,+\-*/^()×÷π√]+$/.test(given) &&
    parseNumeric(reference) !== null && parseNumeric(given) !== null) {
    const equal = numericEquivalent(given, reference, 1e-6)
    return equal === null ? null : { verdict: equal ? 'correct' : 'incorrect', expectedAnswer: reference }
  }
  if (/^[a-z\d\s+\-*/^()=.]+$/i.test(reference) && /^[a-z\d\s+\-*/^()=.]+$/i.test(given)) {
    const equal = compareMath(given, reference).equivalent
    return equal === null ? null : { verdict: equal ? 'correct' : 'incorrect', expectedAnswer: reference }
  }
  return null
}
