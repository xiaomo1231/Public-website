import type { StoredStrokePage } from '@/entities/handwriting/strokes'
import type { CropRect } from '@/entities/handwriting/crop'

/**
 * Images the learner attaches to a homework answer: photos of handwritten
 * working, or pages drawn on the in-app pen board. Stored in IndexedDB
 * (`homeworkAnswerImages`, Dexie v19) next to the question's draft.
 */
export interface HomeworkAnswerImage {
  id: string
  projectId: string
  setId: string
  questionId: string
  mimeType: AnswerImageMimeType
  bytes: ArrayBuffer
  /** 0-based position within the question's answer images. */
  order: number
  /** Where the image came from. */
  source: 'upload' | 'pen'
  width?: number
  height?: number
  createdAt: number
  /**
   * Written in a mock exam attempt (`MockExamAttempt.id`). Such images belong
   * to that attempt only: they are not part of the question's homework
   * answer (`AnswerImageRepository.list`) and are graded only through a
   * confirmed transcript. Absent on homework images.
   */
  examAttemptId?: string
  /** Tablet writing area: page index within the question's area (pen pages only). */
  writingPage?: number
  /** Tablet writing area: the ink of this page, kept for re-editing and stroke recognition. */
  strokes?: StoredStrokePage
  /** Paper photo: the region of the uploaded page this image was cut from. */
  crop?: CropRect & { page: number }
}

/** Optional fields set when an image is added (exam attempt, strokes, crop). */
export type AnswerImageExtras = Pick<
  HomeworkAnswerImage,
  'examAttemptId' | 'writingPage' | 'strokes' | 'crop'
>

export const ANSWER_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AnswerImageMimeType = (typeof ANSWER_IMAGE_MIME_TYPES)[number]

/** Longest edge kept after downscaling. */
export const MAX_ANSWER_IMAGE_EDGE = 2000
/** Largest stored image after downscaling. */
export const MAX_ANSWER_IMAGE_BYTES = 8 * 1024 * 1024
/** Images per question. */
export const MAX_ANSWER_IMAGES_PER_QUESTION = 12

export function isAnswerImageMimeType(value: string): value is AnswerImageMimeType {
  return (ANSWER_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

/** Size that fits within `maxEdge` on the longest side, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_ANSWER_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest <= 0) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Identity of a question's current images, in order. Part of the answer-check
 * input: adding, removing or reordering an image makes a stored check stale.
 * Empty when there are no images, so text-only checks keep their old hash.
 */
export function answerImageKey(images: ReadonlyArray<Pick<HomeworkAnswerImage, 'id'>>): string {
  return images.map((image) => image.id).join(',')
}

/** `ids` with `id` moved by `delta` places (clamped); unchanged when not found. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return [...ids]
  const to = Math.min(ids.length - 1, Math.max(0, from + delta))
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
