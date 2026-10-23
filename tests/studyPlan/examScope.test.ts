import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import {
  ExamReviewService,
  spreadChunks,
  type ExamReviewAIPort,
} from '@/services/examReviewService'
import { AiMockPaperService } from '@/services/aiMockPaperService'
import { DocumentRepository } from '@/entities/document/repository'
import type { Document } from '@/entities/document/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import type { ChatMessage } from '@/infrastructure/ai/types'
import {
  chapterKeysOf,
  chapterOptionsFrom,
  chaptersScopeFromKeys,
  parseChapterRef,
  topicsInChapters,
  topicsFromMaterials,
} from '@/entities/studyPlan/scope'
import { EMPTY_MATERIALS, type PlannedExam } from '@/entities/studyPlan/types'
import { taskLink } from '@/widgets/studyPlan/taskLinks'
import { scopeLabel } from '@/widgets/studyPlan/scopeLabels'
import { translate } from '@/i18n/translate'

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})
afterEach(() => db.close())

const NOW = new Date(2026, 10, 2, 8).getTime()

/** ECON 110: a structured textbook (2 chapters, one section) and a slide deck, no analysis. */
async function seed() {
  const project = await new ProjectService(db).create({ name: 'ECON 110', subject: 'economics' })
  const docs = new DocumentRepository(db)
  const book = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'Book.pdf',
    sizeBytes: 1,
    materialType: 'textbook',
  })
  await docs.update(book.id, { status: 'ready' })
  const slides = await docs.create({
    projectId: project.id,
    type: 'pptx',
    name: 'Lecture 1.pptx',
    sizeBytes: 1,
    materialType: 'textbook',
  })
  await docs.update(slides.id, { status: 'ready', metadata: { slideCount: 20 } })
  const midterm = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'Midterm 2024.pdf',
    sizeBytes: 1,
    materialType: 'past_exam',
  })
  await docs.update(midterm.id, { status: 'ready' })
  await db.table('courseStructures').bulkPut([
    {
      id: 'st-book',
      projectId: project.id,
      sourceDocumentId: book.id,
      title: 'Book.pdf',
      confidence: 'high',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'st-slides',
      projectId: project.id,
      sourceDocumentId: slides.id,
      title: 'Lecture 1.pptx',
      confidence: 'low',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  const node = (id: string, structureId: string, extra: Record<string, unknown>) => ({
    id,
    structureId,
    projectId: project.id,
    confidence: 'high',
    sourceChunkIds: [],
    ...extra,
  })
  await db.table('courseStructureNodes').bulkPut([
    node('n1', 'st-book', {
      type: 'chapter',
      number: '1',
      title: 'Supply and demand',
      order: 0,
      depth: 0,
      sourcePageStart: 1,
      sourcePageEnd: 4,
      sourceChunkIds: ['c1'],
    }),
    node('n1s', 'st-book', {
      type: 'section',
      parentId: 'n1',
      number: '1.1',
      title: 'Elasticity',
      order: 1,
      depth: 1,
      sourcePageStart: 3,
      sourcePageEnd: 4,
      sourceChunkIds: ['c2'],
    }),
    node('n2', 'st-book', {
      type: 'chapter',
      number: '2',
      title: 'Taxes',
      order: 2,
      depth: 0,
      sourcePageStart: 5,
      sourcePageEnd: 8,
      sourceChunkIds: ['c3'],
    }),
    node('ns', 'st-slides', {
      type: 'chapter',
      title: 'General Course Material',
      order: 0,
      depth: 0,
      confidence: 'low',
      sourceChunkIds: ['s1'],
    }),
  ])
  const chunk = (id: string, documentId: string, order: number, text: string, extra = {}) => ({
    id,
    documentId,
    projectId: project.id,
    materialType: 'textbook',
    pageNumber: order + 1,
    contentType: 'paragraph',
    text,
    sourceReference: '',
    order,
    ...extra,
  })
  await db
    .table('chunks')
    .bulkPut([
      chunk('c1', book.id, 0, 'Demand curves slope downward.', { chapterId: 'n1' }),
      chunk('c2', book.id, 1, 'Price elasticity of demand.', { chapterId: 'n1', sectionId: 'n1s' }),
      chunk('c3', book.id, 2, 'A tax drives a wedge between prices.', { chapterId: 'n2' }),
      chunk('s1', slides.id, 0, 'Lecture 1: opportunity cost.'),
    ])
  return { project, book, slides, midterm }
}

async function addTopics(projectId: string, bookId: string, slidesId: string) {
  await db.table('courseAnalyses').put({
    id: `a-${projectId}`,
    projectId,
    status: 'ready',
    documentIds: [bookId, slidesId],
    language: 'en',
  })
  const topic = (id: string, name: string, extra: Partial<Topic>) => ({
    id,
    projectId,
    name,
    description: '',
    order: 0,
    sourceRefs: [],
    ...extra,
  })
  await db.table('topics').bulkPut([
    topic('t-demand', 'Demand', { chapterId: 'n1', sourceChunkIds: ['c1'] }),
    topic('t-elastic', 'Elasticity', {
      chapterId: 'n1',
      sectionId: 'n1s',
      sourceChunkIds: ['c2'],
    }),
    topic('t-tax', 'Taxes', { chapterId: 'n2', sourceChunkIds: ['c3'] }),
    topic('t-opp', 'Opportunity cost', { sourceChunkIds: ['s1'] }),
  ])
}

async function addExam(projectId: string, scope: PlannedExam['scope'], documentIds: string[] = []) {
  const [exam] = await new StudyPlanService({ db }).addExams(
    [
      {
        projectId,
        name: 'Midterm',
        at: NOW + 10 * 86_400_000,
        scope,
        materials: { documentIds },
      },
    ],
    NOW,
  )
  return exam!
}

describe('exam scope by chapters / materials — pure', () => {
  it('lists chapters and sections, and a file without a structure as one row', async () => {
    const { project, book, slides, midterm } = await seed()
    const documents = (await db.table('documents').toArray()) as Document[]
    const nodes = await db.table('courseStructureNodes').toArray()
    const structures = (await db.table('courseStructures').toArray()).map((structure) => ({
      structure,
      nodes: nodes.filter((n) => n.structureId === structure.id),
    }))
    const options = chapterOptionsFrom(documents, structures)
    expect(options.map((o) => o.key)).toEqual(
      expect.arrayContaining(['chapter:n1', 'section:n1s', 'chapter:n2', `file:${slides.id}`]),
    )
    expect(options.some((o) => o.documentId === midterm.id)).toBe(false)
    const ch1 = options.find((o) => o.key === 'chapter:n1')!
    expect(ch1.chunkIds).toEqual(['c1', 'c2'])
    expect(ch1.pageStart).toBe(1)
    expect(ch1.pageEnd).toBe(4)
    expect(options.find((o) => o.key === 'section:n1s')?.parentKey).toBe('chapter:n1')
    void project
    void book
  })

  it('round-trips draft keys and labels the scope', () => {
    const scope = chaptersScopeFromKeys(['chapter:n1', 'section:n2s', 'file:d1'])
    expect(scope).toEqual({
      kind: 'chapters',
      chapterIds: ['n1'],
      sectionIds: ['n2s'],
      documentIds: ['d1'],
    })
    expect(chapterKeysOf(scope)).toEqual(['chapter:n1', 'section:n2s', 'file:d1'])
    const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate('zh-CN', key, params)
    expect(scopeLabel(scope, t)).toBe('按章节（3）')
    expect(scopeLabel({ kind: 'materials' }, t)).toBe('按所选资料')
    expect(scopeLabel({ kind: 'course' }, t)).toBe('整门课')
    expect(parseChapterRef('chapter:d1:n1')).toEqual({ documentId: 'd1', nodeId: 'n1' })
    expect(taskLink({ kind: 'review_material', projectId: 'p', refId: 'chapter:d1:n1' })).toBe(
      '/projects/p/documents/d1',
    )
  })

  it('selects topics by chapter, section, file and verified sources', () => {
    const topics = [
      { id: 'a', chapterId: 'n1', sourceRefs: [] },
      { id: 'b', sectionId: 's9', sourceRefs: [] },
      { id: 'c', sourceChapterIds: ['n2'], sourceRefs: [] },
      { id: 'd', sourceChunkIds: ['x'], sourceRefs: [] },
      { id: 'e', sourceRefs: [{ documentId: 'd2', documentName: '' }] },
    ] as unknown as Topic[]
    const chunkDoc = new Map([['x', 'd1']])
    const ids = (list: Topic[]) => list.map((t) => t.id)
    expect(
      ids(topicsInChapters(chaptersScopeFromKeys(['chapter:n2', 'section:s9']), topics, chunkDoc)),
    ).toEqual(['b', 'c'])
    expect(ids(topicsInChapters(chaptersScopeFromKeys(['file:d1']), topics, chunkDoc))).toEqual([
      'd',
    ])
    expect(ids(topicsFromMaterials(new Set(['d1', 'd2']), topics, chunkDoc))).toEqual(['d', 'e'])
  })

  it('spreads a chapter’s chunks evenly', () => {
    expect(spreadChunks([1, 2, 3], 8)).toEqual([1, 2, 3])
    expect(spreadChunks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8])
  })
})

describe('exam scope by chapters / materials — planner, review sheet, AI mock', () => {
  it('offers chapters before analysis and explains what is missing', async () => {
    const { project } = await seed()
    const options = await new StudyPlanService({ db }).courseOptions(project.id)
    expect(options.chapters.length).toBeGreaterThan(0)
    expect(options.topics).toEqual([])
    expect(options.scopes).toEqual([])
    expect(options.analysis).toBe('none')
    expect(options.hasSyllabus).toBe(false)
  })

  it('without analysis: schedules a 复习资料 task per chosen chapter / file', async () => {
    const { project, book, slides } = await seed()
    const service = new StudyPlanService({ db })
    const exam = await addExam(
      project.id,
      chaptersScopeFromKeys(['chapter:n1', 'section:n1s', `file:${slides.id}`]),
    )
    const context = await service.examContext(exam.id, NOW)
    expect(context.topics).toEqual([])
    // The section is inside the chosen chapter: one unit for chapter 1.
    expect(context.scopeUnits.map((u) => u.id).sort()).toEqual(
      [`chapter:${book.id}:n1`, slides.id].sort(),
    )
    await service.replan(NOW)
    const tasks = await db.table('studyTasks').where('examId').equals(exam.id).toArray()
    const refs = tasks.filter((t) => t.kind === 'review_material').map((t) => t.refId)
    expect(refs).toEqual(expect.arrayContaining([`chapter:${book.id}:n1`, slides.id]))
    expect(tasks.some((t) => t.kind === 'learn')).toBe(false)
  })

  it('without analysis: the materials scope plans the picked files; nothing picked = whole course', async () => {
    const { project, slides } = await seed()
    const service = new StudyPlanService({ db })
    const exam = await addExam(project.id, { kind: 'materials' }, [slides.id])
    const context = await service.examContext(exam.id, NOW)
    expect(context.reviewDocs.map((d) => d.id)).toEqual([slides.id])
    expect(context.scopeUnits.map((u) => u.id)).toEqual([slides.id])
  })

  it('with analysis: topics come from the chosen chapters / files', async () => {
    const { project, book, slides } = await seed()
    await addTopics(project.id, book.id, slides.id)
    const service = new StudyPlanService({ db })
    const byChapter = await addExam(project.id, chaptersScopeFromKeys(['chapter:n1']))
    expect((await service.examContext(byChapter.id, NOW)).topics.map((t) => t.id)).toEqual([
      't-demand',
      't-elastic',
    ])
    const bySection = await addExam(project.id, chaptersScopeFromKeys(['section:n1s']))
    expect((await service.examContext(bySection.id, NOW)).topics.map((t) => t.id)).toEqual([
      't-elastic',
    ])
    const byFiles = await addExam(project.id, { kind: 'materials' }, [slides.id])
    const ctx = await service.examContext(byFiles.id, NOW)
    expect(ctx.topics.map((t) => t.id)).toEqual(['t-opp'])
    // Topics exist: no per-file unit task beyond the picked review file itself.
    const none = await addExam(project.id, { kind: 'materials' })
    expect((await service.examContext(none.id, NOW)).topics).toHaveLength(4)

    const mock = new AiMockPaperService({ ai: null, db }) as unknown as {
      scopeTopics(p: string, e: PlannedExam, s: undefined): Promise<Array<{ id: string }>>
    }
    expect((await mock.scopeTopics(project.id, byChapter, undefined)).map((t) => t.id)).toEqual([
      't-demand',
      't-elastic',
    ])
    expect((await mock.scopeTopics(project.id, byFiles, undefined)).map((t) => t.id)).toEqual([
      't-opp',
    ])
  })

  it('复习提纲 without analysis: one section per chapter, written from its own chunks', async () => {
    const { project, book } = await seed()
    const exam = await addExam(project.id, chaptersScopeFromKeys(['chapter:n2', 'chapter:n1']))
    const prompts: string[] = []
    const ai: ExamReviewAIPort = {
      async testConnection() {
        return { ok: true }
      },
      async chatJSON<T>(messages: ChatMessage[]) {
        prompts.push(messages[1]!.content)
        return {
          data: { summary: [{ text: 'Summary.', sources: ['c1'] }], keyPoints: [] } as T,
          raw: { content: '' } as never,
        }
      },
    }
    const service = new ExamReviewService({ db, ai })
    const planned = await service.plan(exam.id, { now: NOW })
    const sections = planned.review!.sections
    expect(sections.map((s) => s.topicId).sort()).toEqual(
      [`unit:chapter:${book.id}:n1`, `unit:chapter:${book.id}:n2`].sort(),
    )
    const done = await service.generate(exam.id, { now: NOW })
    expect(done.review!.sections.every((s) => s.status === 'done')).toBe(true)
    const ch1 = prompts.find((p) => p.includes('Supply and demand'))!
    expect(ch1).toContain('Demand curves slope downward.')
    expect(ch1).toContain('Price elasticity of demand.')
    expect(ch1).not.toContain('A tax drives a wedge')
  })

  it('keeps old rows (course / syllabus / topics) as they were', async () => {
    const { project, book, slides } = await seed()
    await addTopics(project.id, book.id, slides.id)
    const service = new StudyPlanService({ db })
    const course = await addExam(project.id, { kind: 'course' })
    const ctx = await service.examContext(course.id, NOW)
    expect(ctx.topics).toHaveLength(4)
    expect(ctx.scopeUnits).toEqual([])
    const picked = await addExam(project.id, { kind: 'topics', topicIds: ['t-tax'] })
    expect((await service.examContext(picked.id, NOW)).topics.map((t) => t.id)).toEqual(['t-tax'])
  })
})

describe('editing a saved exam', () => {
  it('updates the row in place, keeps task ids, and re-plans for the new scope', async () => {
    const { project, book, slides } = await seed()
    const service = new StudyPlanService({ db })
    const exam = await addExam(
      project.id,
      chaptersScopeFromKeys(['chapter:n1', `file:${slides.id}`]),
    )
    await service.replan(NOW)
    const before = await db.table('studyTasks').where('examId').equals(exam.id).toArray()
    expect(before.length).toBeGreaterThan(0)

    // Name / place / length only: same tasks, same ids.
    const renamed = await service.updateExam(
      exam.id,
      { name: 'Midterm 1', location: 'Room 210', durationMinutes: 90 },
      NOW,
    )
    expect(renamed).toMatchObject({ name: 'Midterm 1', location: 'Room 210', durationMinutes: 90 })
    expect(renamed.projectId).toBe(project.id)
    expect(await db.table('exams').count()).toBe(1)
    await service.replan(NOW + 60_000)
    const after = await db.table('studyTasks').where('examId').equals(exam.id).toArray()
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort())

    // A new scope: the plan follows it; the chapter-1 task keeps its id.
    const ch1 = after.find((t) => t.refId === `chapter:${book.id}:n1`)!
    await service.updateExam(exam.id, { scope: chaptersScopeFromKeys(['chapter:n1']) }, NOW)
    await service.replan(NOW + 120_000)
    const moved = await db.table('studyTasks').where('examId').equals(exam.id).toArray()
    expect(moved.some((t) => t.refId === slides.id)).toBe(false)
    expect(moved.find((t) => t.refId === `chapter:${book.id}:n1`)?.id).toBe(ch1.id)
  })

  it('marks the review sheet outdated when the scope or materials change (kept until laid out again)', async () => {
    const { project, book, slides } = await seed()
    const service = new StudyPlanService({ db })
    const exam = await addExam(project.id, chaptersScopeFromKeys(['chapter:n1']))
    const review = new ExamReviewService({ db, ai: null })
    await review.plan(exam.id, { now: NOW })

    await service.updateExam(exam.id, { name: 'Renamed' }, NOW)
    expect((await service.getExam(exam.id))?.review?.scopeChangedAt).toBeUndefined()

    await service.updateExam(exam.id, { scope: chaptersScopeFromKeys(['chapter:n2']) }, NOW + 1)
    const changed = (await service.getExam(exam.id))!
    expect(changed.review?.scopeChangedAt).toBe(NOW + 1)
    expect(changed.review?.sections.map((s) => s.topicId)).toEqual([`unit:chapter:${book.id}:n1`])

    const relaid = await review.plan(exam.id, { now: NOW, replace: true })
    expect(relaid.review?.scopeChangedAt).toBeUndefined()
    expect(relaid.review?.sections.map((s) => s.topicId)).toEqual([`unit:chapter:${book.id}:n2`])

    await service.updateExam(
      exam.id,
      { materials: { ...EMPTY_MATERIALS, documentIds: [slides.id] } },
      NOW + 2,
    )
    expect((await service.getExam(exam.id))?.review?.scopeChangedAt).toBe(NOW + 2)
  })

  it('AI mock defaults follow the edited scope', async () => {
    const { project, book, slides } = await seed()
    await addTopics(project.id, book.id, slides.id)
    const service = new StudyPlanService({ db })
    const exam = await addExam(project.id, chaptersScopeFromKeys(['chapter:n1']))
    const mock = new AiMockPaperService({ ai: null, db }) as unknown as {
      scopeTopics(p: string, e: PlannedExam, s: undefined): Promise<Array<{ id: string }>>
    }
    const edited = await service.updateExam(exam.id, {
      scope: chaptersScopeFromKeys(['chapter:n2']),
    })
    expect((await mock.scopeTopics(project.id, edited, undefined)).map((t) => t.id)).toEqual([
      't-tax',
    ])
  })
})
