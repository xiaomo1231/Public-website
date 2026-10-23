import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { ExamReviewService, type ExamReviewAIPort } from '@/services/examReviewService'
import { DocumentService } from '@/services/documentService'
import { DocumentRepository } from '@/entities/document/repository'
import { isReferenceOnlyMaterial, type LearningMaterialType } from '@/entities/document/types'
import { isReviewMaterial } from '@/entities/studyPlan/materials'
import { buildSuggestion, pendingSuggestion } from '@/entities/document/materialSuggestion'
import {
  buildReviewOverview,
  defaultReviewSources,
  effectiveReviewSources,
  mergeUnits,
  reviewSourceGroupOf,
  sectionsFromPoints,
  validateOutlineReply,
  type OutlineQuestion,
} from '@/entities/studyPlan/reviewOutline'
import {
  reviewSectionMarkdown,
  validateReviewReply,
  type ReviewQuestionRef,
} from '@/entities/studyPlan/review'
import type { ChatMessage } from '@/infrastructure/ai/types'

const PARAGRAPH =
  'The trade war has hidden costs that keep growing as tariffs bite. Importers have passed most of the levy to their customers. Researchers who studied the data found prices rose almost one for one. Some firms moved production to other countries rather than pay. That shifted supply chains but did little for jobs at home.'
const ARTICLE = Array.from({ length: 6 }, () => PARAGRAPH)

describe('reading material (阅读材料)', () => {
  it('is reference only and never review material or a source group of its own kind', () => {
    expect(isReferenceOnlyMaterial('reading')).toBe(true)
    expect(isReviewMaterial({ materialType: 'reading', status: 'ready' })).toBe(false)
    expect(reviewSourceGroupOf('reading')).toBe('reading')
    expect(reviewSourceGroupOf('walkthrough_import')).toBeNull()
  })

  it('suggests reading for an article uploaded as textbook, never for slides or a lecture', () => {
    const chunks = ARTICLE.map((text, i) => ({
      text,
      contentType: 'paragraph' as const,
      pageNumber: i + 1,
    }))
    const article = buildSuggestion(
      { name: 'The Economist - Tariffs.pdf', type: 'pdf', materialType: 'textbook' },
      [{ text: 'The Economist | Finance & economics', pageNumber: 1 }, ...chunks],
      1,
    )
    expect(article?.type).toBe('reading')
    expect(article?.reasons).toEqual(expect.arrayContaining(['publisher', 'articleProse']))
    expect(
      pendingSuggestion({
        status: 'ready',
        materialType: 'textbook',
        suggestedMaterialType: article!,
      }),
    ).toBeTruthy()

    const slides = buildSuggestion(
      { name: 'Lecture 3 tariffs.pptx', type: 'pptx', materialType: 'textbook' },
      [
        { text: 'Chapter 3: Tariffs', contentType: 'heading', pageNumber: 1 },
        { text: 'Source: The Economist', pageNumber: 2 },
        ...chunks,
      ],
      1,
    )
    expect(slides?.type).not.toBe('reading')

    const lecture = buildSuggestion(
      { name: 'Chapter 4.pdf', type: 'pdf', materialType: 'textbook' },
      [
        { text: 'Chapter 4 Elasticity', contentType: 'heading', pageNumber: 1 },
        { text: 'Learning objectives', contentType: 'heading', pageNumber: 1 },
        { text: 'Section 4.1 Price elasticity', contentType: 'heading', pageNumber: 2 },
        ...chunks,
      ],
      1,
    )
    expect(lecture?.type ?? null).not.toBe('reading')
  })
})

describe('复习提纲 sources (用哪些资料)', () => {
  const doc = (id: string, materialType: LearningMaterialType, extra: object = {}) => ({
    id,
    name: `${id}.pdf`,
    materialType,
    status: 'ready',
    ...extra,
  })
  const docs = [
    doc('slides', 'textbook'),
    doc('notes', 'user_notes'),
    doc('paper', 'past_exam'),
    doc('key', 'homework_answer'),
    doc('hw', 'homework'),
    doc('practice', 'professor_practice'),
    doc('article', 'reading'),
    doc('outline', 'syllabus'),
    doc('import', 'walkthrough_import'),
    doc('held', 'textbook', { evalRole: 'independent' }),
    doc('busy', 'textbook', { status: 'processing' }),
  ]

  it('checks lectures, papers, answers, homework and practice; leaves reading and the syllabus out', () => {
    expect(defaultReviewSources(docs).sort()).toEqual(
      ['hw', 'key', 'notes', 'paper', 'practice', 'slides'].sort(),
    )
  })

  it('keeps to the exam’s picked files, adding the course’s lectures when none is picked', () => {
    expect(defaultReviewSources(docs, new Set(['paper', 'article'])).sort()).toEqual(
      ['notes', 'paper', 'slides'].sort(),
    )
    expect(defaultReviewSources(docs, new Set(['paper', 'slides'])).sort()).toEqual(
      ['paper', 'slides'].sort(),
    )
  })

  it('uses a stored choice, dropping files that can no longer be chosen', () => {
    expect(
      effectiveReviewSources({ documentIds: ['article', 'held', 'gone', 'slides'] }, docs),
    ).toEqual(['article', 'slides'])
  })
})

describe('复习提纲 outline — pure helpers', () => {
  const ref = (id: string, marks?: number): ReviewQuestionRef => ({
    questionId: id,
    setId: 'set',
    documentId: 'paper',
    paper: 'Midterm 2024',
    number: id.replace('q-', ''),
    ...(marks !== undefined ? { marks } : {}),
    kind: 'past',
  })

  it('keeps closed-set aliases, drops empty points, merges equal titles, caps at 15', () => {
    const chunks = new Map([
      ['c1', 'ch-1'],
      ['c2', 'ch-2'],
    ])
    const questions = new Map([['q1', 'q-1']])
    const topics = new Map([['t1', 'topic-1']])
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `Extra ${i}`, chunks: ['c1'] }))
    const { points, dropped } = validateOutlineReply(
      {
        points: [
          { title: 'Tariffs', topic: 't1', chunks: ['c1', 'c9'], questions: ['q1'] },
          { title: 'tariffs', chunks: ['c2'] },
          { title: 'Invented', chunks: ['c42'], questions: ['q7'] },
          { title: '', chunks: ['c1'] },
          ...many,
        ],
      },
      { chunks, questions, topics },
    )
    expect(points).toHaveLength(15)
    expect(points[0]).toEqual({
      title: 'Tariffs',
      topicId: 'topic-1',
      chunkIds: ['ch-1', 'ch-2'],
      questionIds: ['q-1'],
    })
    expect(points.some((p) => p.title === 'Invented')).toBe(false)
    expect(dropped).toBe(2 + 6)
  })

  it('orders points by exam marks and keeps their questions’ labels', () => {
    const refs = new Map([
      ['q-1', ref('q-1', 2)],
      ['q-2', ref('q-2', 10)],
    ])
    const sections = sectionsFromPoints(
      [
        { title: 'Light', chunkIds: ['a'], questionIds: ['q-1'] },
        { title: 'Heavy', chunkIds: ['b'], questionIds: ['q-2'] },
        { title: 'Untested', chunkIds: ['c'], questionIds: [] },
      ],
      refs,
    )
    expect(sections.map((s) => s.title)).toEqual(['Heavy', 'Light', 'Untested'])
    expect(sections[0]!.topicId).toMatch(/^kp:/)
    expect(sections[0]!.questionRefs?.['q-2']?.marks).toBe(10)
  })

  it('merges chapters / files with the same title (local fallback)', () => {
    const groups = mergeUnits([
      { id: 'a', title: 'Elasticity' },
      { id: 'b', title: 'Tariffs' },
      { id: 'c', title: 'elasticity.pdf' },
    ])
    expect(groups.map((g) => g.units.map((u) => u.id))).toEqual([['a', 'c'], ['b']])
  })

  it('validates v2 replies: questions closed set, marking quoted verbatim from the answer', () => {
    const reply = validateReviewReply(
      {
        summary: [{ text: 'A tariff is a tax on imports.', sources: ['c1'] }],
        examQuestions: [
          { questions: ['q1'], text: 'Asks for the deadweight loss.' },
          { questions: ['q9'], text: 'Unknown question.' },
          { questions: ['q1'], text: 'Same question again.' },
        ],
        marking: [
          {
            answer: 'a1',
            quote: 'DWL  = ½ × 10 × 4 (2 marks)',
            text: 'Two marks for the triangle.',
          },
          { answer: 'a1', quote: 'Made-up marking line', text: 'x' },
          { answer: 'a7', quote: 'DWL', text: 'x' },
        ],
      },
      new Map([['c1', 'ch-1']]),
      new Map(),
      {
        questions: new Map([['q1', 'q-1']]),
        answers: new Map([
          ['a1', { questionId: 'q-1', text: 'Correct graph.\nDWL = ½ × 10 × 4 (2 marks)' }],
        ]),
      },
    )
    expect(reply.examQuestions).toEqual([
      { text: 'Asks for the deadweight loss.', questionIds: ['q-1'] },
    ])
    expect(reply.marking).toEqual([
      {
        text: 'Two marks for the triangle.',
        quote: 'DWL  = ½ × 10 × 4 (2 marks)',
        questionIds: ['q-1'],
      },
    ])
    expect(reply.dropped).toBe(4)
    const md = reviewSectionMarkdown(
      {
        id: 's1',
        title: 'Tariffs',
        order: 0,
        priority: 1,
        mastery: null,
        status: 'done',
        examQuestions: reply.examQuestions,
        marking: reply.marking,
        questionRefs: { 'q-1': ref('q-1', 6) },
      },
      {
        summary: 'S',
        keyPoints: 'K',
        questionTypes: 'Q',
        mistakes: 'M',
        formula: 'F',
        definition: 'D',
        sources: 'Src',
        examQuestions: 'Past questions',
        marking: 'Marking',
      },
    )
    expect(md).toContain('**Past questions**')
    expect(md).toContain('Midterm 2024 Q1 (6 marks): Asks for the deadweight loss.')
    expect(md).toContain('“DWL  = ½ × 10 × 4 (2 marks)”')
  })

  it('computes the 考试概览 locally: kinds, marks and the most-tested points', () => {
    const q = (id: string, text: string, marks?: number): OutlineQuestion => ({
      questionId: id,
      text,
      ref: ref(id, marks),
    })
    const questions = [
      q('q-1', 'Calculate the deadweight loss of the tariff. (6 marks)', 6),
      q('q-2', 'Explain why a quota creates rents. (4 marks)', 4),
      q('q-3', 'Which is true?\n(A) one\n(B) two\n(C) three', undefined),
    ]
    const overview = buildReviewOverview(questions, [
      { id: 's1', title: 'Quotas', questionIds: ['q-2'], questionRefs: { 'q-2': ref('q-2', 4) } },
      {
        id: 's2',
        title: 'Tariffs',
        questionIds: ['q-1', 'q-3'],
        questionRefs: { 'q-1': ref('q-1', 6), 'q-3': ref('q-3') },
      },
    ])
    expect(overview).toMatchObject({
      papers: 1,
      questions: 3,
      questionsWithMarks: 2,
      totalMarks: 10,
    })
    expect(Object.fromEntries(overview.byKind.map((k) => [k.kind, k.questions]))).toEqual({
      multiple_choice: 1,
      calculation: 1,
      explain: 1,
    })
    expect(overview.topPoints.map((p) => [p.title, p.marks, p.questions])).toEqual([
      ['Tariffs', 6, 2],
      ['Quotas', 4, 1],
    ])
  })
})

// ── service ────────────────────────────────────────────────────────────────

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})
afterEach(() => db.close())

const NOW = new Date(2026, 10, 2, 8).getTime()

async function seed() {
  const project = await new ProjectService(db).create({ name: 'ECON 111', subject: 'economics' })
  const docs = new DocumentRepository(db)
  const make = async (name: string, materialType: LearningMaterialType, type = 'pdf') => {
    const doc = await docs.create({
      projectId: project.id,
      type: type as 'pdf',
      name,
      sizeBytes: 1,
      materialType,
    })
    await docs.update(doc.id, { status: 'ready' })
    return doc
  }
  const deck1 = await make('Lecture 5 Trade.pptx', 'textbook', 'pptx')
  const deck2 = await make('Lecture 6 Trade policy.pptx', 'textbook', 'pptx')
  const article = await make('Economist tariffs.pdf', 'reading')
  const paper = await make('Midterm 2024.pdf', 'past_exam')
  const key = await make('Midterm 2024 answers.pdf', 'homework_answer')
  const chunk = (id: string, documentId: string, page: number, text: string, order: number) => ({
    id,
    documentId,
    projectId: project.id,
    materialType: 'textbook',
    pageNumber: page,
    contentType: 'paragraph',
    text,
    sourceReference: '',
    order,
  })
  await db.table('chunks').bulkPut([
    chunk('d1-1', deck1.id, 1, 'Gains from trade\nComparative advantage explains trade.', 0),
    chunk('d1-2', deck1.id, 2, 'Tariffs\nA tariff raises the domestic price.', 1),
    chunk('d1-3', deck1.id, 2, 'The tariff creates a deadweight loss.', 2),
    chunk('d2-1', deck2.id, 1, 'Tariffs and quotas\nA quota limits imports and creates rents.', 0),
    chunk('d2-2', deck2.id, 2, 'Who gains from a tariff?\nProducers gain surplus.', 1),
    {
      ...chunk('ar-1', article.id, 1, 'Trade war costs\nAn essay about tariffs.', 0),
      materialType: 'reading',
    },
    {
      ...chunk('p-1', paper.id, 1, 'Q1. Calculate the deadweight loss of the tariff. (6 marks)', 0),
      materialType: 'past_exam',
    },
  ])
  await db.table('homeworkSets').put({
    id: 'set-1',
    projectId: project.id,
    documentId: paper.id,
    documentName: paper.name,
    title: 'Midterm 2024',
    status: 'ready',
    language: 'en',
    questionCount: 2,
    promptVersion: 'v1',
    kind: 'exam',
    answerDocumentId: key.id,
    createdAt: 1,
    updatedAt: 1,
  })
  const question = (id: string, order: number, prompt: string, answerText?: string) => ({
    id,
    projectId: project.id,
    setId: 'set-1',
    documentId: paper.id,
    documentName: paper.name,
    order,
    number: String(order + 1),
    prompt,
    sourceRefs: [{ documentId: paper.id, documentName: paper.name, page: 1, chunkId: 'p-1' }],
    hints: [],
    generationStatus: 'ready',
    promptVersion: 'v1',
    ...(answerText ? { answerText, answerStatus: 'matched' } : {}),
  })
  await db
    .table('homeworkQuestions')
    .bulkPut([
      question(
        'hq-1',
        0,
        'Calculate the deadweight loss of the tariff. (6 marks)',
        'DWL = ½ × 10 × 4 = 20 (2 marks for the triangle)',
      ),
      question('hq-2', 1, 'Explain why a quota creates rents. (4 marks)'),
    ])
  const [exam] = await new StudyPlanService({ db }).addExams(
    [{ projectId: project.id, name: 'Midterm', at: NOW + 10 * 86_400_000 }],
    NOW,
  )
  return { project, exam: exam!, deck1, deck2, article, paper, key }
}

function fakeAI() {
  const prompts: Array<{ system: string; user: string }> = []
  const port: ExamReviewAIPort = {
    concurrency: 2,
    async testConnection() {
      return { ok: true }
    },
    async chatJSON<T>(messages: ChatMessage[]) {
      const system = messages[0]!.content as string
      const user = messages[1]!.content as string
      prompts.push({ system, user })
      if (system.includes('lay out the knowledge points')) {
        // Tariffs is taught in both decks and asked in the paper.
        const alias = (text: string) =>
          new RegExp(`\\[(c\\d+) · [^\\]]+\\] ${text}$`, 'm').exec(user)?.[1]
        return {
          data: {
            points: [
              {
                title: 'Tariffs',
                chunks: [alias('Tariffs'), alias('Tariffs and quotas'), 'c99'],
                questions: ['q1', 'q2'],
              },
              { title: 'Gains from trade', chunks: [alias('Gains from trade')], questions: [] },
            ],
          } as T,
          raw: { content: '' } as never,
        }
      }
      return {
        data: {
          summary: [{ text: 'A tariff is a tax on imports.', sources: ['c1'] }],
          keyPoints: [],
          questionTypes: [{ text: 'DWL calculations.', sources: ['q1'] }],
          examQuestions: user.includes('[q1')
            ? [{ questions: ['q1'], text: 'DWL of a tariff.' }]
            : [],
          marking: user.includes('[a1')
            ? [{ answer: 'a1', quote: '2 marks for the triangle', text: 'Marks for the triangle.' }]
            : [],
          commonMistakes: [],
        } as T,
        raw: { content: '' } as never,
      }
    },
  }
  return { port, prompts }
}

describe('复习提纲 — consolidated service', () => {
  it('lays out knowledge points across files from one outline request, not one per file', async () => {
    const { exam, deck1, deck2, article } = await seed()
    const ai = fakeAI()
    const service = new ExamReviewService({ db, ai: ai.port })
    const options = await service.sourceOptions(exam.id)
    expect(options.selected).not.toContain(article.id)
    expect(options.options.find((o) => o.id === article.id)?.group).toBe('reading')

    const planned = await service.plan(exam.id, { now: NOW, useAI: true })
    expect(ai.prompts).toHaveLength(1)
    const outline = ai.prompts[0]!.user
    expect(outline).toContain('UNTRUSTED CONTENT')
    expect(outline).toContain('Lecture 5 Trade.pptx')
    expect(outline).toContain('Calculate the deadweight loss')
    expect(outline).toContain('6 marks')
    expect(outline).not.toContain('Trade war costs') // reading is not chosen
    expect(outline).not.toContain('d1-1') // aliases, not chunk ids

    const review = planned.review!
    expect(review.layout).toBe('outline')
    expect(review.promptVersion).toBe('exam-review/v2')
    expect(review.sections.map((s) => s.title)).toEqual(['Tariffs', 'Gains from trade'])
    const tariffs = review.sections[0]!
    const chunkDocs = new Set(
      (await db.table('chunks').bulkGet(tariffs.chunkIds!)).map((c) => c.documentId),
    )
    expect(chunkDocs).toEqual(new Set([deck1.id, deck2.id]))
    expect(tariffs.chunkIds).toEqual(expect.arrayContaining(['d1-2', 'd1-3', 'd2-1']))
    expect(tariffs.questionIds).toEqual(['hq-1', 'hq-2'])
    expect(tariffs.questionRefs?.['hq-1']).toMatchObject({ paper: 'Midterm 2024', marks: 6 })
    expect(review.overview).toMatchObject({ papers: 1, questions: 2, totalMarks: 10 })
    expect(review.overview!.topPoints[0]).toMatchObject({ title: 'Tariffs', marks: 10 })

    const done = await service.generate(exam.id, { now: NOW })
    const written = done.review!.sections[0]!
    expect(written.status).toBe('done')
    expect(written.examQuestions).toEqual([{ text: 'DWL of a tariff.', questionIds: ['hq-1'] }])
    expect(written.marking).toEqual([
      { text: 'Marks for the triangle.', quote: '2 marks for the triangle', questionIds: ['hq-1'] },
    ])
    // A claim citing a question points at the paper's page.
    expect(written.questionTypes?.[0]?.sources).toEqual(['p-1'])
    expect(written.citations?.['p-1']?.documentName).toBe('Midterm 2024.pdf')
    const writePrompt = ai.prompts.find((p) => p.user.includes('Topic: Tariffs'))!.user
    expect(writePrompt).toContain('PROFESSOR ANSWERS')
    expect(writePrompt).toContain('2 marks for the triangle')
    expect(writePrompt).toContain('A tariff raises the domestic price.')
    expect(writePrompt).toContain('A quota limits imports')
  })

  it('without the answer key chosen, no answers are sent; changing the files marks the sheet', async () => {
    const { exam, key, deck1, deck2, paper } = await seed()
    const ai = fakeAI()
    const service = new ExamReviewService({ db, ai: ai.port })
    await service.setSources(exam.id, [deck1.id, deck2.id, paper.id], NOW)
    expect((await service.get(exam.id)).review?.scopeChangedAt).toBeUndefined()
    await service.plan(exam.id, { now: NOW, useAI: true })
    await service.generate(exam.id, { now: NOW })
    const writePrompt = ai.prompts.find((p) => p.user.includes('Topic: Tariffs'))!.user
    expect(writePrompt).not.toContain('2 marks for the triangle')

    const changed = await service.setSources(
      exam.id,
      [deck1.id, deck2.id, paper.id, key.id],
      NOW + 5,
    )
    expect(changed.review?.scopeChangedAt).toBe(NOW + 5)
    expect(changed.review?.sources?.documentIds).toContain(key.id)
    // Laying it out again keeps the choice and clears the mark.
    const relaid = await service.plan(exam.id, { now: NOW + 6, replace: true })
    expect(relaid.review?.scopeChangedAt).toBeUndefined()
    expect(relaid.review?.sources?.documentIds).toContain(key.id)
  })

  it('falls back to a local layout when the outline reply is unusable', async () => {
    const { exam, article } = await seed()
    const port: ExamReviewAIPort = {
      async testConnection() {
        return { ok: true }
      },
      async chatJSON<T>() {
        return { data: { points: [{ title: 'Nothing', chunks: ['c999'] }] } as T, raw: {} as never }
      },
    }
    const planned = await new ExamReviewService({ db, ai: port }).plan(exam.id, {
      now: NOW,
      useAI: true,
    })
    expect(planned.review!.layout).toBe('local')
    // Units of the chosen lecture files only — never the reading.
    expect(planned.review!.sections.some((s) => s.title.includes(article.name))).toBe(false)
    expect(planned.review!.sections.length).toBeGreaterThan(0)
  })

  it('changes a file to reading through the one change-type path', async () => {
    const { article, deck1, project } = await seed()
    const service = new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
      db,
    })
    const result = await service.changeMaterialType(deck1.id, 'reading', project.id)
    expect(result.changed).toBe(true)
    expect(result.needsReprocess).toBe(false)
    const chunks = await db.table('chunks').where('documentId').equals(deck1.id).toArray()
    expect(chunks.every((c) => c.materialType === 'reading')).toBe(true)
    expect(article.materialType).toBe('reading')
  })
})
