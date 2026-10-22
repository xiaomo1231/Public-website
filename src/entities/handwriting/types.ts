/**
 * Handwriting recognition: transcripts of a student's handwritten answer
 * (photos of paper, or ink written on the tablet) and the rules that keep a
 * recognition error from ever becoming a marking error.
 *
 * - Recognition only transcribes. It never corrects the working.
 * - Parts the recogniser could not read are marked `[?]`, or `[?:best guess]`
 *   when it has a guess.
 * - Before grading, the student sees the transcript next to the original
 *   handwriting and confirms or edits it. Only the confirmed text is graded.
 *   A transcript that still contains `[?]` marks cannot be confirmed.
 * - A transcript belongs to one set of images (`imageKey`). Adding, removing
 *   or reordering images makes it stale, and it has to be recognised and
 *   confirmed again.
 */

/** 识别方式 in the settings. `auto` = online when available, else on-device. */
export type HandwritingRecognitionMode = 'auto' | 'local' | 'online'
export const HANDWRITING_RECOGNITION_MODES: readonly HandwritingRecognitionMode[] = [
  'auto',
  'local',
  'online',
]
export const DEFAULT_HANDWRITING_RECOGNITION_MODE: HandwritingRecognitionMode = 'auto'

/**
 * Who produced a transcript:
 * - `vision-llm`: the student's own configured AI model (online, reads images);
 * - `local-model`: an on-device recogniser (none ships yet, see
 *   docs/handwriting-recognition.md);
 * - `typed`: the student typed the transcript.
 */
export type RecognizerId = 'vision-llm' | 'local-model' | 'typed'

/** One recognised region (a line or a formula), in reading order. */
export interface TranscriptRegion {
  text: string
  /** 0–1 as reported by the recogniser; absent when it gives none. */
  confidence?: number
}

/** Transcript of one question's handwritten answer within a mock exam attempt. */
export interface AnswerTranscript {
  questionId: string
  /** `answerImageKey` of the images this transcript was made from. */
  imageKey: string
  /**
   * `recognized`  — a recogniser produced text (may contain `[?]` marks);
   * `failed`      — recognition failed (the student can retry or type);
   * `unavailable` — no recogniser could run (offline, model cannot read
   *                 images); the student types the transcript.
   */
  status: 'recognized' | 'failed' | 'unavailable'
  /** The recogniser's text, verbatim (kept for comparison after editing). */
  recognizedText?: string
  regions?: TranscriptRegion[]
  provider?: RecognizerId
  /** The model that read the images (vision-llm only). */
  model?: string
  /** Short, actionable reason when failed / unavailable. */
  note?: string
  recognizedAt?: number
  /** Text the student confirmed. The only handwriting text that is graded. */
  confirmedText?: string
  confirmedAt?: number
  /** The student changed the recogniser's text before confirming. */
  edited?: boolean
}

/** A `[?]` or `[?:guess]` mark in a transcript. */
export interface UnclearMark {
  start: number
  end: number
  /** The recogniser's best guess, when it gave one. */
  guess?: string
}

const UNCLEAR = /\[\?(?::([^\]\n]{0,80}))?\]/g

export function findUnclearMarks(text: string): UnclearMark[] {
  const out: UnclearMark[] = []
  for (const match of text.matchAll(UNCLEAR)) {
    const start = match.index ?? 0
    const guess = match[1]?.trim()
    out.push({ start, end: start + match[0].length, ...(guess ? { guess } : {}) })
  }
  return out
}

export function hasUnclearMarks(text: string): boolean {
  return findUnclearMarks(text).length > 0
}

/** Replace every `[?:guess]` with its guess (the student accepts the guesses). */
export function acceptGuesses(text: string): string {
  return text.replace(UNCLEAR, (whole, guess: string | undefined) =>
    guess?.trim() ? guess.trim() : whole,
  )
}

/** Whether a transcript was confirmed for exactly these images. */
export function isTranscriptConfirmed(
  transcript: AnswerTranscript | undefined,
  imageKey: string,
): boolean {
  return (
    !!transcript &&
    transcript.imageKey === imageKey &&
    transcript.confirmedAt !== undefined &&
    typeof transcript.confirmedText === 'string'
  )
}

/** Whether a usable recognition (or an explicit "type it") exists for these images. */
export function isTranscriptCurrent(
  transcript: AnswerTranscript | undefined,
  imageKey: string,
): boolean {
  return !!transcript && transcript.imageKey === imageKey && transcript.status !== 'failed'
}

export class TranscriptNotConfirmedError extends Error {
  readonly code = 'TRANSCRIPT_UNCONFIRMED'
  constructor(readonly questionIds: string[]) {
    super(`Handwriting transcript not confirmed for ${questionIds.length} question(s)`)
    this.name = 'TranscriptNotConfirmedError'
  }
}

/**
 * The text that is graded for one question: what the student typed plus the
 * confirmed transcript of their handwriting. Throws when there is
 * handwriting without a confirmed transcript — grading never reads images.
 */
export function gradedAnswerText(input: {
  questionId: string
  typed?: string
  imageKey: string
  transcript?: AnswerTranscript
}): string {
  const typed = (input.typed ?? '').trim()
  if (!input.imageKey) return typed
  if (!isTranscriptConfirmed(input.transcript, input.imageKey))
    throw new TranscriptNotConfirmedError([input.questionId])
  const written = (input.transcript!.confirmedText ?? '').trim()
  return [typed, written].filter(Boolean).join('\n\n')
}

/** Validate a transcript the student is about to confirm. */
export function confirmableText(text: string): { ok: true } | { ok: false; reason: 'unclear' } {
  return hasUnclearMarks(text) ? { ok: false, reason: 'unclear' } : { ok: true }
}
