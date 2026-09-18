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
import { AppError } from '@/infrastructure/errors/AppError'

const FALLBACK_CAUSE = 'A possible cause is worth exploring together — the analysis could not be completed.'

/** Language used when the project has no detected language. */
const DEFAULT_LANGUAGE: AnalysisLanguage = 'en'

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
    if (!mistake) throw new AppError('Mistake not found', 'NOT_FOUND')
    await this.mistakes.markAnalysisRunning(mistakeId)
    try {
      const analysis = await this.runAnalysis(mistake, opts)
      return this.mistakes.saveAnalysis(mistakeId, analysis)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed'
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
    return analysis?.language ?? DEFAULT_LANGUAGE
  }

  private async runAnalysis(mistake: Mistake, opts: AnalysisOptions): Promise<MistakeAnalysis> {
    const analysis = this.analyses ? await this.analyses.getByProject(mistake.projectId) : undefined
    const language: AnalysisLanguage = opts.language ?? analysis?.language ?? DEFAULT_LANGUAGE

    const sources =
      this.chunks && analysis
        ? await collectSourceSnippets({
            documentIds: analysis.documentIds,
            chunks: this.chunks,
            preferKeyword: mistake.knowledgePoint,
            limit: 4,
          })
        : []

    const recent = await this.mistakes.recentForKnowledgePoint(mistake.projectId, mistake.knowledgePoint, 5)
    const recentMistakes = recent
      .filter((m) => m.id !== mistake.id)
      .map((m) => `Q: ${m.question.slice(0, 120)} | answered: ${m.studentAnswer.slice(0, 60)} | expected: ${m.correctAnswer.slice(0, 60)}`)

    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.mistakeAnalyzer.buildSystemPrompt() },
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
export function normalizeAnalysis(raw: Partial<MistakeAnalyzerOutput> | null | undefined): MistakeAnalysis {
  const type = (raw?.mistakeType ?? 'unknown') as MistakeType
  const safeType: MistakeType = MISTAKE_TYPES.includes(type) ? type : 'unknown'
  const cause = typeof raw?.possibleCause === 'string' && raw.possibleCause.trim()
    ? raw.possibleCause.trim()
    : FALLBACK_CAUSE
  const normalizedCause = /careless|lazy|sloppy|stupid/i.test(cause)
    ? `A possible cause is something to explore together. (${cause.replace(/careless|lazy|sloppy|stupid/gi, 'unclear')})`
    : cause

  return {
    whereWrong: str(raw?.whereWrong, 'The first divergence could not be pinpointed from the answer alone.'),
    firstError: str(raw?.firstError, 'The key error could not be isolated automatically.'),
    whyWrong: str(raw?.whyWrong, 'This step does not hold, but the reason needs a closer look.'),
    correctApproach: str(raw?.correctApproach, 'Review the worked solution for the correct path.'),
    possibleCause: normalizedCause,
    mistakeType: safeType,
    reviewKnowledgePoints: Array.isArray(raw?.reviewKnowledgePoints)
      ? raw!.reviewKnowledgePoints.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      : [],
    shouldPracticeMore: Boolean(raw?.shouldPracticeMore),
    ...(raw?.similarExample && typeof raw.similarExample.prompt === 'string' && raw.similarExample.prompt.trim()
      ? {
          similarExample: {
            prompt: raw.similarExample.prompt,
            answer: typeof raw.similarExample.answer === 'string' ? raw.similarExample.answer : '',
            ...(typeof raw.similarExample.explanation === 'string'
              ? { explanation: raw.similarExample.explanation }
              : {}),
          },
        }
      : {}),
    continuePrompt: str(raw?.continuePrompt, 'Would you like to try a similar question?'),
    analyzedAt: Date.now(),
    promptVersion: prompts.mistakeAnalyzer.VERSION,
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}