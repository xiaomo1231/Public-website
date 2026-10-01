import type { SourceReference } from '@/entities/courseAnalysis/types'
import { fnv1a } from '@/shared/lib/hash'
import type { HomeworkQuestion } from './types'

export interface HomeworkReviewGuide {
  questionMeaning: string
  knowledgePoints: string[]
  method: string
  steps: string[]
  explanation: string
  interpretation: string
  check: string
  language: 'zh' | 'en'
  promptVersion: string
  inputHash: string
  /** Provenance captured when the AI content was generated. */
  questionSourceRefs: SourceReference[]
  answerChunkIds: string[]
  createdAt: number
}

/** Hash only inputs that can change the meaning or grounding of a review. */
export function homeworkReviewInputHash(
  question: HomeworkQuestion,
  language: 'zh' | 'en',
  promptVersion: string,
): string {
  return fnv1a(JSON.stringify({
    promptVersion,
    language,
    prompt: question.prompt,
    contentFingerprint: question.contentFingerprint,
    sourceRefs: question.sourceRefs,
    answerStatus: question.answerStatus,
    answerText: question.answerStatus === 'matched' ? question.answerText : undefined,
    answerChunkIds: question.answerStatus === 'matched' ? question.answerChunkIds : undefined,
    answerBased: question.answerBased,
    solution: question.solution,
  }))
}

export function currentHomeworkReview(
  question: HomeworkQuestion,
  language: 'zh' | 'en',
  promptVersion: string,
): HomeworkReviewGuide | null {
  const guide = question.reviewGuide
  return guide && guide.language === language && guide.promptVersion === promptVersion &&
    guide.inputHash === homeworkReviewInputHash(question, language, promptVersion)
    ? guide : null
}
