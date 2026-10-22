import {
  isTranscriptConfirmed,
  isTranscriptCurrent,
  type AnswerTranscript,
} from '@/entities/handwriting/types'
import type { ExamAnswerMode, MockExamAttempt } from './types'

/**
 * Where a mock exam attempt is, given which questions carry handwriting.
 * `imageKeys` maps question id → `answerImageKey` of the images written in
 * this attempt ('' or absent = none).
 *
 *   writing    → the timer runs; no recognition, no AI of any kind
 *   upload     → 纸上作答 only: photograph the pages, assign regions
 *   transcribe → recognise, then the student confirms every transcript
 *   check      → grading (only confirmed text is graded)
 *   done       → every question has a result
 */
export type ExamStage = 'writing' | 'upload' | 'transcribe' | 'check' | 'done'

export function attemptMode(attempt: Pick<MockExamAttempt, 'mode'>): ExamAnswerMode {
  return attempt.mode ?? 'online'
}

export function examStage(
  attempt: MockExamAttempt,
  imageKeys: Readonly<Record<string, string>>,
): ExamStage {
  if (!attempt.submittedAt) return 'writing'
  if (attempt.checkedAt) return 'done'
  if (attemptMode(attempt) === 'paper' && !attempt.uploadsDoneAt) return 'upload'
  if (unconfirmedQuestions(imageKeys, attempt.transcripts).length > 0) return 'transcribe'
  return 'check'
}

/** Questions with handwriting whose transcript is missing, failed or stale. */
export function questionsNeedingRecognition(
  imageKeys: Readonly<Record<string, string>>,
  transcripts: Readonly<Record<string, AnswerTranscript>> | undefined,
): string[] {
  return Object.entries(imageKeys)
    .filter(([id, key]) => key && !isTranscriptCurrent(transcripts?.[id], key))
    .map(([id]) => id)
}

/** Questions with handwriting whose transcript the student has not confirmed (for these images). */
export function unconfirmedQuestions(
  imageKeys: Readonly<Record<string, string>>,
  transcripts: Readonly<Record<string, AnswerTranscript>> | undefined,
): string[] {
  return Object.entries(imageKeys)
    .filter(([id, key]) => key && !isTranscriptConfirmed(transcripts?.[id], key))
    .map(([id]) => id)
}

/**
 * Whether handwriting may be added to the attempt now. While writing, every
 * mode may add pages; after submitting, only 纸上作答 may — the photos of the
 * finished paper — and only until the student says the upload is done.
 */
export function canAddExamImages(attempt: MockExamAttempt): boolean {
  if (attempt.checkedAt) return false
  if (!attempt.submittedAt) return true
  return attemptMode(attempt) === 'paper' && !attempt.uploadsDoneAt
}

/**
 * Exam integrity: recognition (an AI request) is allowed only after the paper
 * is handed in — nothing reads the student's handwriting while the timer runs.
 */
export function canRecognize(attempt: MockExamAttempt): boolean {
  return !!attempt.submittedAt && !attempt.checkedAt && examStageAllowsRecognition(attempt)
}

function examStageAllowsRecognition(attempt: MockExamAttempt): boolean {
  return attemptMode(attempt) !== 'paper' || !!attempt.uploadsDoneAt
}
