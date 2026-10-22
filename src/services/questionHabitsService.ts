import type { AIService } from './aiService'
import { withUsageKind } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { resolveMaterialType } from '@/entities/document/types'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { isExamSet, isPracticeSet } from '@/entities/homework/types'
import { isHeldOut } from '@/entities/evaluation/evalRole'
import { PracticeRepository } from '@/entities/practice/repository'
import { UserRepository } from '@/entities/user/repository'
import {
  buildHabitsBlock,
  isQuestionHabitCategory,
  linearStyleHints,
  type LinearStyleHints,
  type QuestionHabitCategory,
  type QuestionHabitItem,
  type QuestionHabitSourceKind,
  type QuestionHabitsProfile,
} from '@/entities/questionHabits/types'
import {
  batchHabitDocuments,
  dropRemovedSources,
  habitSourceHash,
  labelUnits,
  looksLikeQuestion,
  mergeHabitsReply,
  planHabitSources,
  type HabitDocument,
} from '@/entities/questionHabits/update'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { t } from '@/i18n'
import { loadProjectSubjectContext } from './projectSubject'

/**
 * 教授出题习惯档案: read the professor's own questions (recognised homework
 * questions, Professor Practice questions, question-like passages of past
 * exams / syllabi), have the AI summarise the habits (`question-style/v1`)
 * with verbatim evidence, and keep the result on the course context.
 *
 * Incremental: only documents that are new or changed since they were last
 * read are sent, with the current profile; documents that disappeared take
 * their evidence with them (no AI). Items the student wrote or edited are
 * never changed. Never automatic: the student starts every run. Runs in
 * batches of whole documents; pause / stop between / during batches, and a
 * finished batch is already saved.
 */

export const QUESTION_STYLE_PROMPT_VERSION = `${prompts.questionStyle.PROMPT_KIND}/${prompts.questionStyle.VERSION}`

export interface HabitsPendingDocument {
  documentId: string
  documentName: string
  kind: QuestionHabitSourceKind
  /** Never read before (false: changed since it was read). */
  isNew: boolean
}

export interface QuestionHabitsStatus {
  profile?: QuestionHabitsProfile
  /** Documents with questions that are new or changed since the last run. */
  pending: HabitsPendingDocument[]
  /** Documents with questions in this course. */
  sourceCount: number
}

export interface HabitsRunProgress {
  done: number
  total: number
}

export interface HabitsRunResult {
  paused: boolean
  done: number
  total: number
  added: number
  updated: number
  removed: number
  dropped: number
}

const runs = new Map<string, Promise<HabitsRunResult>>()

export class QuestionHabitsService {
  private ai: AIService | null
  private db: AppDatabase
  private contexts: CourseContextRepository

  constructor(deps: { ai?: AIService | null; db?: AppDatabase } = {}) {
    this.ai = withUsageKind(deps.ai ?? null, 'analysis')
    this.db = deps.db ?? getDb()
    this.contexts = new CourseContextRepository(this.db)
  }

  isRunning(projectId: string): boolean {
    return runs.has(projectId)
  }

  async get(projectId: string): Promise<QuestionHabitsProfile | undefined> {
    return (await this.contexts.get(projectId))?.questionHabits
  }

  async status(projectId: string): Promise<QuestionHabitsStatus> {
    const [profile, documents] = await Promise.all([
      this.get(projectId),
      this.collectDocuments(projectId),
    ])
    const known = new Set((profile?.sources ?? []).map((source) => source.documentId))
    const plan = planHabitSources(profile, documents)
    return {
      ...(profile ? { profile } : {}),
      pending: plan.changed.map((doc) => ({
        documentId: doc.documentId,
        documentName: doc.documentName,
        kind: doc.kind,
        isNew: !known.has(doc.documentId),
      })),
      sourceCount: documents.filter((doc) => doc.units.length > 0).length,
    }
  }

  /** Every document of the course with professor questions, read locally. */
  async collectDocuments(projectId: string): Promise<HabitDocument[]> {
    const out = new Map<string, HabitDocument>()
    const add = (
      documentId: string,
      documentName: string,
      kind: QuestionHabitSourceKind,
      unit: HabitDocument['units'][number],
    ) => {
      let doc = out.get(documentId)
      if (!doc) {
        doc = { documentId, documentName, kind, hash: '', units: [] }
        out.set(documentId, doc)
      }
      doc.units.push(unit)
    }

    const homework = new HomeworkRepository(this.db)
    for (const set of await homework.listSets(projectId)) {
      // Independent evaluation items never feed the habits profile.
      if (isPracticeSet(set) || isHeldOut(set)) continue
      const kind: QuestionHabitSourceKind = isExamSet(set) ? 'exam' : 'homework'
      const questions = (await homework.listQuestions(set.id)).filter(
        (question) => !question.retired && question.prompt.trim() && !isHeldOut(question),
      )
      questions.forEach((question, index) =>
        add(set.documentId, set.documentName, kind, {
          documentId: set.documentId,
          documentName: set.documentName,
          kind,
          questionId: question.id,
          setId: set.id,
          position: `question ${question.number ?? index + 1}`,
          text: question.prompt,
        }),
      )
    }

    for (const question of await new PracticeRepository(this.db).listQuestionsByProject(
      projectId,
    )) {
      if (!question.prompt.trim()) continue
      const options = question.options.map(
        (option, index) => `${String.fromCharCode(65 + index)}. ${option.label}`,
      )
      add(question.documentId, question.documentName, 'practice', {
        documentId: question.documentId,
        documentName: question.documentName,
        kind: 'practice',
        questionId: question.id,
        ...(question.chunkId ? { chunkId: question.chunkId } : {}),
        position: `question ${question.number ?? question.order + 1}`,
        text: [question.prompt, ...options].join('\n'),
      })
    }

    const documents = await new DocumentRepository(this.db).listByProject(projectId)
    const chunks = new ChunkRepository(this.db)
    for (const document of documents) {
      if (document.status !== 'ready' || resolveMaterialType(document.materialType) !== 'syllabus')
        continue
      for (const chunk of await chunks.listByDocument(document.id)) {
        if (!looksLikeQuestion(chunk.text)) continue
        add(document.id, document.name, 'syllabus', {
          documentId: document.id,
          documentName: document.name,
          kind: 'syllabus',
          chunkId: chunk.id,
          ...(chunk.pageNumber ? { position: `p. ${chunk.pageNumber}` } : {}),
          text: chunk.text,
        })
      }
    }

    // A document held out for independent evaluation never feeds the profile.
    const heldOut = new Set(documents.filter((document) => isHeldOut(document)).map((d) => d.id))
    return [...out.values()]
      .filter((doc) => !heldOut.has(doc.documentId))
      .map((doc) => ({
        ...doc,
        hash: habitSourceHash(doc.units.map((unit) => unit.text)),
      }))
  }

  /**
   * Read the new / changed documents (all of them with `force`, which also
   * starts the AI items afresh; the student's items stay). Resolves with the
   * counts; paused when the control asked to stop.
   */
  analyze(
    projectId: string,
    options: {
      control?: GenerationControl
      force?: boolean
      onProgress?: (progress: HabitsRunProgress) => void
    } = {},
  ): Promise<HabitsRunResult> {
    const running = runs.get(projectId)
    if (running) return running
    const run = this.run(projectId, options).finally(() => runs.delete(projectId))
    runs.set(projectId, run)
    return run
  }

  private async run(
    projectId: string,
    options: {
      control?: GenerationControl
      force?: boolean
      onProgress?: (progress: HabitsRunProgress) => void
    },
  ): Promise<HabitsRunResult> {
    const ai = this.ai
    if (!ai) throw new AppError(t('quiz.noProviderHint'), 'MISSING_API_KEY')
    const control = resolveControl(options.control)
    const documents = await this.collectDocuments(projectId)
    if (documents.every((doc) => doc.units.length === 0)) {
      throw new AppError(t('habits.errors.noSources'), 'VALIDATION_ERROR')
    }
    const now = Date.now()
    if (options.force) {
      // Start afresh: AI items and the read documents go; the student's stay.
      await this.contexts.updateQuestionHabits(projectId, (current) => ({
        ...(current ?? {}),
        items: (current?.items ?? []).filter((item) => item.userEdited),
        sources: [],
        updatedAt: now,
      }))
    }
    const plan = planHabitSources(await this.get(projectId), documents)
    if (plan.removed.length > 0) {
      await this.contexts.updateQuestionHabits(projectId, (current) =>
        current ? dropRemovedSources(current, plan.removed, now) : current,
      )
    }

    const subject = await loadProjectSubjectContext(projectId, this.db)
    const preference = (await new UserRepository(this.db).get().catch(() => undefined))
      ?.questionLanguage
    const language = preference === 'en' ? 'en' : 'zh'
    const batches = batchHabitDocuments(plan.changed)
    const result: HabitsRunResult = {
      paused: false,
      done: 0,
      total: batches.length,
      added: 0,
      updated: 0,
      removed: 0,
      dropped: 0,
    }
    for (const batch of batches) {
      options.onProgress?.({ done: result.done, total: result.total })
      if (!control.shouldContinue()) return { ...result, paused: true }
      const current = (await this.get(projectId)) ?? emptyProfile(Date.now())
      const units = labelUnits(batch)
      const shortIds = new Map(current.items.map((item, index) => [`h${index + 1}`, item.id]))
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: prompts.subjectProfile.withSubject(
            prompts.questionStyle.buildSystemPrompt(),
            subject,
          ),
        },
        {
          role: 'user',
          content: prompts.questionStyle.buildUserPrompt({
            language,
            current: current.items.map((item, index) => ({
              id: `h${index + 1}`,
              category: item.category,
              statement: item.statement,
              locked: item.userEdited === true,
            })),
            units: units.map((unit) => ({
              label: unit.label,
              kind: unit.kind,
              documentName: unit.documentName,
              ...(unit.position ? { position: unit.position } : {}),
              text: unit.text,
            })),
          }),
        },
      ]
      let data: unknown
      try {
        ;({ data } = await ai.chatJSON<unknown>(messages, { signal: control.signal }))
      } catch (err) {
        if (isAbortError(err, control.signal)) return { ...result, paused: true }
        throw err
      }
      const reply = prompts.questionStyle.normalizeOutput(data)
      let merged: ReturnType<typeof mergeHabitsReply> | undefined
      await this.contexts.updateQuestionHabits(projectId, (stored) => {
        merged = mergeHabitsReply({
          profile: stored ?? emptyProfile(Date.now()),
          reply,
          units,
          shortIds,
          batch,
          now: Date.now(),
          newId: () => crypto.randomUUID(),
          promptVersion: QUESTION_STYLE_PROMPT_VERSION,
        })
        return merged.profile
      })
      result.done += 1
      result.added += merged!.added
      result.updated += merged!.updated
      result.removed += merged!.removed
      result.dropped += merged!.dropped
      logger.info('Question habits batch merged', {
        projectId,
        batch: result.done,
        added: merged!.added,
        dropped: merged!.dropped,
      })
    }
    options.onProgress?.({ done: result.done, total: result.total })
    return result
  }

  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    await this.contexts.updateQuestionHabits(projectId, (current) => ({
      ...(current ?? emptyProfile(Date.now())),
      enabled,
    }))
  }

  async addItem(
    projectId: string,
    input: { category: QuestionHabitCategory; statement: string },
  ): Promise<QuestionHabitItem> {
    const statement = cleanStatement(input.statement)
    if (!statement || !isQuestionHabitCategory(input.category)) {
      throw new AppError(t('habits.errors.emptyStatement'), 'VALIDATION_ERROR')
    }
    const now = Date.now()
    const item: QuestionHabitItem = {
      id: crypto.randomUUID(),
      category: input.category,
      statement,
      evidence: [],
      userEdited: true,
      createdAt: now,
      updatedAt: now,
    }
    await this.contexts.updateQuestionHabits(projectId, (current) => {
      const base = current ?? emptyProfile(now)
      return { ...base, items: [...base.items, item], updatedAt: now }
    })
    return item
  }

  /** Edit an item; it becomes the student's and is never changed by an update again. */
  async updateItem(
    projectId: string,
    itemId: string,
    patch: { category?: QuestionHabitCategory; statement?: string },
  ): Promise<void> {
    const statement = patch.statement !== undefined ? cleanStatement(patch.statement) : undefined
    if (statement === '') throw new AppError(t('habits.errors.emptyStatement'), 'VALIDATION_ERROR')
    const now = Date.now()
    await this.contexts.updateQuestionHabits(projectId, (current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...(statement ? { statement } : {}),
                ...(patch.category && isQuestionHabitCategory(patch.category)
                  ? { category: patch.category }
                  : {}),
                userEdited: true,
                updatedAt: now,
              }
            : item,
        ),
        updatedAt: now,
      }
    })
  }

  async deleteItem(projectId: string, itemId: string): Promise<void> {
    await this.contexts.updateQuestionHabits(projectId, (current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.id !== itemId),
            updatedAt: Date.now(),
          }
        : current,
    )
  }
}

function emptyProfile(now: number): QuestionHabitsProfile {
  return { items: [], sources: [], updatedAt: now }
}

function cleanStatement(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240)
}

/**
 * The professor-style block for question-writing prompts, or `undefined`
 * when the course has no profile, it is empty or 「模仿教授出题」 is off.
 */
export async function loadProfessorHabits(
  projectId: string,
  db?: AppDatabase,
): Promise<string | undefined> {
  const context = await new CourseContextRepository(db).get(projectId).catch(() => undefined)
  return buildHabitsBlock(context?.questionHabits)
}

/** Hints for the local linear-system constructor ({} without an active profile). */
export async function loadLinearStyleHints(
  projectId: string,
  db?: AppDatabase,
): Promise<LinearStyleHints> {
  const context = await new CourseContextRepository(db).get(projectId).catch(() => undefined)
  return linearStyleHints(context?.questionHabits)
}
