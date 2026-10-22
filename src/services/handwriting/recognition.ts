import type { AIService } from '@/services/aiService'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { isAbortError } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { StoredStrokePage } from '@/entities/handwriting/strokes'
import {
  recognizerOrder,
  typedOnlyReason,
  type RecognizerAvailability,
} from '@/entities/handwriting/selection'
import type {
  HandwritingRecognitionMode,
  RecognizerId,
  TranscriptRegion,
} from '@/entities/handwriting/types'
import { bytesToDataUrl, isVisionUnsupportedError } from '@/services/answerImagesAI'

/**
 * 手写识别 behind one interface, so recognisers can be swapped or added
 * without touching the exam flow:
 *
 * - `vision-llm`  — the student's configured AI model reads the images
 *                   (`handwriting-transcribe/v1`); online only.
 * - `local-model` — an on-device recogniser. None ships: no model we found is
 *                   both licensed for commercial use and accurate enough on
 *                   handwritten maths (docs/handwriting-recognition.md). The
 *                   engine slot (`LocalHandwritingEngine`) is where one plugs in.
 * - `typed`       — the student types the transcript. Always available, so
 *                   grading never depends on a recogniser.
 *
 * Every result is a draft: the student confirms or edits it next to the
 * original handwriting before anything is graded.
 */

export interface RecognitionImage {
  mimeType: string
  bytes: ArrayBuffer
  /** Pen strokes of a tablet page, when the image was written in the app. */
  strokes?: StoredStrokePage
}

export interface RecognitionInput {
  images: readonly RecognitionImage[]
  /** The question text: context for notation only. */
  question?: string
  language: 'zh' | 'en'
}

export interface RecognitionResult {
  provider: RecognizerId
  text: string
  regions: TranscriptRegion[]
  /** Nothing legible was written. */
  blank: boolean
  model?: string
}

export interface HandwritingRecognizer {
  readonly id: RecognizerId
  /** Whether it can run now (configured, online, model loaded…). */
  available(): Promise<boolean> | boolean
  recognize(input: RecognitionInput, options?: { signal?: AbortSignal }): Promise<RecognitionResult>
}

/** Error codes a recogniser throws that mean "try the next one". */
const FALLBACK_CODES = new Set(['VISION_UNSUPPORTED', 'HANDWRITING_UNAVAILABLE'])

/** The configured AI reads the images (online). */
export class VisionLlmRecognizer implements HandwritingRecognizer {
  readonly id = 'vision-llm' as const

  constructor(
    private ai: AIService | null,
    private deps: { model?: string; isOnline?: () => boolean } = {},
  ) {}

  available(): boolean {
    const online = this.deps.isOnline
      ? this.deps.isOnline()
      : typeof navigator === 'undefined' || navigator.onLine !== false
    return !!this.ai && online
  }

  async recognize(
    input: RecognitionInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<RecognitionResult> {
    if (!this.ai) throw new AppError(t('handwritingRecognition.noAI'), 'HANDWRITING_UNAVAILABLE')
    if (input.images.length === 0) return { provider: this.id, text: '', regions: [], blank: true }
    const messages = [
      { role: 'system' as const, content: prompts.handwritingTranscribe.buildSystemPrompt() },
      {
        role: 'user' as const,
        content: prompts.handwritingTranscribe.buildUserPrompt({
          ...(input.question ? { question: input.question } : {}),
          imageCount: input.images.length,
          language: input.language,
        }),
        images: input.images.map((image) => bytesToDataUrl(image.bytes, image.mimeType)),
      },
    ]
    let data: unknown
    try {
      const reply = await this.ai.chatJSON<unknown>(messages, {
        ...(options.signal ? { signal: options.signal } : {}),
        usageKind: 'grading',
      })
      data = reply.data
    } catch (err) {
      if (!options.signal?.aborted && isVisionUnsupportedError(err))
        throw new AppError(t('handwritingRecognition.visionUnsupported'), 'VISION_UNSUPPORTED', err)
      throw err
    }
    const read = prompts.handwritingTranscribe.readTranscription(data)
    if (!read) throw new AppError(t('handwritingRecognition.invalid'), 'INVALID_RESPONSE')
    return {
      provider: this.id,
      text: read.text,
      regions: read.regions,
      blank: read.blank,
      ...(this.deps.model ? { model: this.deps.model } : {}),
    }
  }
}

/**
 * An on-device handwriting model (e.g. an ONNX model run with
 * onnxruntime-web, downloaded on demand from a pinned URL and cached). Only
 * models whose code, weights and training data allow commercial use may be
 * plugged in here.
 */
export interface LocalHandwritingEngine {
  /** Display name with licence, for the settings page. */
  readonly name: string
  /** Download size in bytes, disclosed before the first download. */
  readonly downloadBytes: number
  isReady(): Promise<boolean>
  recognize(
    images: readonly RecognitionImage[],
    options?: { signal?: AbortSignal },
  ): Promise<{ regions: TranscriptRegion[] }>
}

/** On-device recognition through a `LocalHandwritingEngine`, when one is installed. */
export class LocalModelRecognizer implements HandwritingRecognizer {
  readonly id = 'local-model' as const

  constructor(private engine: LocalHandwritingEngine | null = null) {}

  async available(): Promise<boolean> {
    if (!this.engine) return false
    try {
      return await this.engine.isReady()
    } catch {
      return false
    }
  }

  async recognize(
    input: RecognitionInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<RecognitionResult> {
    if (!this.engine)
      throw new AppError(t('handwritingRecognition.localUnavailable'), 'HANDWRITING_UNAVAILABLE')
    const { regions } = await this.engine.recognize(input.images, options)
    const kept = regions.filter((region) => region.text.trim())
    return {
      provider: this.id,
      text: kept.map((region) => region.text.trim()).join('\n'),
      regions: kept,
      blank: kept.length === 0,
    }
  }
}

/** The student types the transcript (always available). */
export class TypedRecognizer implements HandwritingRecognizer {
  readonly id = 'typed' as const
  available(): boolean {
    return true
  }
  async recognize(): Promise<RecognitionResult> {
    return { provider: this.id, text: '', regions: [], blank: false }
  }
}

export interface RecognitionOutcome {
  result: RecognitionResult
  /** Recognisers that were tried and could not read the images, with why. */
  skipped: Array<{ id: RecognizerId; note: string }>
  /** Set when only typing is left: why (shown next to the empty transcript). */
  typedReason?: 'local-unavailable' | 'online-unavailable' | 'none-available' | 'all-failed'
}

export class HandwritingRecognitionService {
  private recognizers: Record<RecognizerId, HandwritingRecognizer>

  constructor(deps: {
    vision?: HandwritingRecognizer
    local?: HandwritingRecognizer
    typed?: HandwritingRecognizer
  }) {
    this.recognizers = {
      'vision-llm': deps.vision ?? new VisionLlmRecognizer(null),
      'local-model': deps.local ?? new LocalModelRecognizer(null),
      typed: deps.typed ?? new TypedRecognizer(),
    }
  }

  async availability(): Promise<RecognizerAvailability> {
    const [online, local] = await Promise.all([
      this.recognizers['vision-llm'].available(),
      this.recognizers['local-model'].available(),
    ])
    return { online: !!online, local: !!local }
  }

  /**
   * Recognise with the first recogniser the mode allows that works. A model
   * that cannot read images, or a missing engine, moves on to the next; a
   * stop (abort) is passed through; any other error is reported — the
   * student can retry or type. Never throws for "nothing could read it":
   * that ends in `typed` with a reason.
   */
  async recognize(
    input: RecognitionInput,
    mode: HandwritingRecognitionMode,
    options: { signal?: AbortSignal } = {},
  ): Promise<RecognitionOutcome> {
    const availability = await this.availability()
    const order = recognizerOrder(mode, availability)
    const skipped: RecognitionOutcome['skipped'] = []
    for (const id of order) {
      if (id === 'typed') break
      try {
        const result = await this.recognizers[id].recognize(input, options)
        return { result, skipped }
      } catch (err) {
        if (isAbortError(err, options.signal)) throw err
        const code = (err as { code?: unknown })?.code
        if (typeof code === 'string' && FALLBACK_CODES.has(code)) {
          skipped.push({ id, note: friendlyAIError(err) })
          continue
        }
        logger.warn('Handwriting recognition failed', { recognizer: id, code })
        throw err
      }
    }
    return {
      result: await this.recognizers.typed.recognize(input, options),
      skipped,
      typedReason: skipped.length > 0 ? 'all-failed' : typedOnlyReason(mode, availability),
    }
  }
}
