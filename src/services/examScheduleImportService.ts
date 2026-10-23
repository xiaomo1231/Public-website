import { prompts } from '@/infrastructure/ai/prompts'
import type { ExamScheduleExtractOutput } from '@/infrastructure/ai/prompts/exam-schedule-extract/v1'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { prepareAnswerImage } from '@/infrastructure/files/imageDownscale'
import { dayKey } from '@/entities/studyPlan/calendar'
import {
  checkExtractedExams,
  parseExamPaste,
  type PasteCourse,
  type PastedExam,
} from '@/entities/studyPlan/examPaste'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { isAbortError } from '@/shared/lib/generationControl'
import { t } from '@/i18n'
import { withLightModel, type AIService } from './aiService'
import { bytesToDataUrl, isVisionUnsupportedError } from './answerImagesAI'

/**
 * 粘贴识别: exams from pasted text or a screenshot, as drafts the student
 * edits before saving (this service never writes anything).
 *
 * Text: the local parser first (`parseExamPaste`). Only when it finds
 * nothing or is unsure does the AI read the text (`exam-schedule-extract/v1`,
 * the light model when one is set); each exam it returns must quote its
 * source text verbatim from the paste (`checkExtractedExams`). An AI failure
 * falls back to what the parser found, with the reason.
 *
 * Images: the configured (vision) model reads them with the same prompt; a
 * model that cannot see images gets an actionable message.
 */

export type ScheduleAIPort = Pick<AIService, 'chatJSON'> & Partial<Pick<AIService, 'light'>>

export interface ScheduleReadOptions {
  now?: number
  courses?: readonly PasteCourse[]
  defaultProjectId?: string
  signal?: AbortSignal
}

export interface ScheduleReadResult {
  exams: PastedExam[]
  /** Who read them: the local parser alone, or the AI. */
  via: 'local' | 'ai'
  /** AI exams dropped because their source text could not be found. */
  dropped: number
  /** The AI was asked and failed: why (the parser's results are shown). */
  aiError?: string
  /** The parser was unsure and no AI is configured. */
  needsAI?: boolean
}

/** Most images read in one go. */
export const MAX_SCHEDULE_IMAGES = 4
/** Pasted text beyond this is not sent to the AI (a schedule is short). */
export const MAX_SCHEDULE_TEXT = 20_000

export class ExamScheduleImportService {
  constructor(private ai: ScheduleAIPort | null) {}

  get hasAI(): boolean {
    return !!this.ai
  }

  async readText(text: string, options: ScheduleReadOptions = {}): Promise<ScheduleReadResult> {
    const now = options.now ?? Date.now()
    const local = parseExamPaste(text, {
      now,
      ...(options.courses ? { courses: options.courses } : {}),
      ...(options.defaultProjectId ? { defaultProjectId: options.defaultProjectId } : {}),
    })
    if (local.confident) return { exams: local.exams, via: 'local', dropped: 0 }
    if (!this.ai) return { exams: local.exams, via: 'local', dropped: 0, needsAI: true }
    try {
      const { exams, dropped } = await this.ask(
        { text: text.slice(0, MAX_SCHEDULE_TEXT) },
        { ...options, now },
      )
      // The AI found nothing it could back up: keep what the parser read.
      if (exams.length === 0 && local.exams.length > 0)
        return { exams: local.exams, via: 'local', dropped }
      return { exams, via: 'ai', dropped }
    } catch (err) {
      if (isAbortError(err, options.signal)) throw err
      logger.warn('Exam schedule: AI reading failed', { error: String(err) })
      return { exams: local.exams, via: 'local', dropped: 0, aiError: friendlyAIError(err) }
    }
  }

  async readImages(
    images: readonly Blob[],
    options: ScheduleReadOptions = {},
  ): Promise<ScheduleReadResult> {
    if (!this.ai) throw new AppError(t('errors.aiKeyRequired'), 'MISSING_API_KEY')
    if (images.length === 0) return { exams: [], via: 'ai', dropped: 0 }
    const urls: string[] = []
    for (const image of images.slice(0, MAX_SCHEDULE_IMAGES)) {
      try {
        const prepared = await prepareAnswerImage(image)
        urls.push(bytesToDataUrl(prepared.bytes, prepared.mimeType))
      } catch {
        throw new AppError(t('plan.paste.imageUnreadable'), 'VALIDATION_ERROR')
      }
    }
    try {
      const { exams, dropped } = await this.ask({ images: urls }, options, false)
      return { exams, via: 'ai', dropped }
    } catch (err) {
      if (isVisionUnsupportedError(err) && !isAbortError(err, options.signal))
        throw new AppError(t('plan.paste.visionUnsupported'), 'VISION_UNSUPPORTED', err)
      throw err
    }
  }

  private async ask(
    input: { text?: string; images?: string[] },
    options: ScheduleReadOptions,
    light = true,
  ): Promise<{ exams: PastedExam[]; dropped: number }> {
    const now = options.now ?? Date.now()
    // Reading a schedule is a simple task: the light model when one is set.
    // Images need the main (vision) model.
    const ai = light ? withLightModel(this.ai as AIService) : (this.ai as AIService)
    const courses = options.courses ?? []
    const { data } = await ai.chatJSON<ExamScheduleExtractOutput>(
      [
        { role: 'system', content: prompts.examScheduleExtract.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.examScheduleExtract.buildUserPrompt({
            today: dayKey(now),
            courses: courses.map((course) => course.name),
            ...(input.text ? { text: input.text } : {}),
            ...(input.images?.length ? { hasImages: true } : {}),
          }),
          ...(input.images?.length ? { images: input.images } : {}),
        },
      ],
      {
        ...(options.signal ? { signal: options.signal } : {}),
        usageKind: 'other',
        ...(light ? { reasoning: 'low' as const } : {}),
      },
    )
    return checkExtractedExams(data, {
      now,
      courses,
      ...(options.defaultProjectId ? { defaultProjectId: options.defaultProjectId } : {}),
      ...(input.text ? { text: input.text } : {}),
    })
  }
}
