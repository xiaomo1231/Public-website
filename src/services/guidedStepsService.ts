/**
 * 引导练习 (guided practice): where a question's steps come from, the one
 * small AI request for non-matrix questions, and the student's progress.
 *
 * - Steps always come from the question's stored walkthrough (the detailed
 *   version when there is one). Row reductions are parsed locally
 *   (`buildGuidedChains`) — no AI. Other questions are converted once by
 *   `guided-steps/v1` into steps with blanks; the result is validated
 *   locally (every blank's answer must be in the walkthrough) and cached on
 *   the walkthrough section while its text stays the same.
 * - Progress lives on the question row (`guidedProgress`) and is student work.
 */
import { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AbortedError } from '@/infrastructure/ai/errors'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { Subject } from '@/entities/project/types'
import {
  detailedVariant,
  questionSectionId,
  walkthroughId,
  type WalkthroughLevel,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import { buildGuidedChains, type GuidedChain } from '@/entities/homework/guidedMatrix'
import {
  blankStepsKey,
  chainsKey,
  guidedSourceHash,
  progressFor,
  type GuidedProgress,
  type GuidedStepsCache,
  type GuidedTextStep,
} from '@/entities/homework/guided'
import { allowedBlankKinds, validateGuidedSteps } from '@/entities/homework/guidedSteps'
import { classifyHomeworkError, isRetryableHomeworkError } from '@/entities/homework/errorKind'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import { HomeworkWalkthroughService, notifyWalkthroughChanged } from './homeworkWalkthroughService'
import { loadProjectSubjectContext } from './projectSubject'
import { SettingsService } from './settingsService'
import { t } from '@/i18n'

export const GUIDED_STEPS_PROMPT_VERSION = `guided-steps/${prompts.guidedSteps.VERSION}`
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 700
const MAX_WALKTHROUGH_CHARS = 16_000

export type GuidedSource =
  /** The question has no ready walkthrough section yet. */
  | { kind: 'no-walkthrough' }
  | { kind: 'matrix'; chains: GuidedChain[]; key: string }
  | { kind: 'blanks'; steps: GuidedTextStep[]; key: string; droppedBlanks: number }
  /** Not a row reduction, and not converted into steps yet (needs one AI request). */
  | { kind: 'needs-steps' }

export interface GuidedQuestionState {
  question: HomeworkQuestion
  subject?: Subject
  /** The walkthrough version the steps come from. */
  level: WalkthroughLevel
  source: GuidedSource
  /** Progress for the current steps (fresh when the steps changed). */
  progress: GuidedProgress | null
  hasAI: boolean
}

interface SectionText {
  section: WalkthroughSection
  level: WalkthroughLevel
  conclusion?: string
  body: string
}

/** The walkthrough text of a question: the detailed version first. */
function sectionTexts(section: WalkthroughSection): SectionText[] {
  const detailed = detailedVariant(section)
  const standard: SectionText = {
    section,
    level: 'standard',
    ...(section.conclusion ? { conclusion: section.conclusion } : {}),
    body: section.body,
  }
  return detailed
    ? [
        {
          section,
          level: 'detailed',
          ...(detailed.conclusion ? { conclusion: detailed.conclusion } : {}),
          body: detailed.body,
        },
        standard,
      ]
    : [standard]
}

export class GuidedStepsService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkRepository
  private repo: WalkthroughRepository
  private walkthroughs: HomeworkWalkthroughService

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
    this.repo = new WalkthroughRepository(this.db)
    this.walkthroughs = new HomeworkWalkthroughService({ ai: null, db: this.db })
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  private async locate(setId: string, questionId: string) {
    const state = await this.walkthroughs.state(setId)
    const question = state.questions.find((item) => item.id === questionId)
    if (!question) throw new NotFoundError('HomeworkQuestion', questionId)
    const sectionId = questionSectionId(questionId)
    const section = state.walkthrough?.sections.find((item) => item.id === sectionId)
    const subject = (await loadProjectSubjectContext(state.set.projectId, this.db))?.subject
    return {
      question,
      subject,
      walkthroughKey: walkthroughId(setId, state.language),
      section: section?.status === 'ready' ? section : undefined,
    }
  }

  /** The steps of a question (from its walkthrough) and the saved progress. */
  async load(setId: string, questionId: string): Promise<GuidedQuestionState> {
    const { question, subject, section } = await this.locate(setId, questionId)
    const base = {
      question,
      ...(subject ? { subject } : {}),
      hasAI: this.ai !== null,
    }
    if (!section)
      return { ...base, level: 'standard', source: { kind: 'no-walkthrough' }, progress: null }
    const texts = sectionTexts(section)
    for (const text of texts) {
      const chains = buildGuidedChains(text.body)
      if (chains.length === 0) continue
      const key = chainsKey(chains)
      return {
        ...base,
        level: text.level,
        source: { kind: 'matrix', chains, key },
        progress: progressFor(question.guidedProgress, 'matrix', key, chains.length),
      }
    }
    const preferred = texts[0]!
    const cache = section.guided
    const usable = texts.find(
      (text) =>
        cache &&
        cache.promptVersion === GUIDED_STEPS_PROMPT_VERSION &&
        cache.level === text.level &&
        cache.sourceHash === guidedSourceHash(text),
    )
    if (cache && usable && usable.level === preferred.level && cache.steps.length > 0) {
      const key = blankStepsKey(cache.steps)
      return {
        ...base,
        level: usable.level,
        source: { kind: 'blanks', steps: cache.steps, key, droppedBlanks: cache.droppedBlanks },
        progress: progressFor(question.guidedProgress, 'blanks', key, cache.steps.length),
      }
    }
    return { ...base, level: preferred.level, source: { kind: 'needs-steps' }, progress: null }
  }

  /**
   * Convert the question's walkthrough into steps with blanks (one request),
   * keep what the walkthrough supports and cache it on the section. A stop
   * (`signal`) leaves everything as it was.
   */
  async prepareSteps(
    setId: string,
    questionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<GuidedQuestionState> {
    const ai = this.requireAI()
    const { question, subject, section, walkthroughKey } = await this.locate(setId, questionId)
    if (!section) throw new AppError(t('guided.errors.noWalkthrough'), 'VALIDATION_ERROR')
    const text = sectionTexts(section)[0]!
    const walkthrough = [text.conclusion ?? '', text.body].filter(Boolean).join('\n\n')
    const kinds = allowedBlankKinds(subject)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.guidedSteps.buildSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.guidedSteps.buildUserPrompt({
          question: formatHomeworkQuestion(question.prompt),
          walkthrough: walkthrough.slice(0, MAX_WALKTHROUGH_CHARS),
          kinds,
        }),
      },
    ]
    const raw = await requestJSON(ai, messages, options.signal)
    const { steps, droppedBlanks } = validateGuidedSteps(raw, walkthrough, subject)
    if (steps.length === 0 || steps.every((step) => step.blanks.length === 0))
      throw new AppError(t('guided.errors.noSteps'), 'INVALID_RESPONSE')
    const sourceHash = guidedSourceHash(text)
    const cache: GuidedStepsCache = {
      promptVersion: GUIDED_STEPS_PROMPT_VERSION,
      level: text.level,
      sourceHash,
      steps,
      droppedBlanks,
      generatedAt: Date.now(),
    }
    // Saved only onto the same walkthrough text it was converted from.
    const saved = await this.repo.updateSection(walkthroughKey, section.id, (current) => {
      const now = sectionTexts(current)[0]
      if (current.status !== 'ready' || !now || guidedSourceHash(now) !== sourceHash) return null
      return { ...current, guided: cache }
    })
    if (!saved) throw new AppError(t('guided.errors.changed'), 'CONCURRENT_MODIFICATION')
    notifyWalkthroughChanged()
    return this.load(setId, questionId)
  }

  /** Save the student's progress on the question (their own work). */
  async saveProgress(questionId: string, progress: GuidedProgress): Promise<void> {
    await this.homework.updateQuestion(questionId, {
      guidedProgress: { ...progress, updatedAt: Date.now() },
    })
  }

  /** 重新开始: forget this question's guided progress. */
  async resetProgress(questionId: string): Promise<void> {
    // Patched inside the repository's transaction: only this field changes,
    // so a draft or chat saved meanwhile is never overwritten by a stale row.
    await this.homework.updateQuestion(questionId, { guidedProgress: undefined })
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    return this.ai
  }
}

async function requestJSON(
  ai: AIService,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
): Promise<unknown> {
  for (let retries = 0; ; retries++) {
    if (signal?.aborted) throw new AbortedError()
    try {
      const { data } = await ai.chatJSON<unknown>(messages, {
        ...(signal ? { signal } : {}),
        // Re-shaping an existing explanation into steps: little thinking needed.
        reasoning: 'low',
      })
      return data
    } catch (err) {
      if (signal?.aborted) throw new AbortedError()
      const kind = classifyHomeworkError(err)
      if (!isRetryableHomeworkError(kind) || retries >= MAX_TRANSIENT_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (retries + 1)))
    }
  }
}

/** The guided-practice service with the configured AI (or none: steps then need setup). */
export async function buildGuidedStepsService(): Promise<GuidedStepsService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'walkthrough' })
    : null
  return new GuidedStepsService({ ai, db: getDb() })
}
