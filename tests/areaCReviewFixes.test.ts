import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { recoverInterruptedProcessing } from '@/services/processingRecovery'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { collectTopicSources } from '@/services/topicSources'
import { TutorService } from '@/services/tutorService'
import type { AIService } from '@/services/aiService'
import type { MistakeService } from '@/services/mistakeService'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'
import type { Document } from '@/entities/document/types'
import type { TutorSession } from '@/entities/tutorSession/types'
import { targetLanguageInvalid } from '@/widgets/project/subjectDetails'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

const doc = (id: string, patch: Partial<Document>): Document =>
  ({
    id,
    projectId: 'p1',
    type: 'pdf',
    materialType: 'textbook',
    name: `${id}.pdf`,
    sizeBytes: 10,
    hasBlob: true,
    status: 'processing',
    warnings: [],
    metadata: {},
    uploadedAt: 0,
    ...patch,
  }) as Document

describe('interrupted document processing', () => {
  it('releases old stuck rows and keeps recent ones', async () => {
    const now = 10 * 60 * 60_000
    await db.documents.bulkPut([
      doc('never', { uploadedAt: now - 60 * 60_000 }),
      doc('before', { uploadedAt: now - 60 * 60_000, processedAt: 5, chunkCount: 3 }),
      doc('recent', { uploadedAt: now - 60_000 }),
      doc('done', { status: 'ready', uploadedAt: now - 60 * 60_000 }),
    ])
    await db.processingJobs.put({
      id: 'j1',
      documentId: 'never',
      projectId: 'p1',
      stage: 'extracting',
      progress: 5,
      startedAt: now - 60 * 60_000,
      updatedAt: now - 60 * 60_000,
    })
    expect(await recoverInterruptedProcessing(db, now)).toBe(2)
    const never = await db.documents.get('never')
    expect(never?.status).toBe('failed')
    expect(never?.errorMessage).toBeTruthy()
    // Already processed once: its chunks are still there, so it stays readable.
    expect((await db.documents.get('before'))?.status).toBe('ready')
    expect((await db.documents.get('recent'))?.status).toBe('processing')
    expect((await db.documents.get('done'))?.status).toBe('ready')
    expect((await db.processingJobs.get('j1'))?.stage).toBe('failed')
  })
})

describe('stale annotation', () => {
  it('never writes an older copy of the analysis row back', async () => {
    const row = {
      id: 'a1',
      projectId: 'p1',
      status: 'ready',
      language: 'en',
      progress: 100,
      documentIds: [],
      topicCount: 1,
      formulaCount: 0,
      symbolCount: 0,
      startedAt: 1,
      promptVersion: 'v',
      sourceHash: 'old',
    } as CourseAnalysis
    await db.courseAnalyses.put(row)
    const content = new CourseContentRepository({ db })
    // A finished analysis lands between the reader's snapshot and the annotation.
    await db.courseAnalyses.put({ ...row, topicCount: 7, sourceHash: 'new' })
    await content.markStale('p1', 'source-removed')
    const stored = await db.courseAnalyses.get('a1')
    expect(stored).toMatchObject({
      topicCount: 7,
      sourceHash: 'new',
      staleReason: 'source-removed',
    })
    await content.clearStale('p1')
    const cleared = await db.courseAnalyses.get('a1')
    expect(cleared?.staleReason).toBeUndefined()
    expect(cleared?.staleAt).toBeUndefined()
    expect(cleared?.topicCount).toBe(7)
  })
})

describe('topic sources stay inside their course', () => {
  it('returns nothing for a topic id of another project', async () => {
    await db.courseAnalyses.put({
      id: 'a1',
      projectId: 'p1',
      status: 'ready',
      language: 'en',
      progress: 100,
      documentIds: ['d1'],
      topicCount: 1,
      formulaCount: 0,
      symbolCount: 0,
      startedAt: 1,
      promptVersion: 'v',
    } as CourseAnalysis)
    await db.topics.put({
      id: 't-other',
      projectId: 'p2',
      name: 'Other course topic',
      description: '',
      order: 0,
      topicIds: [],
      sourceRefs: [],
      createdAt: 1,
    } as Topic)
    const sources = await collectTopicSources(
      { analyses: new CourseAnalysisRepository(db), chunks: new ChunkRepository(db) },
      'p1',
      't-other',
      4,
    )
    expect(sources).toEqual([])
  })
})

describe('tutor mistake record', () => {
  it('keeps the number of hints used before the session is reset', async () => {
    await db.projects.put({ id: 'p1', name: 'C', subject: 'other', createdAt: 1, updatedAt: 1 })
    const session = {
      id: 's1',
      projectId: 'p1',
      topicId: 't1',
      topicName: 'Limits',
      language: 'en',
      messages: [],
      turns: [],
      streakCorrect: 0,
      streakWrong: 0,
      currentDifficulty: 'intermediate',
      hintsRevealed: 2,
      mastery: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      pendingQuestion: {
        id: 'q1',
        prompt: 'lim x→0 sin x / x?',
        type: 'numeric',
        expectedAnswer: '1',
        explanation: '',
        knowledgePoint: 'limits',
        difficulty: 'intermediate',
        sourceRefs: [],
        hints: ['a', 'b', 'c'],
      },
    } as unknown as TutorSession
    await db.tutorSessions.put(session)
    const ai = {
      chatJSON: vi.fn(async () => ({
        data: {
          isCorrect: false,
          feedback: 'Not quite.',
          groundedExplanation: 'It is 1.',
          isSupplementary: false,
        },
        raw: { content: '' },
      })),
    } as unknown as AIService
    const recordFromAttempt = vi.fn(async () => undefined)
    const tutor = new TutorService({
      db,
      ai,
      mistakes: { recordFromAttempt } as unknown as MistakeService,
    })
    await tutor.submitAnswer('s1', '0')
    expect(recordFromAttempt).toHaveBeenCalledTimes(1)
    const [attempt] = recordFromAttempt.mock.calls[0] as unknown as [{ hintsUsed: number }]
    expect(attempt.hintsUsed).toBe(2)
  })
})

describe('custom target language', () => {
  it('is invalid only for a language course with a non-tag value', () => {
    expect(targetLanguageInvalid('language', 'português')).toBe(true)
    expect(targetLanguageInvalid('language', 'pt')).toBe(false)
    expect(targetLanguageInvalid('language', '')).toBe(false)
    expect(targetLanguageInvalid('medicine', 'português')).toBe(false)
  })
})
