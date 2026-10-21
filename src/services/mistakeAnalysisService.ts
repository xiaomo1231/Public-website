import type { AIService } from './aiService'
import type { MistakeService } from './mistakeService'
import type { ChunkRepository } from '@/entities/chunk/repository'
import type { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { prompts } from '@/infrastructure/ai/prompts'
import type { MistakeAnalyzerOutput } from '@/infrastructure/ai/prompts/mistake-analyzer/v2'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { Mistake, MistakeAnalysis, MistakeType } from '@/entities/mistake/types'
import { MISTAKE_TYPES } from '@/entities/mistake/types'
import { collectSourceSnippets } from './sourceContext'
import { isAbortError } from '@/shared/lib/generationControl'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'
import { loadProjectSubjectContext } from './projectSubject'
import { UserRepository } from '@/entities/user/repository'
import { resolveContentLanguage } from '@/entities/user/types'

/** Resolved lazily so it follows the current UI language. */
const fallbackCause = (): string => t('mistakeAnalysis.fallbackCause')

/** Language used when the project has no detected language. */
const DEFAULT_LANGUAGE: AnalysisLanguage = 'en'

/** The student's question-language preference applied to the material's language. */
async function contentLanguage(material: AnalysisLanguage): Promise<AnalysisLanguage> {
  const profile = await new UserRepository().get().catch(() => undefined)
  return resolveContentLanguage(profile?.questionLanguage, material)
}

export type AnalysisLanguage = 'zh' | 'en' | 'mixed'

export interface AnalysisOptions {
  signal?: AbortSignal
  /**
   * Overrides the project's detected language. When omitted, the language of
   * the project's course analysis is used — the same signal the AI tutor
   * follows.
   */
  language?: AnalysisLanguage
}

export class MistakeAnalysisService {
  private ai: AIService
  private mistakes: MistakeService
  private chunks?: ChunkRepository
  private analyses?: CourseAnalysisRepository

  constructor(deps: {
    ai: AIService
    mistakes: MistakeService
    chunks?: ChunkRepository
    analyses?: CourseAnalysisRepository
  }) {
    this.ai = deps.ai
    this.mistakes = deps.mistakes
    this.chunks = deps.chunks
    this.analyses = deps.analyses
  }

  /** Analyse a stored mistake and persist the result. */
  async analyze(mistakeId: string, opts: AnalysisOptions = {}): Promise<Mistake> {
    const mistake = await this.mistakes.get(mistakeId)
    if (!mistake) throw new AppError(t('errors.mistakeNotFound'), 'NOT_FOUND')
    await this.mistakes.markAnalysisRunning(mistakeId)
    try {
      const analysis = await this.runAnalysis(mistake, opts)
      opts.signal?.throwIfAborted()
      return this.mistakes.saveAnalysis(mistakeId, analysis)
    } catch (err) {
      if (isAbortError(err, opts.signal)) {
        // Stopped: the mistake goes back to exactly how it was.
        await this.mistakes.restoreAnalysisState(mistakeId, mistake)
        throw err
      }
      const message = err instanceof Error ? err.message : t('errors.analysisFailed')
      await this.mistakes.markAnalysisFailed(mistakeId, message)
      throw err
    }
  }

  /**
   * Produce an analysis without persisting it. Used by the "Explain my
   * mistake" flow, which reveals fields one step at a time.
   */
  async explain(mistake: Mistake, opts: AnalysisOptions = {}): Promise<MistakeAnalysis> {
    return this.runAnalysis(mistake, opts)
  }

  /** Resolve the language for a project's mistake analysis. */
  async resolveLanguage(projectId: string, override?: AnalysisLanguage): Promise<AnalysisLanguage> {
    if (override) return override
    if (!this.analyses) return DEFAULT_LANGUAGE
    const analysis = await this.analyses.getByProject(projectId)
    return contentLanguage(analysis?.language ?? DEFAULT_LANGUAGE)
  }

  private async runAnalysis(mistake: Mistake, opts: AnalysisOptions): Promise<MistakeAnalysis> {
    const analysis = this.analyses ? await this.analyses.getByProject(mistake.projectId) : undefined
    const language: AnalysisLanguage =
      opts.language ?? (await contentLanguage(analysis?.language ?? DEFAULT_LANGUAGE))

    const sources =
      this.chunks && analysis
        ? await collectSourceSnippets({
            documentIds: analysis.documentIds,
            chunks: this.chunks,
            preferKeyword: mistake.knowledgePoint,
            limit: 4,
          })
        : []

    const recent = await this.mistakes.recentForKnowledgePoint(
      mistake.projectId,
      mistake.knowledgePoint,
      5,
    )
    const recentMistakes = recent
      .filter((m) => m.id !== mistake.id)
      .map(
        (m) =>
          `Q: ${m.question.slice(0, 120)} | answered: ${m.studentAnswer.slice(0, 60)} | expected: ${m.correctAnswer.slice(0, 60)}`,
      )

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.mistakeAnalyzer.buildSystemPrompt(),
          await loadProjectSubjectContext(mistake.projectId),
        ),
      },
      {
        role: 'user',
        content: prompts.mistakeAnalyzer.buildUserPrompt({
          question: mistake.question,
          studentAnswer: mistake.studentAnswer,
          correctAnswer: mistake.correctAnswer,
          ...(mistake.solution ? { solution: mistake.solution } : {}),
          knowledgePoint: mistake.knowledgePoint,
          difficulty: mistake.difficulty,
          language,
          ...(sources.length ? { sourceSnippets: sources } : {}),
          ...(recentMistakes.length ? { recentMistakes } : {}),
        }),
      },
    ]

    const { data } = await this.ai.chatJSON<MistakeAnalyzerOutput>(messages, {
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    return normalizeAnalysis(data)
  }
}

/**
 * Defensive normalisation of AI output. Unknown mistake types collapse to
 * `unknown`; missing fields get safe, neutral defaults so the UI never
 * renders a blank or a judgemental string.
 */
export function normalizeAnalysis(
  raw: Partial<MistakeAnalyzerOutput> | null | undefined,
): MistakeAnalysis {
  const type = (raw?.mistakeType ?? 'unknown') as MistakeType
  const safeType: MistakeType = MISTAKE_TYPES.includes(type) ? type : 'unknown'
  const cause =
    typeof raw?.possibleCause === 'string' && raw.possibleCause.trim()
      ? raw.possibleCause.trim()
      : fallbackCause()

  return {
    whereWrong: str(raw?.whereWrong, t('mistakeAnalysis.fallbackWhereWrong')),
    firstError: str(raw?.firstError, t('mistakeAnalysis.fallbackFirstError')),
    whyWrong: str(raw?.whyWrong, t('mistakeAnalysis.fallbackWhyWrong')),
    correctApproach: str(raw?.correctApproach, t('mistakeAnalysis.fallbackCorrectApproach')),
    // The cause is the field most prone to blame: any judgemental wording
    // replaces it outright rather than being patched sentence by sentence.
    possibleCause: JUDGEMENTAL.test(cause) ? t('mistakeAnalysis.neutralCause') : cause,
    mistakeType: safeType,
    reviewKnowledgePoints: Array.isArray(raw?.reviewKnowledgePoints)
      ? raw!.reviewKnowledgePoints.filter(
          (k): k is string => typeof k === 'string' && k.trim().length > 0 && !JUDGEMENTAL.test(k),
        )
      : [],
    shouldPracticeMore: Boolean(raw?.shouldPracticeMore),
    ...(raw?.similarExample &&
    typeof raw.similarExample.prompt === 'string' &&
    raw.similarExample.prompt.trim()
      ? {
          similarExample: {
            prompt: raw.similarExample.prompt,
            answer: typeof raw.similarExample.answer === 'string' ? raw.similarExample.answer : '',
            ...(typeof raw.similarExample.explanation === 'string'
              ? { explanation: soften(raw.similarExample.explanation) }
              : {}),
          },
        }
      : {}),
    continuePrompt: str(raw?.continuePrompt, t('mistakeAnalysis.fallbackContinuePrompt')),
    analyzedAt: Date.now(),
    promptVersion: prompts.mistakeAnalyzer.VERSION,
  }
}

/** Wording that blames the student (never "careless"), English and Chinese. */
const JUDGEMENTAL =
  /careless\w*|lazy(?!\s*(?:evaluation|loading|initiali[sz]ation|propagation|deletion))|laziness|sloppy|stupid|inattentive|粗心|马虎|不认真|不仔细|懒(?!加载|惰求值|求值|汉式)/i

/**
 * Replace every sentence that blames the student with one neutral, localized
 * sentence, so no judgemental word survives in any field.
 */
export function soften(text: string): string {
  if (!JUDGEMENTAL.test(text)) return text
  // A period ends a sentence only before a space or the end ("3.14" stays whole).
  const sentences = text.match(/[\s\S]+?(?:[。！？!?]+|\.+(?=\s|$)|$)/g) ?? [text]
  const out: string[] = []
  let replaced = false
  for (const sentence of sentences) {
    if (!JUDGEMENTAL.test(sentence)) {
      out.push(sentence)
    } else if (!replaced) {
      replaced = true
      const lead = sentence.match(/^\s*/)?.[0] ?? ''
      out.push(`${lead}${t('mistakeAnalysis.neutralSentence')}`)
    }
  }
  return out.join('').trim()
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? soften(value.trim()) : fallback
}
