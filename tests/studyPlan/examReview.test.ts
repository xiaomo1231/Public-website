import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { ExamReviewService, type ExamReviewAIPort } from '@/services/examReviewService'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentRepository } from '@/entities/document/repository'
import { createGenerationRun } from '@/shared/lib/generationControl'
import {
  planReviewSections,
  reviewSectionMarkdown,
  selectReviewChunks,
  validateReviewReply,
} from '@/entities/studyPlan/review'
import type { ChatMessage } from '@/infrastructure/ai/types'

describe('复习提纲 — pure helpers', () => {
  it('orders topics by marks share × weakness', () => {
    const sections = planReviewSections([
      { id: 'a', name: 'Strong', mastery: 0.9, openMistakes: 0 },
      { id: 'b', name: 'Weak', mastery: 0.2, openMistakes: 0 },
      { id: 'c', name: 'Heavy', mastery: 0.5, marksShare: 0.8, openMistakes: 0 },
    ])
    expect(sections.map((s) => s.title)).toEqual(['Heavy', 'Weak', 'Strong'])
    expect(sections.every((s) => s.status === 'pending')).toBe(true)
  })

  it('drops claims citing nothing that was sent, and mistakes without a source', () => {
    const chunks = new Map([
      ['c1', 'chunk-1'],
      ['c2', 'chunk-2'],
    ])
    const mistakes = new Map([['m1', 'mistake-1']])
    const reply = validateReviewReply(
      {
        summary: [
          { text: 'Eigenvalues solve det(A − λI) = 0.', sources: ['c1'] },
          { text: 'Invented claim.', sources: ['c9'] },
          { text: 'No source at all.' },
        ],
        keyPoints: [
          { kind: 'formula', text: '$\\det(A-\\lambda I)=0$', sources: ['[c2]', 'c1'] },
          { kind: 'weird', text: 'A fact.', sources: 'c2' },
        ],
        questionTypes: [{ text: 'Find the eigenvalues of a 2×2 matrix.', sources: ['chunk:c1'] }],
        commonMistakes: [
          { text: 'This may indicate a sign slip in λ.', mistakes: ['m1'] },
          { text: 'Made up.', mistakes: ['m7'] },
        ],
      },
      chunks,
      mistakes,
    )
    expect(reply.summary.map((c) => c.text)).toEqual(['Eigenvalues solve det(A − λI) = 0.'])
    expect(reply.keyPoints.map((p) => [p.kind, p.sources])).toEqual([
      ['formula', ['chunk-2', 'chunk-1']],
      ['fact', ['chunk-2']],
    ])
    expect(reply.questionTypes).toHaveLength(1)
    expect(reply.mistakes).toEqual([
      { text: 'This may indicate a sign slip in λ.', mistakeIds: ['mistake-1'] },
    ])
    expect(reply.dropped).toBe(3)
    expect(reply.cited.sort()).toEqual(['chunk-1', 'chunk-2'])
  })

  it('picks the topic’s own source chunks, then the best word matches', () => {
    const candidates = [
      { id: 'x', documentId: 'd', documentName: 'D', text: 'Kinematics of a ball', order: 0 },
      {
        id: 'y',
        documentId: 'd',
        documentName: 'D',
        text: 'Eigenvalues and eigenvectors',
        order: 1,
      },
      {
        id: 'z',
        documentId: 'd',
        documentName: 'D',
        text: 'Diagonalization uses eigenvalues',
        order: 2,
      },
    ]
    const picked = selectReviewChunks({ name: 'Eigenvalues', sourceChunkIds: ['z'] }, candidates, 3)
    expect(picked.map((c) => c.id)).toEqual(['z', 'y'])
  })

  it('renders a topic as Markdown with its sources', () => {
    const md = reviewSectionMarkdown(
      {
        id: 's1',
        title: 'T',
        order: 0,
        priority: 1,
        mastery: null,
        status: 'done',
        summary: [{ text: 'Sum.', sources: ['k'] }],
        keyPoints: [{ kind: 'definition', text: 'Def.', sources: ['k'] }],
        citations: { k: { chunkId: 'k', documentId: 'd', documentName: 'Book.pdf', page: 4 } },
      },
      {
        summary: 'Summary',
        keyPoints: 'Key',
        questionTypes: 'Q',
        mistakes: 'M',
        formula: 'Formula',
        definition: 'Definition',
        sources: 'Sources',
      },
    )
    expect(md).toContain('Sum. _(Book.pdf p. 4)_')
    expect(md).toContain('- Definition: Def.')
  })
})

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})
afterEach(() => db.close())

async function seed() {
  const project = await new ProjectService(db).create({
    name: 'Linear algebra',
    subject: 'linear_algebra',
  })
  const docs = new DocumentRepository(db)
  const book = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'Book.pdf',
    sizeBytes: 1,
    materialType: 'textbook',
    folderPath: 'Week 1',
  })
  await docs.update(book.id, { status: 'ready' })
  const topics = ['Eigenvalues', 'Determinants', 'Orthogonality']
  await db.table('courseAnalyses').put({
    id: `a-${project.id}`,
    projectId: project.id,
    status: 'ready',
    documentIds: [book.id],
    language: 'en',
  })
  await db.table('chunks').bulkPut([
    {
      id: 'ch-eig',
      documentId: book.id,
      projectId: project.id,
      materialType: 'textbook',
      pageNumber: 12,
      contentType: 'paragraph',
      text: 'Eigenvalues are the roots of det(A − λI) = 0.',
      sourceReference: 'Book.pdf · Page 12',
      order: 0,
    },
    {
      id: 'ch-det',
      documentId: book.id,
      projectId: project.id,
      materialType: 'textbook',
      pageNumber: 5,
      contentType: 'paragraph',
      text: 'Determinants measure volume; row swaps change the sign.',
      sourceReference: 'Book.pdf · Page 5',
      order: 1,
    },
  ])
  await db.table('topics').bulkPut(
    topics.map((name, i) => ({
      id: `t-${name}`,
      projectId: project.id,
      name,
      description: '',
      order: i,
      sourceRefs: [],
      ...(name === 'Eigenvalues' ? { sourceChunkIds: ['ch-eig'] } : {}),
      ...(name === 'Determinants' ? { sourceChunkIds: ['ch-det'] } : {}),
    })),
  )
  await db.table('mistakes').put({
    id: 'mis-1',
    projectId: project.id,
    topicId: 't-Eigenvalues',
    knowledgePoint: 'Eigenvalues',
    difficulty: 'intermediate',
    questionType: 'numeric',
    question: 'Eigenvalues of [[2,0],[0,3]]?',
    studentAnswer: '2',
    correctAnswer: '2, 3',
    mistakeType: 'incomplete',
    analysisStatus: 'none',
    status: 'active',
    source: 'quiz',
    attemptIds: [],
    attemptCount: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  const now = new Date(2026, 10, 2, 8).getTime()
  const [exam] = await new StudyPlanService({ db }).addExams(
    [{ projectId: project.id, name: 'Midterm', at: now + 10 * 86_400_000 }],
    now,
  )
  return { project, exam: exam!, now, book }
}

/** A fake model: answers per topic, cites what it was given (and one bogus alias). */
function fakeAI(options: { failTopic?: string; delayMs?: number } = {}) {
  let active = 0
  let peak = 0
  const prompts: string[] = []
  const port: ExamReviewAIPort = {
    concurrency: 2,
    async testConnection() {
      return { ok: true }
    },
    async chatJSON<T>(messages: ChatMessage[], opts?: { signal?: AbortSignal }) {
      const user = messages[1]!.content
      prompts.push(user)
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5))
      active -= 1
      if (opts?.signal?.aborted)
        throw Object.assign(new Error('aborted'), { code: 'ABORTED', name: 'AbortError' })
      const topic = /Topic: (.+)/.exec(user)?.[1]
      if (topic === options.failTopic)
        throw Object.assign(new Error('bad json'), { code: 'INVALID_JSON' })
      const hasMistake = user.includes('[m1]')
      return {
        data: {
          summary: [
            { text: `${topic} summary.`, sources: ['c1'] },
            { text: 'Unbacked.', sources: ['c42'] },
          ],
          keyPoints: [{ kind: 'definition', text: `${topic} definition.`, sources: ['c1'] }],
          questionTypes: [],
          commonMistakes: hasMistake ? [{ text: 'This may indicate…', mistakes: ['m1'] }] : [],
        } as T,
        raw: { content: '' } as never,
      }
    },
  }
  return { port, prompts, peak: () => peak }
}

describe('复习提纲 — service', () => {
  it('plans, generates through the pool, validates citations and feeds the plan', async () => {
    const { exam, now, project } = await seed()
    const ai = fakeAI()
    const service = new ExamReviewService({ db, ai: ai.port })
    const planned = await service.plan(exam.id, { now })
    expect(planned.review?.sections.map((s) => s.status)).toEqual(['pending', 'pending', 'pending'])
    expect(service.estimate(planned).requests).toBe(3)

    const result = await service.generate(exam.id, { now })
    const byTitle = new Map(result.review!.sections.map((s) => [s.title, s]))
    const eig = byTitle.get('Eigenvalues')!
    expect(eig.status).toBe('done')
    expect(eig.summary).toEqual([{ text: 'Eigenvalues summary.', sources: ['ch-eig'] }])
    expect(eig.citations?.['ch-eig']).toMatchObject({ documentName: 'Book.pdf', page: 12 })
    expect(eig.dropped).toBe(1)
    expect(eig.mistakes).toEqual([{ text: 'This may indicate…', mistakeIds: ['mis-1'] }])
    // A topic with no material anywhere fails without a request.
    const orth = byTitle.get('Orthogonality')!
    expect(orth.status).toBe('failed')
    expect(ai.prompts.some((p) => p.includes('Topic: Orthogonality'))).toBe(false)
    expect(result.review!.status).toBe('partial')
    // The prompt carries the chunk alias, not the chunk id, inside the untrusted block.
    const eigPrompt = ai.prompts.find((p) => p.includes('Topic: Eigenvalues'))!
    expect(eigPrompt).toContain('[c1 · Book.pdf p. 12]')
    expect(eigPrompt).not.toContain('ch-eig')
    expect(eigPrompt).toContain('UNTRUSTED CONTENT')
    expect(ai.peak()).toBeLessThanOrEqual(2)

    // Finished topics become 读复习提纲 tasks.
    await new StudyPlanService({ db }).replan(now)
    const sheetTasks = (await db.table('studyTasks').toArray()).filter(
      (task) => task.kind === 'review_sheet',
    )
    expect(sheetTasks).toHaveLength(2)
    expect(sheetTasks.every((task) => task.projectId === project.id)).toBe(true)
  })

  it('pauses between topics, continues with the rest, and retries one topic', async () => {
    const { exam, now } = await seed()
    const ai = fakeAI({ failTopic: 'Determinants', delayMs: 10 })
    ai.port.concurrency = 1
    const service = new ExamReviewService({ db, ai: ai.port })
    await service.plan(exam.id, { now })
    const run = createGenerationRun()
    let seen = 0
    await service.generate(exam.id, {
      now,
      control: run,
      onProgress: (row) => {
        if (row.review!.sections.some((s) => s.status === 'done') && seen++ === 0)
          run.requestPause()
      },
    })
    let row = await service.get(exam.id)
    const statuses = () => row.review!.sections.map((s) => [s.title, s.status])
    expect(row.review!.sections.filter((s) => s.status === 'done')).toHaveLength(1)
    expect(row.review!.sections.some((s) => s.status === 'pending')).toBe(true)
    expect(row.review!.status).toBe('paused')

    // 继续 does the rest: Determinants fails (bad reply), Orthogonality has no sources.
    const before = ai.prompts.length
    await service.generate(exam.id, { now })
    row = await service.get(exam.id)
    expect(ai.prompts.length - before).toBe(1)
    expect(statuses()).toEqual([
      ['Eigenvalues', 'done'],
      ['Determinants', 'failed'],
      ['Orthogonality', 'failed'],
    ])

    // Retry only that topic.
    const det = row.review!.sections.find((s) => s.title === 'Determinants')!
    const good = new ExamReviewService({ db, ai: fakeAI().port })
    await good.generate(exam.id, { now, sectionIds: [det.id] })
    row = await service.get(exam.id)
    expect(row.review!.sections.find((s) => s.title === 'Determinants')?.status).toBe('done')
    expect(row.review!.sections.find((s) => s.title === 'Orthogonality')?.status).toBe('failed')
  })

  it('uses only the exam’s picked materials (plus the topic’s own sources)', async () => {
    const { exam, now, project } = await seed()
    const docs = new DocumentRepository(db)
    const notes = await docs.create({
      projectId: project.id,
      type: 'text',
      name: 'Notes.txt',
      sizeBytes: 1,
      materialType: 'user_notes',
      folderPath: 'Review',
    })
    await docs.update(notes.id, { status: 'ready' })
    await db.table('chunks').put({
      id: 'ch-orth',
      documentId: notes.id,
      projectId: project.id,
      materialType: 'user_notes',
      contentType: 'paragraph',
      text: 'Orthogonality: vectors with zero dot product.',
      sourceReference: 'Notes.txt',
      order: 0,
    })
    await new StudyPlanService({ db }).updateExam(exam.id, {
      materials: { ...exam.materials, folderPaths: ['Review'] },
    })
    const ai = fakeAI()
    const service = new ExamReviewService({ db, ai: ai.port })
    await service.plan(exam.id, { now })
    const result = await service.generate(exam.id, { now })
    const orth = result.review!.sections.find((s) => s.title === 'Orthogonality')!
    expect(orth.status).toBe('done')
    expect(orth.citations?.['ch-orth']?.documentName).toBe('Notes.txt')
  })

  it('stops at a failed connection check before any request', async () => {
    const { exam, now } = await seed()
    const ai = fakeAI()
    ai.port.testConnection = async () => ({ ok: false, error: 'bad key' })
    const service = new ExamReviewService({ db, ai: ai.port })
    await service.plan(exam.id, { now })
    await expect(service.generate(exam.id, { now })).rejects.toMatchObject({
      code: 'PREFLIGHT_FAILED',
    })
    expect(ai.prompts).toHaveLength(0)
  })

  it('is exported with the exam and removed with the course', async () => {
    const { exam, now, project } = await seed()
    const service = new ExamReviewService({ db, ai: fakeAI().port })
    await service.plan(exam.id, { now })
    await service.generate(exam.id, { now })
    const { json } = await new DataManagementService(db).exportAll()
    const exported = json.exams as Array<{ id: string; review?: unknown }>
    expect(exported.find((row) => row.id === exam.id)?.review).toBeTruthy()
    const folderDocs = json.documents as Array<{ folderPath?: string }>
    expect(folderDocs.some((row) => row.folderPath === 'Week 1')).toBe(true)
    await new DataManagementService(db).deleteProject(project.id)
    expect(await db.table('exams').get(exam.id)).toBeUndefined()
  })
})
