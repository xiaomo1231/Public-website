import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkRepository } from '@/entities/homework/repository'
import { EvaluationService, walkthroughResult } from '@/services/evaluationService'
import type { HomeworkService } from '@/services/homeworkService'
import type { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import {
  evaluationMarkdown,
  gradingAgrees,
  parsingSummary,
  summarizeEvaluation,
  worstStatus,
  type EvaluationRecord,
} from '@/entities/evaluation/types'
import {
  effectiveEvalRole,
  isExcludedFromCourseContext,
  isHeldOut,
  usedForTuning,
} from '@/entities/evaluation/evalRole'

describe('evaluation roles', () => {
  it('only `independent` is held out', () => {
    expect(isHeldOut({ evalRole: 'independent' })).toBe(true)
    expect(isHeldOut({ evalRole: 'development' }, { evalRole: 'regression' })).toBe(false)
    expect(isHeldOut({}, { evalRole: 'independent' })).toBe(true)
    expect(isExcludedFromCourseContext({ materialType: 'textbook', evalRole: 'independent' })).toBe(
      true,
    )
    expect(isExcludedFromCourseContext({ materialType: 'syllabus' })).toBe(true)
    expect(isExcludedFromCourseContext({ materialType: 'textbook', evalRole: 'development' })).toBe(
      false,
    )
    expect(effectiveEvalRole({}, { evalRole: 'development' })).toBe('development')
    expect(effectiveEvalRole({ evalRole: 'independent' }, { evalRole: 'development' })).toBe(
      'independent',
    )
  })

  it('a question looked at with help counts as used for tuning', () => {
    expect(usedForTuning({ revealedHints: 0, messages: [] })).toBe(false)
    expect(usedForTuning({ solutionRevealed: true })).toBe(true)
    expect(usedForTuning({}, { hasWalkthroughSection: true })).toBe(true)
  })
})

describe('evaluation summaries', () => {
  const record: EvaluationRecord = {
    id: 'r',
    projectId: 'p',
    setId: 's',
    startedAt: 0,
    status: 'done',
    model: 'm',
    promptVersions: { homeworkWalkthrough: 'v7' },
    abilities: ['solve', 'aligned', 'grading'],
    roles: ['development', 'independent'],
    items: [
      {
        questionId: '1',
        label: '1',
        role: 'development',
        solve: { status: 'same' },
        aligned: { status: 'same' },
        grading: { verdict: 'correct', teacher: 'correct', method: 'local' },
      },
      {
        questionId: '2',
        label: '2',
        role: 'development',
        solve: { status: 'result_differs' },
        aligned: { status: 'method_differs' },
        grading: { verdict: 'incorrect', teacher: 'partial', method: 'ai' },
      },
      { questionId: '3', label: '3', role: 'independent', solve: { status: 'failed', error: 'x' } },
    ],
    parsing: parsingSummary([
      { edits: [{ kinds: ['minus_sign', 'exponent'] }], verifiedAt: 1 },
      { edits: [] },
      { edits: [{ kinds: ['minus_sign'] }] },
    ]),
  }

  it('keeps development and independent results apart, with n', () => {
    const [dev, independent] = summarizeEvaluation(record)
    expect(dev!.role).toBe('development')
    expect(dev!.solve).toMatchObject({ n: 2, same: 1, resultDiffers: 1 })
    expect(dev!.aligned).toMatchObject({ n: 2, same: 1, methodDiffers: 1 })
    expect(dev!.grading).toMatchObject({ graded: 2, withTeacher: 2, agree: 1 })
    expect(independent!.role).toBe('independent')
    expect(independent!.solve).toMatchObject({ n: 0, failed: 1 })
  })

  it('counts parsing corrections by kind', () => {
    expect(record.parsing).toMatchObject({ questions: 3, edited: 2, verified: 1 })
    expect(record.parsing.byKind.minus_sign).toBe(2)
    expect(record.parsing.byKind.exponent).toBe(1)
  })

  it('exports Markdown with the caveat and the counts', () => {
    const md = evaluationMarkdown(record, 'HW 1')
    expect(md).toContain('只是辅助')
    expect(md).toContain('n = 2')
    expect(md).toContain(
      '| 2 | development | result_differs | method_differs | incorrect / partial |',
    )
  })

  it('reads statuses', () => {
    expect(worstStatus(['same', 'method_differs', 'same'])).toBe('method_differs')
    expect(worstStatus(['same', 'result_differs', 'missing_in_walkthrough'])).toBe('result_differs')
    expect(gradingAgrees('uncertain', 'correct')).toBeUndefined()
    expect(gradingAgrees('correct', undefined)).toBeUndefined()
    const section = { status: 'ready', conclusion: 'c', body: 'b' } as WalkthroughSection
    expect(
      walkthroughResult(section, {
        items: [
          { label: 'a', status: 'same', note: '' },
          { label: 'b', status: 'result_differs', note: 'off by one' },
        ],
      } as never),
    ).toEqual({ status: 'result_differs', conclusion: 'c', notes: ['(b) off by one'] })
  })
})

let db: AppDatabase | undefined
afterEach(() => db?.close())

describe('EvaluationService', () => {
  it('runs the abilities separately, saves the record, pauses and resumes', async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projectId = (await new ProjectService(db).create({ name: 'LA', subject: 'calculus' })).id
    const repo = new HomeworkRepository(db)
    const setId = crypto.randomUUID()
    await repo.upsertSet({
      id: setId,
      projectId,
      documentId: 'd',
      documentName: 'hw',
      title: 'HW',
      status: 'ready',
      language: 'en',
      questionCount: 2,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    })
    const base = {
      projectId,
      setId,
      documentId: 'd',
      documentName: 'hw',
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready' as const,
      promptVersion: 'v1',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      answerStatus: 'matched' as const,
      answerText: 'x = 1',
    }
    await repo.upsertQuestion({
      ...base,
      id: 'a',
      order: 0,
      prompt: 'A',
      draftText: 'x = 1',
      evalRole: 'development',
      teacherMark: { verdict: 'correct', at: 1 },
    } as HomeworkQuestion)
    await repo.upsertQuestion({
      ...base,
      id: 'b',
      order: 1,
      prompt: 'B',
      draftText: '',
      evalRole: 'independent',
    } as HomeworkQuestion)
    await repo.upsertQuestion({
      ...base,
      id: 'c',
      order: 2,
      prompt: 'C',
      draftText: '',
    } as HomeworkQuestion)

    const evaluateQuestion = vi.fn(async (_q: HomeworkQuestion, options: { align: boolean }) => ({
      section: { status: 'ready', conclusion: 'x = 1', body: 'b' } as WalkthroughSection,
      report: {
        items: [{ label: '', status: options.align ? 'same' : 'method_differs', note: 'n' }],
      } as never,
    }))
    const gradeSample = vi.fn(async () => ({
      verdict: 'correct' as const,
      method: 'local' as const,
    }))
    const service = new EvaluationService({
      homework: { gradeSample } as unknown as HomeworkService,
      walkthroughs: {
        evaluateQuestion,
        hasAI: () => true,
      } as unknown as HomeworkWalkthroughService,
      model: 'test-model',
      db,
    })

    // Pause after the first piece of work.
    let allowed = 1
    const control = {
      signal: new AbortController().signal,
      shouldContinue: () => allowed-- > 0,
    }
    const paused = await service.run(setId, {
      abilities: ['solve', 'aligned', 'grading'],
      roles: ['development', 'independent'],
      language: 'en',
      control,
    })
    expect(paused.status).toBe('paused')
    expect(paused.items.map((item) => item.questionId)).toEqual(['a', 'b'])
    expect(evaluateQuestion).toHaveBeenCalledTimes(1)

    const done = await service.run(setId, {
      abilities: ['solve'],
      roles: ['development', 'independent'],
      language: 'en',
      resumeId: paused.id,
    })
    expect(done.status).toBe('done')
    expect(done.model).toBe('test-model')
    // Resumed with the paused run's abilities: only the missing work was done.
    expect(evaluateQuestion).toHaveBeenCalledTimes(4)
    expect(gradeSample).toHaveBeenCalledTimes(1)
    const [a, b] = done.items
    expect(a).toMatchObject({
      solve: { status: 'method_differs' },
      aligned: { status: 'same' },
      grading: { verdict: 'correct', teacher: 'correct' },
    })
    expect(b!.grading).toBeUndefined() // no saved student answer
    // 独立解题 calls never ask for alignment.
    expect(evaluateQuestion.mock.calls.filter(([, o]) => !o.align)).toHaveLength(2)
    const stored = await service.records(setId)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.id).toBe(paused.id)
  })
})
