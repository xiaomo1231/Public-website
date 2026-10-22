import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation, RubricPointResult } from '@/entities/questionAttempt/types'
import type { SubjectInput } from '@/entities/project/types'
import type { ShortAnswerCheckOutput } from '@/infrastructure/ai/prompts/short-answer-check/v1'
import { prompts } from '@/infrastructure/ai/prompts'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { logger } from '@/infrastructure/logger/logger'
import { getUILanguage, t } from '@/i18n'
import { isAbortError } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { withLightModel, type AIService } from './aiService'

/**
 * Short-answer grading by scoring points.
 *
 * The score is the share of scoring points the answer covers — 3 of 5 points
 * is 3/5 — never an overall AI verdict. The model decides per point and must
 * quote the student's own words; each quote is checked locally against the
 * answer, and a point whose quote cannot be found is not covered. So the model
 * can miss credit, but it cannot invent it.
 */

/** Below this many non-space characters there is nothing to read. */
export const MIN_SHORT_ANSWER_CHARS = 4
const MAX_EVIDENCE = 200
const MAX_CONTRADICTIONS = 5
const MAX_FEEDBACK = 800

/**
 * Comparison form for evidence: Unicode-normalised, case-folded, with all
 * whitespace and punctuation removed, so a quote still matches across line
 * breaks, full-width punctuation or spacing differences.
 */
export function evidenceKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** True when `evidence` really appears in the student's answer. */
export function isVerbatimEvidence(evidence: string, answer: string): boolean {
  const key = evidenceKey(evidence)
  return key.length >= 2 && evidenceKey(answer).includes(key)
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD = /[\p{L}\p{N}]+/gu

/**
 * How much a quote says: each CJK character counts 1, each other word
 * (letters / digits) counts 2. So 4 counts as "4 CJK characters or 2 words".
 */
function evidenceWeight(text: string): number {
  const normalized = text.normalize('NFKC')
  const cjk = normalized.match(CJK)?.length ?? 0
  const words = normalized.replace(CJK, ' ').match(WORD)?.length ?? 0
  return cjk + 2 * words
}

/** A quote must say something: ≥4 CJK characters or ≥2 words. */
const MIN_EVIDENCE_WEIGHT = 4

/**
 * A quote long enough to show the point: at least 4 CJK characters or 2
 * words, but never more than the point itself needs (the point "ATP" is
 * covered by the quote "ATP").
 */
export function isMeaningfulEvidence(evidence: string, pointText: string): boolean {
  const needed = Math.min(MIN_EVIDENCE_WEIGHT, Math.max(1, evidenceWeight(pointText)))
  return evidenceWeight(evidence) >= needed
}

function contentLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

function baseEvaluation(question: Question, answer: string) {
  return {
    expected: question.correctAnswer,
    normalizedUser: answer,
    normalizedExpected: question.correctAnswer,
  }
}

/** Turn the model's per-point decisions into a locally verified evaluation. */
export function buildRubricEvaluation(
  question: Question,
  answer: string,
  output: ShortAnswerCheckOutput,
): QuestionEvaluation {
  const rubric = question.rubric ?? []
  const decisions = new Map<string, { covered: boolean; evidence?: string }>()
  for (const raw of Array.isArray(output.points) ? output.points : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue
    const evidence =
      typeof raw.evidence === 'string' ? raw.evidence.trim().slice(0, MAX_EVIDENCE) : undefined
    decisions.set(raw.id, { covered: raw.covered === true, ...(evidence ? { evidence } : {}) })
  }

  // One quote earns at most one point: the same words cannot be counted twice.
  const usedQuotes = new Set<string>()
  const results: RubricPointResult[] = rubric.map((point) => {
    const decision = decisions.get(point.id)
    // Credit needs a claim AND a meaningful quote that is really in the
    // answer and has not already earned another point.
    const quoteKey = decision?.evidence ? evidenceKey(decision.evidence) : ''
    const covered = Boolean(
      decision?.covered &&
      decision.evidence &&
      isVerbatimEvidence(decision.evidence, answer) &&
      isMeaningfulEvidence(decision.evidence, point.text) &&
      !usedQuotes.has(quoteKey),
    )
    if (covered) usedQuotes.add(quoteKey)
    return {
      pointId: point.id,
      text: point.text,
      covered,
      ...(covered && decision?.evidence ? { evidence: decision.evidence } : {}),
    }
  })

  const contradictions = (Array.isArray(output.contradictions) ? output.contradictions : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, MAX_EVIDENCE))
    .filter((item) => item && isVerbatimEvidence(item, answer))
    .slice(0, MAX_CONTRADICTIONS)

  const earned = results.filter((result) => result.covered).length
  const total = results.length
  const feedback =
    typeof output.feedback === 'string' ? output.feedback.trim().slice(0, MAX_FEEDBACK) : ''

  return {
    ...baseEvaluation(question, answer),
    isCorrect: total > 0 ? earned === total : null,
    method: 'rubric_ai',
    confidence: 0.8,
    score: { earned, total },
    rubric: results,
    ...(contradictions.length > 0 ? { contradictions } : {}),
    ...(feedback ? { explanation: feedback } : {}),
    note: t('shortAnswer.judgedByAi'),
  }
}

/** An empty or near-empty answer covers no point; no AI call is needed. */
export function tooShortEvaluation(question: Question, answer: string): QuestionEvaluation {
  const rubric = question.rubric ?? []
  return {
    ...baseEvaluation(question, answer),
    isCorrect: rubric.length > 0 ? false : null,
    method: 'rubric_ai',
    confidence: 1,
    score: { earned: 0, total: rubric.length },
    rubric: rubric.map((point) => ({ pointId: point.id, text: point.text, covered: false })),
    note: t('shortAnswer.tooShort'),
  }
}

/** Not graded (no AI, or the check could not be completed): shown, not scored. */
export function unverifiedShortAnswer(
  question: Question,
  answer: string,
  note: string,
): QuestionEvaluation {
  return {
    ...baseEvaluation(question, answer),
    isCorrect: null,
    method: 'unverified',
    confidence: 0,
    ...(question.rubric?.length
      ? {
          rubric: question.rubric.map((point) => ({
            pointId: point.id,
            text: point.text,
            covered: false,
          })),
        }
      : {}),
    note,
  }
}

export class ShortAnswerGrader {
  constructor(private readonly ai: AIService) {}

  async grade(
    question: Question,
    answer: string,
    subject?: SubjectInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<QuestionEvaluation> {
    if (!question.rubric?.length) {
      return unverifiedShortAnswer(question, answer, t('shortAnswer.noRubric'))
    }
    if (contentLength(answer) < MIN_SHORT_ANSWER_CHARS) return tooShortEvaluation(question, answer)

    const language = getUILanguage() === 'zh-CN' ? 'zh' : 'en'
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.shortAnswerCheck.buildSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.shortAnswerCheck.buildUserPrompt({
          question: question.prompt,
          points: question.rubric,
          referenceAnswer: question.correctAnswer,
          studentAnswer: answer,
          language,
        }),
      },
    ]
    try {
      // Point-by-point coverage, verified locally: the 轻量模型 when one is set.
      const { data } = await withLightModel(this.ai).chatJSON<ShortAnswerCheckOutput>(
        messages,
        options.signal ? { signal: options.signal } : undefined,
      )
      if (!data || typeof data !== 'object') {
        return unverifiedShortAnswer(question, answer, t('shortAnswer.checkFailed'))
      }
      if (data.status === 'insufficient') {
        const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : ''
        return unverifiedShortAnswer(
          question,
          answer,
          reason ? t('shortAnswer.insufficient', { reason }) : t('shortAnswer.checkFailed'),
        )
      }
      return buildRubricEvaluation(question, answer, data)
    } catch (err) {
      // Stopped by the student: no verdict at all, the caller cancels the submission.
      if (isAbortError(err, options.signal)) throw err
      logger.warn('Short answer check failed; answer kept unverified', {
        questionId: question.id,
        error: (err as Error)?.message,
      })
      // Say why (key, quota, network…), so the student knows what to fix.
      return unverifiedShortAnswer(
        question,
        answer,
        `${t('shortAnswer.checkFailed')} ${friendlyAIError(err)}`,
      )
    }
  }
}
