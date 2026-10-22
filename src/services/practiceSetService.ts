import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { isPracticeSet, type HomeworkQuestion, type HomeworkSet } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import {
  planPractice,
  summaryKnowledge,
  type SummaryKnowledge,
} from '@/entities/homework/practice/plan'
import { createRng } from '@/entities/homework/practice/random'
import {
  applyLinearHints,
  buildLinearSystem,
  linearSystemPart,
  linearSystemStem,
  type PracticeLanguage,
} from '@/entities/homework/practice/linearSystem'
import { verifyAiPart } from '@/entities/homework/practice/verify'
import type {
  PracticeCandidate,
  PracticeDraft,
  PracticeMode,
  PracticePart,
  PracticeSetInfo,
  PracticeSlot,
} from '@/entities/homework/practice/types'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import { HomeworkWalkthroughService, questionLabel } from './homeworkWalkthroughService'
import { loadProjectSubjectContext } from './projectSubject'
import { loadLinearStyleHints, loadProfessorHabits } from './questionHabitsService'
import type { LinearStyleHints } from '@/entities/questionHabits/types'
import type { SubjectContext } from '@/entities/project/types'

/**
 * 讲解末尾「做练习题」: build a practice set from an assignment and its
 * walkthrough.
 *
 * 1. Plan locally (`planPractice`): 完整版 mirrors every question; 精简版 asks
 *    one question per summary category plus 1–2 integrative ones.
 * 2. Linear systems of linear algebra are built locally with the requested
 *    solution type and exact reference answers (`linearSystem.ts`). Every
 *    other slot is written by the AI (`practice-generate/v1`, a few slots per
 *    request); answers that can be recomputed locally are checked and the
 *    local value is stored, a disagreeing question is dropped.
 * 3. Every question — local or AI — goes through one batched AI review
 *    (`practice-review/v1`: on topic, structure, clarity, difficulty; verdicts
 *    only, answers never change). A failed local question is rebuilt, a
 *    failed AI question rewritten, once; both are reviewed again and dropped
 *    when they fail again. The set says how many were dropped.
 *
 * The unfinished build is stored on the practice set (`practice.draft`), so
 * 暂停 / 立即停止 keep what is done and 继续 continues from there. The result
 * is an ordinary homework set (`kind: 'practice'`, `parentSetId`): 做题,
 * 检查答案, 引导练习 and 完整讲解 all work on it.
 */

const GENERATE_BATCH = 4
const REVIEW_BATCH = 10
const ORIGINAL_CHARS = 2_500
const REVIEW_ORIGINAL_CHARS = 600
const REVIEW_ORIGINALS_TOTAL = 6_000
const KEY_POINT_CHARS = 1_500
export const PRACTICE_PROMPT_VERSION = `practice-generate/${prompts.practiceGenerate.VERSION}`

export type PracticeRunStage = 'writing' | 'reviewing' | 'saving'

export interface PracticeRunProgress {
  stage: PracticeRunStage
  completed: number
  total: number
}

export interface PracticeRunOptions {
  control?: GenerationControl
  onProgress?: (progress: PracticeRunProgress) => void
}

export interface PracticeRunResult {
  set: HomeworkSet
  paused: boolean
  created: number
  dropped: number
}

interface BuildContext {
  parent: HomeworkSet
  questions: HomeworkQuestion[]
  labels: string[]
  sections: Map<string, WalkthroughSection>
  summary?: string
  knowledge: SummaryKnowledge
  subject: SubjectContext | undefined
  language: PracticeLanguage
  /** 教授出题习惯 block for the AI (absent when off or empty). */
  professorHabits?: string
  /** Sizes / numbers / presentation for the local systems ({} without a profile). */
  linearHints: LinearStyleHints
}

/** One build per practice set at a time (this tab). */
const runs = new Map<string, Promise<PracticeRunResult>>()

export class PracticeSetService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  isRunning(setId: string): boolean {
    return runs.has(setId)
  }

  /**
   * A build cut off by a reload or a closed tab stays `analyzing` with no run
   * behind it: turn it into `paused` (its draft is intact, 继续 picks it up),
   * or `failed` when nothing is left to continue. No-op while a run is live.
   */
  async recoverInterrupted(setId: string): Promise<HomeworkSet | undefined> {
    if (runs.has(setId)) return undefined
    const set = await this.homework.getSet(setId)
    if (!set || !isPracticeSet(set) || set.status !== 'analyzing' || runs.has(setId)) return set
    return this.homework.updateSet(
      setId,
      set.practice?.draft
        ? { status: 'paused', progress: undefined }
        : { status: 'failed', progress: undefined, errorMessage: t('practiceSet.interrupted') },
    )
  }

  /** Practice sets made from one assignment, newest first. */
  async listPracticeSets(parentSetId: string): Promise<HomeworkSet[]> {
    const parent = await this.homework.getSet(parentSetId)
    if (!parent) return []
    return (await this.homework.listSets(parent.projectId)).filter(
      (set) => isPracticeSet(set) && set.parentSetId === parentSetId,
    )
  }

  /** How many questions each mode would ask, and how many are built locally. */
  async preview(
    parentSetId: string,
  ): Promise<Record<PracticeMode, { total: number; local: number }>> {
    const context = await this.context(parentSetId)
    const count = (mode: PracticeMode) => {
      const slots = this.plan(context, mode)
      return { total: slots.length, local: slots.filter((slot) => slot.local).length }
    }
    return { full: count('full'), compact: count('compact') }
  }

  /** Build a new practice set from an assignment. */
  async create(
    parentSetId: string,
    mode: PracticeMode,
    options: PracticeRunOptions = {},
  ): Promise<PracticeRunResult> {
    this.requireAI()
    const context = await this.context(parentSetId)
    const slots = this.plan(context, mode)
    if (slots.length === 0) throw new AppError(t('practiceSet.nothingToPlan'), 'VALIDATION_ERROR')
    const now = Date.now()
    const id = crypto.randomUUID()
    const draft: PracticeDraft = {
      stage: 'generating',
      slots,
      candidates: [],
      pendingSlots: [],
      dropped: [],
      nextId: 1,
    }
    for (const slot of slots) {
      const candidate = slot.local
        ? this.buildLocal(id, slot, 0, draft, context.language, context.linearHints)
        : null
      if (candidate) draft.candidates.push(candidate)
      else draft.pendingSlots.push(slot.id)
    }
    const existing = (await this.listPracticeSets(parentSetId)).filter(
      (set) => set.practice?.mode === mode,
    ).length
    const set: HomeworkSet = {
      id,
      projectId: context.parent.projectId,
      documentId: context.parent.documentId,
      documentName: context.parent.documentName,
      title: t(mode === 'full' ? 'practiceSet.titleFull' : 'practiceSet.titleCompact', {
        title: context.parent.title,
        n: existing + 1,
      }),
      status: 'analyzing',
      language: context.parent.language,
      questionCount: 0,
      promptVersion: PRACTICE_PROMPT_VERSION,
      kind: 'practice',
      parentSetId,
      practice: { mode, requested: slots.length, dropped: 0, draft },
      progress: { stage: 'generating', completed: 0, total: slots.length, updatedAt: now },
      createdAt: now,
      updatedAt: now,
    }
    await this.homework.upsertSet(set)
    return this.start(set.id, context, options)
  }

  /** 继续: finish a paused / stopped / failed build from where it stopped. */
  async resume(setId: string, options: PracticeRunOptions = {}): Promise<PracticeRunResult> {
    const running = runs.get(setId)
    if (running) return running
    this.requireAI()
    const set = await this.homework.getSet(setId)
    if (!set || !isPracticeSet(set) || !set.parentSetId)
      throw new NotFoundError('HomeworkSet', setId)
    if (!set.practice?.draft) {
      return { set, paused: false, created: set.questionCount, dropped: set.practice?.dropped ?? 0 }
    }
    const context = await this.context(set.parentSetId)
    return this.start(setId, context, options)
  }

  /** Delete one practice set with its questions, walkthrough, notes and answer images. */
  async deletePracticeSet(setId: string, projectId: string): Promise<void> {
    const set = await this.homework.getSet(setId)
    if (!set || set.projectId !== projectId || !isPracticeSet(set))
      throw new NotFoundError('HomeworkSet', setId)
    await this.db.transaction(
      'rw',
      [
        this.db.homeworkSets,
        this.db.homeworkQuestions,
        this.db.homeworkWalkthroughs,
        this.db.walkthroughNotes,
        this.db.homeworkAnswerImages,
      ],
      async () => {
        await new AnswerImageRepository(this.db).deleteBySet(setId)
        await new WalkthroughRepository(this.db).deleteBySet(setId)
        await this.db.homeworkQuestions.where('setId').equals(setId).delete()
        await this.db.homeworkSets.delete(setId)
      },
    )
  }

  // ---------------------------------------------------------------------------

  private plan(context: BuildContext, mode: PracticeMode): PracticeSlot[] {
    return planPractice({
      mode,
      questions: context.questions,
      labels: context.labels,
      sections: context.sections,
      ...(context.summary ? { summary: context.summary } : {}),
      linearAlgebra:
        context.subject?.subject === 'linear_algebra' ||
        [...context.sections.values()].some((section) => (section.checks?.length ?? 0) > 0),
    })
  }

  private async context(parentSetId: string): Promise<BuildContext> {
    const parent = await this.homework.getSet(parentSetId)
    if (!parent) throw new NotFoundError('HomeworkSet', parentSetId)
    if (isPracticeSet(parent))
      throw new AppError(t('practiceSet.notFromPractice'), 'VALIDATION_ERROR')
    const state = await new HomeworkWalkthroughService({ ai: null, db: this.db }).state(parentSetId)
    const sections = new Map<string, WalkthroughSection>()
    let summary: string | undefined
    for (const entry of state.plan) {
      const section = entry.section
      if (!section || section.status !== 'ready') continue
      if (entry.kind === 'question' && entry.question) sections.set(entry.question.id, section)
      if (entry.kind === 'summary')
        summary = [section.body, ...(section.suggestions ?? []).map((item) => `- ${item}`)].join(
          '\n',
        )
    }
    const professorHabits = await loadProfessorHabits(parent.projectId, this.db)
    return {
      parent,
      questions: state.questions,
      labels: state.questions.map((question, index) => questionLabel(question, index)),
      sections,
      ...(summary ? { summary } : {}),
      knowledge: summaryKnowledge(summary),
      subject: await loadProjectSubjectContext(parent.projectId, this.db),
      language: parent.language === 'en' ? 'en' : 'zh',
      ...(professorHabits ? { professorHabits } : {}),
      linearHints: await loadLinearStyleHints(parent.projectId, this.db),
    }
  }

  private start(
    setId: string,
    context: BuildContext,
    options: PracticeRunOptions,
  ): Promise<PracticeRunResult> {
    const running = runs.get(setId)
    if (running) return running
    const run = this.advance(setId, context, options).finally(() => runs.delete(setId))
    runs.set(setId, run)
    return run
  }

  /** Locally built linear-system question for a slot; null when a part could not be built. */
  private buildLocal(
    seed: string,
    slot: PracticeSlot,
    attempt: number,
    draft: PracticeDraft,
    language: PracticeLanguage,
    hints: LinearStyleHints = {},
  ): PracticeCandidate | null {
    const rng = createRng(`${seed}:${slot.id}:${attempt}`)
    // A full-version question mirrors its original; a compact one follows the
    // professor's usual presentation and sizes (教授出题习惯) when known.
    const compact = slot.mode === 'compact'
    const asMatrix = compact
      ? hints.presentation !== 'equations'
      : /(增广|augmented|matrix|矩阵|\\begin\{)/i.test(slot.sourceText ?? '')
    const parts: PracticePart[] = []
    for (const part of slot.parts) {
      if (!part.system) return null
      const spec = compact ? applyLinearHints(part.system, hints) : part.system
      const built =
        (compact && hints.integerOnly ? buildLinearSystem(spec, rng, { maxFractions: 0 }) : null) ??
        buildLinearSystem(spec, rng)
      if (!built) return null
      parts.push(
        linearSystemPart(built, {
          ...(part.label ? { label: part.label } : {}),
          language,
          asMatrix,
        }),
      )
    }
    return {
      id: `p${draft.nextId++}`,
      slotId: slot.id,
      origin: 'local',
      stem: linearSystemStem(language, asMatrix),
      parts,
      templates: ['linear_system'],
      knowledgePoints: slot.knowledgePoints,
      rebuilds: attempt,
    }
  }

  /** Run the build until it is done, paused or failed. */
  private async advance(
    setId: string,
    context: BuildContext,
    options: PracticeRunOptions,
  ): Promise<PracticeRunResult> {
    const control = resolveControl(options.control)
    const loaded = await this.homework.getSet(setId)
    const info = loaded?.practice
    if (!loaded || !info?.draft) throw new NotFoundError('HomeworkSet', setId)
    const draft = info.draft
    await this.homework.updateSet(setId, { status: 'analyzing', errorMessage: undefined })
    const report = (stage: PracticeRunStage, completed: number, total: number): void =>
      options.onProgress?.({ stage, completed, total })

    try {
      for (;;) {
        // Write the slots the AI still owes.
        const writeTotal = draft.pendingSlots.length
        let written = 0
        while (draft.pendingSlots.length > 0) {
          report('writing', written, writeTotal)
          if (!control.shouldContinue()) return await this.pause(setId, draft)
          const batch = draft.pendingSlots.slice(0, GENERATE_BATCH)
          await this.writeSlots(batch, draft, context, control)
          draft.pendingSlots = draft.pendingSlots.filter((id) => !batch.includes(id))
          written += batch.length
          await this.saveDraft(setId, draft)
        }
        // Review everything not reviewed yet.
        const unreviewed = () => draft.candidates.filter((candidate) => !candidate.review)
        const reviewTotal = unreviewed().length
        while (unreviewed().length > 0) {
          report('reviewing', reviewTotal - unreviewed().length, reviewTotal)
          if (!control.shouldContinue()) return await this.pause(setId, draft)
          await this.review(unreviewed().slice(0, REVIEW_BATCH), draft, context, control)
          await this.saveDraft(setId, draft)
        }
        const failed = draft.candidates.filter((candidate) => candidate.review?.pass === false)
        if (draft.stage === 'generating' && failed.length > 0) {
          // One more chance: rebuild locally / rewrite with the AI, then review again.
          draft.stage = 'retrying'
          draft.rejected = { ...(draft.rejected ?? {}) }
          for (const candidate of failed) {
            const slot = draft.slots.find((item) => item.id === candidate.slotId)!
            draft.candidates = draft.candidates.filter((item) => item !== candidate)
            const rebuilt =
              candidate.origin === 'local'
                ? this.buildLocal(
                    setId,
                    slot,
                    candidate.rebuilds + 1,
                    draft,
                    context.language,
                    context.linearHints,
                  )
                : null
            if (rebuilt) draft.candidates.push(rebuilt)
            else {
              draft.rejected[slot.id] = candidate.review?.reason ?? ''
              draft.pendingSlots.push(slot.id)
            }
          }
          await this.saveDraft(setId, draft)
          continue
        }
        for (const candidate of failed) {
          draft.dropped.push({
            slotId: candidate.slotId,
            reason: t('practiceSet.droppedReview', {
              label: this.slotLabel(draft, candidate.slotId),
              reason: candidate.review?.reason || '—',
            }),
          })
        }
        draft.candidates = draft.candidates.filter((candidate) => candidate.review?.pass !== false)
        report('saving', 0, 1)
        return await this.commit(setId, draft, context)
      }
    } catch (err) {
      if (isAbortError(err, control.signal)) return this.pause(setId, draft)
      await this.saveDraft(setId, draft)
      const set = await this.homework.updateSet(setId, {
        status: 'failed',
        errorMessage: friendlyAIError(err),
      })
      return {
        set: set ?? loaded,
        paused: false,
        created: 0,
        dropped: draft.dropped.length,
      }
    }
  }

  private slotLabel(draft: PracticeDraft, slotId: string): string {
    const index = draft.slots.findIndex((slot) => slot.id === slotId)
    return String(index + 1)
  }

  private async writeSlots(
    slotIds: readonly string[],
    draft: PracticeDraft,
    context: BuildContext,
    control: GenerationControl,
  ): Promise<void> {
    const ai = this.requireAI()
    const slots = slotIds.map((id) => draft.slots.find((slot) => slot.id === id)!)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.practiceGenerate.buildSystemPrompt(),
          context.subject,
        ),
      },
      {
        role: 'user',
        content: prompts.practiceGenerate.buildUserPrompt({
          language: context.language,
          keyPoints: knowledgeText(context.knowledge),
          ...(context.professorHabits ? { professorHabits: context.professorHabits } : {}),
          slots: slots.map((slot) => ({
            id: slot.id,
            mode: slot.mode,
            ...(slot.sourceText ? { original: clip(slot.sourceText, ORIGINAL_CHARS) } : {}),
            partLabels: slot.parts.flatMap((part) => (part.label ? [part.label] : [])),
            partSolutions: slot.parts.map((part) => part.system?.solution ?? ''),
            knowledgePoints: slot.knowledgePoints,
            ...(slot.integrative ? { integrative: true } : {}),
            ...(draft.rejected?.[slot.id] ? { rejected: draft.rejected[slot.id] } : {}),
          })),
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, {
      maxTokens: Math.min(8192, 600 + 1100 * slots.length),
      signal: control.signal,
    })
    const output = prompts.practiceGenerate.normalizeOutput(data, new Set(slotIds))
    for (const slot of slots) {
      const question = output.find((item) => item.slot === slot.id)
      const fail = (reason: string): void => {
        draft.dropped.push({
          slotId: slot.id,
          reason: t('practiceSet.droppedCheck', { label: this.slotLabel(draft, slot.id), reason }),
        })
      }
      if (!question) {
        fail(t('practiceSet.reason.notWritten'))
        continue
      }
      // 完整版 keeps the original's sub-parts exactly.
      const expected = slot.parts.map((part) => part.label ?? '')
      if (slot.mode === 'full') {
        const got = question.parts.map((part) => part.label ?? '')
        const sameShape =
          expected.length === got.length &&
          (expected.length === 1 || expected.every((label, index) => label === got[index]))
        if (!sameShape) {
          fail(t('practiceSet.reason.structure'))
          continue
        }
      }
      const parts: PracticePart[] = []
      let error = ''
      for (const [index, raw] of question.parts.entries()) {
        const requirement = slot.mode === 'full' ? slot.parts[index] : undefined
        const verified = verifyAiPart(raw, requirement, context.language)
        if (!verified.ok) {
          error = verified.reason
          break
        }
        parts.push(verified.part)
      }
      if (error) {
        fail(t('practiceSet.reason.localCheck'))
        continue
      }
      draft.candidates.push({
        id: `p${draft.nextId++}`,
        slotId: slot.id,
        origin: 'ai',
        stem: question.stem,
        parts,
        templates: [],
        knowledgePoints: slot.knowledgePoints,
        rebuilds: draft.stage === 'retrying' ? 1 : 0,
      })
    }
  }

  private async review(
    candidates: PracticeCandidate[],
    draft: PracticeDraft,
    context: BuildContext,
    control: GenerationControl,
  ): Promise<void> {
    const ai = this.requireAI()
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.practiceReview.buildSystemPrompt(),
          context.subject,
        ),
      },
      {
        role: 'user',
        content: prompts.practiceReview.buildUserPrompt({
          originals: originalsText(context),
          keyPoints: knowledgeText(context.knowledge),
          questions: candidates.map((candidate) => {
            const slot = draft.slots.find((item) => item.id === candidate.slotId)!
            return {
              id: candidate.id,
              mode: slot.mode,
              ...(slot.sourceLabel ? { mirrors: slot.sourceLabel } : {}),
              ...(slot.mode === 'full' ? { expectedStructure: structureText(slot) } : {}),
              text: clip(questionText(candidate), 1_500),
              answers: clip(
                candidate.parts
                  .map((part) => `${part.label ? `(${part.label}) ` : ''}${part.answer}`)
                  .join('; '),
                400,
              ),
            }
          }),
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, {
      maxTokens: Math.min(4096, 300 + 80 * candidates.length),
      signal: control.signal,
    })
    const verdicts = prompts.practiceReview.normalizeReview(
      data,
      new Set(candidates.map((candidate) => candidate.id)),
    )
    for (const candidate of candidates) {
      const verdict = verdicts.find((item) => item.id === candidate.id)
      // The review only judges: the question and its answers stay as they are.
      candidate.review = verdict
        ? { pass: verdict.pass, reason: verdict.reason }
        : { pass: false, reason: t('practiceSet.reason.noVerdict') }
    }
  }

  private async pause(setId: string, draft: PracticeDraft): Promise<PracticeRunResult> {
    await this.saveDraft(setId, draft)
    const set = await this.homework.updateSet(setId, { status: 'paused' })
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    return { set, paused: true, created: 0, dropped: draft.dropped.length }
  }

  private async saveDraft(setId: string, draft: PracticeDraft): Promise<void> {
    const set = await this.homework.getSet(setId)
    if (!set?.practice) return
    const done = draft.candidates.filter((candidate) => candidate.review).length
    await this.homework.updateSet(setId, {
      practice: { ...set.practice, draft: structuredClone(draft) },
      progress: {
        stage: 'generating',
        completed: Math.min(done, draft.slots.length),
        total: draft.slots.length,
        updatedAt: Date.now(),
      },
    })
  }

  /** Write the reviewed questions and finish the set, in one transaction. */
  private async commit(
    setId: string,
    draft: PracticeDraft,
    context: BuildContext,
  ): Promise<PracticeRunResult> {
    const order = new Map(draft.slots.map((slot, index) => [slot.id, index]))
    const kept = [...draft.candidates].sort(
      (a, b) => (order.get(a.slotId) ?? 0) - (order.get(b.slotId) ?? 0),
    )
    const now = Date.now()
    const questions: HomeworkQuestion[] = kept.map((candidate, index) => {
      const slot = draft.slots.find((item) => item.id === candidate.slotId)
      return {
        id: crypto.randomUUID(),
        projectId: context.parent.projectId,
        setId,
        documentId: context.parent.documentId,
        documentName: context.parent.documentName,
        order: index,
        number: String(index + 1),
        prompt: questionText(candidate),
        sourceRefs: [],
        hints: [],
        solution: solutionText(candidate),
        generationStatus: 'ready',
        promptVersion: PRACTICE_PROMPT_VERSION,
        practice: {
          origin: candidate.origin,
          parts: candidate.parts.map((part) => ({
            ...(part.label ? { label: part.label } : {}),
            answer: part.answer,
            grader: part.grader,
          })),
          knowledgePoints: candidate.knowledgePoints,
          templates: candidate.templates,
          ...(slot?.sourceQuestionId ? { sourceQuestionId: slot.sourceQuestionId } : {}),
        },
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        createdAt: now,
        updatedAt: now,
      }
    })
    let saved: HomeworkSet | undefined
    await this.db.transaction('rw', this.db.homeworkSets, this.db.homeworkQuestions, async () => {
      const current = await this.homework.getSet(setId)
      if (!current?.practice) return
      await this.db.homeworkQuestions.where('setId').equals(setId).delete()
      if (questions.length) await this.homework.addQuestions(questions)
      const practice: PracticeSetInfo = {
        mode: current.practice.mode,
        requested: draft.slots.length,
        dropped: draft.dropped.length,
        ...(draft.dropped.length
          ? { droppedReasons: draft.dropped.map((item) => item.reason) }
          : {}),
        generatedAt: now,
      }
      saved = {
        ...current,
        status: questions.length ? 'ready' : 'failed',
        questionCount: questions.length,
        practice,
        progress: undefined,
        errorMessage: questions.length ? undefined : t('practiceSet.allDropped'),
        updatedAt: now,
      }
      await this.homework.upsertSet(saved)
    })
    if (!saved) throw new NotFoundError('HomeworkSet', setId)
    return { set: saved, paused: false, created: questions.length, dropped: draft.dropped.length }
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'MISSING_API_KEY')
    return this.ai
  }
}

// --- Text --------------------------------------------------------------------

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The question as the student sees it: stem, then `(a) …` parts. */
export function questionText(candidate: Pick<PracticeCandidate, 'stem' | 'parts'>): string {
  const parts = candidate.parts.map((part) =>
    part.label ? `(${part.label}) ${part.prompt}` : part.prompt,
  )
  return [candidate.stem, ...parts].filter((item) => item.trim()).join('\n\n')
}

/** The reference solution: each part's worked solution, then its answer. */
export function solutionText(candidate: Pick<PracticeCandidate, 'parts'>): string {
  return candidate.parts
    .map((part) =>
      [part.label ? `### (${part.label})` : '', part.solution, `**${part.answer}**`]
        .filter(Boolean)
        .join('\n\n'),
    )
    .join('\n\n')
}

function knowledgeText(knowledge: SummaryKnowledge): string {
  const lines = [
    ...knowledge.categories.map(
      (item) => `- ${item.name}${item.questions ? ` (${item.questions})` : ''}`,
    ),
    ...knowledge.keyPoints.map((point) => `- ${point}`),
  ]
  return clip(lines.join('\n'), KEY_POINT_CHARS)
}

function originalsText(context: BuildContext): string {
  let text = ''
  context.questions.forEach((question, index) => {
    const line = `[${context.labels[index]}] ${clip(question.prompt.replace(/\s+/g, ' '), REVIEW_ORIGINAL_CHARS)}`
    if (text.length + line.length < REVIEW_ORIGINALS_TOTAL) text += `${text ? '\n' : ''}${line}`
  })
  return text
}

function structureText(slot: PracticeSlot): string {
  const labelled = slot.parts.filter((part) => part.label)
  if (labelled.length === 0)
    return `no sub-parts${slot.parts[0]?.system ? `; solution type ${slot.parts[0].system.solution}` : ''}`
  return labelled
    .map((part) => `(${part.label})${part.system ? ` ${part.system.solution}` : ''}`)
    .join(', ')
}
