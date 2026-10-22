import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { PROMPT_VERSIONS } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import { professorAnswerOf } from '@/entities/homework/walkthrough'
import { effectiveEvalRole, type EvalRole } from '@/entities/evaluation/evalRole'
import {
  EVALUATION_TEXT_LIMIT,
  MAX_EVALUATION_RECORDS,
  parsingSummary,
  worstStatus,
  type EvaluationAbility,
  type EvaluationItem,
  type EvaluationRecord,
  type EvaluationWalkthroughResult,
} from '@/entities/evaluation/types'
import type { ProfessorCompareReport } from '@/entities/homework/professorCompare'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import {
  isAbortError,
  type GenerationControl,
  createGenerationRun,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { HomeworkService } from './homeworkService'
import type { HomeworkWalkthroughService } from './homeworkWalkthroughService'

/** What one evaluation run covers. */
export interface EvaluationRunOptions {
  abilities: EvaluationAbility[]
  /** Roles of the questions to include (`regression` items count for parsing only). */
  roles: Array<EvalRole | 'none'>
  language: 'zh' | 'en'
  control?: GenerationControl
  /** Continue this paused record (only the work still missing is done). */
  resumeId?: string
  onProgress?: (done: number, total: number) => void
}

/** The questions an ability can be measured on. */
export function eligible(question: HomeworkQuestion, ability: EvaluationAbility): boolean {
  if (question.retired) return false
  const answer = professorAnswerOf(question)
  if (ability === 'grading')
    return Boolean(question.draftText.trim()) && Boolean(answer || question.solution)
  return Boolean(answer)
}

const clip = (text: string | undefined): string | undefined =>
  text ? text.slice(0, EVALUATION_TEXT_LIMIT) : undefined

/** One section + comparison → the stored result (statuses only, short texts). */
export function walkthroughResult(
  section: WalkthroughSection,
  report: ProfessorCompareReport | undefined,
): EvaluationWalkthroughResult {
  if (section.status === 'insufficient') return { status: 'insufficient' }
  if (section.status !== 'ready' || !report) return { status: 'failed' }
  const status = worstStatus(report.items.map((item) => item.status))
  const conclusion = clip(section.conclusion)
  const notes = report.items
    .filter((item) => item.status !== 'same')
    .map((item) => clip(`${item.label ? `(${item.label}) ` : ''}${item.note}`)!)
  return {
    status,
    ...(conclusion ? { conclusion } : {}),
    ...(notes.length ? { notes } : {}),
  }
}

/**
 * 检验网站: measures the three abilities separately on one assignment and
 * saves each run as an `EvaluationRecord` on the set. Runs only on request,
 * pausable between questions (the record keeps what is done; 继续 does only
 * the rest). Nothing a run writes is shown in the walkthrough or used for
 * practice: sections and comparisons stay inside the record.
 */
export class EvaluationService {
  private db: AppDatabase
  private sets: HomeworkRepository

  constructor(
    private deps: {
      homework: HomeworkService
      walkthroughs: HomeworkWalkthroughService
      model: string
      db?: AppDatabase
    },
  ) {
    this.db = deps.db ?? getDb()
    this.sets = new HomeworkRepository(this.db)
  }

  hasAI(): boolean {
    return this.deps.walkthroughs.hasAI()
  }

  async records(setId: string): Promise<EvaluationRecord[]> {
    return (await this.sets.getSet(setId))?.evaluations ?? []
  }

  /** Save / replace one record on the set (newest first, bounded). */
  private async saveRecord(record: EvaluationRecord): Promise<void> {
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const set = await this.db.homeworkSets.get(record.setId)
      if (!set) return
      const others = (set.evaluations ?? []).filter((item) => item.id !== record.id)
      const evaluations = [record, ...others]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_EVALUATION_RECORDS)
      await this.db.homeworkSets.put({ ...set, evaluations })
    })
  }

  async deleteRecord(setId: string, recordId: string): Promise<void> {
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const set = await this.db.homeworkSets.get(setId)
      if (!set) return
      await this.db.homeworkSets.put({
        ...set,
        evaluations: (set.evaluations ?? []).filter((item) => item.id !== recordId),
      })
    })
  }

  private async requireSet(setId: string): Promise<HomeworkSet> {
    const set = await this.sets.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    return set
  }

  async run(setId: string, options: EvaluationRunOptions): Promise<EvaluationRecord> {
    const control = options.control ?? createGenerationRun()
    const set = await this.requireSet(setId)
    const all = (await this.sets.listQuestions(setId)).filter((question) => !question.retired)
    const roleOf = (question: HomeworkQuestion): EvalRole | 'none' =>
      effectiveEvalRole(question, set) ?? 'none'
    const included = all.filter((question) => options.roles.includes(roleOf(question)))
    if (included.length === 0)
      throw new AppError(t('evaluation.errors.noQuestions'), 'VALIDATION_ERROR')
    const previous = options.resumeId
      ? (set.evaluations ?? []).find((record) => record.id === options.resumeId)
      : undefined
    const abilities = previous?.abilities ?? options.abilities
    // Grading may be decided locally; writing and comparing need the AI.
    if (abilities.some((ability) => ability !== 'grading') && !this.hasAI())
      throw new AppError(t('evaluation.errors.noAI'), 'MISSING_API_KEY')
    const labels = new Map(
      all.map((question, index) => [question.id, question.number?.trim() || String(index + 1)]),
    )
    const record: EvaluationRecord = previous
      ? { ...previous, status: 'running' }
      : {
          id: crypto.randomUUID(),
          projectId: set.projectId,
          setId,
          startedAt: Date.now(),
          status: 'running',
          model: this.deps.model,
          promptVersions: {
            homeworkWalkthrough: PROMPT_VERSIONS.homeworkWalkthrough,
            walkthroughCompare: PROMPT_VERSIONS.walkthroughCompare,
            homeworkAnswerCheck: PROMPT_VERSIONS.homeworkAnswerCheck,
          },
          abilities,
          roles: options.roles,
          items: included.map((question) => ({
            questionId: question.id,
            label: labels.get(question.id) ?? '?',
            role: roleOf(question),
          })),
          // Parsing accuracy covers every question of the set (regression items included).
          parsing: parsingSummary(all),
        }
    const byId = new Map(all.map((question) => [question.id, question]))
    type Job = { item: EvaluationItem; ability: EvaluationAbility; question: HomeworkQuestion }
    const jobs: Job[] = []
    for (const item of record.items) {
      const question = byId.get(item.questionId)
      if (!question) continue
      for (const ability of abilities) {
        if (item[ability]) continue // done in an earlier (paused) run
        if (eligible(question, ability)) jobs.push({ item, ability, question })
      }
    }
    await this.saveRecord(record)
    let done = 0
    options.onProgress?.(done, jobs.length)
    let interrupted = false
    for (const job of jobs) {
      if (!control.shouldContinue()) {
        interrupted = true
        break
      }
      try {
        if (job.ability === 'grading') {
          const graded = await this.deps.homework.gradeSample(
            job.question,
            job.question.draftText,
            options.language,
            { signal: control.signal },
          )
          job.item.grading = {
            verdict: graded.verdict,
            method: graded.method,
            ...(job.question.teacherMark ? { teacher: job.question.teacherMark.verdict } : {}),
          }
        } else {
          const { section, report } = await this.deps.walkthroughs.evaluateQuestion(job.question, {
            align: job.ability === 'aligned',
            label: job.item.label,
            control,
          })
          job.item[job.ability] = walkthroughResult(section, report)
        }
      } catch (err) {
        if (isAbortError(err, control.signal)) {
          interrupted = true
          break
        }
        const error = friendlyAIError(err)
        if (job.ability === 'grading') job.item.grading = { error }
        else job.item[job.ability] = { status: 'failed', error }
      }
      done += 1
      options.onProgress?.(done, jobs.length)
      await this.saveRecord(record)
    }
    const finished: EvaluationRecord = interrupted
      ? { ...record, status: 'paused' }
      : { ...record, status: 'done', finishedAt: Date.now() }
    await this.saveRecord(finished)
    return finished
  }
}
