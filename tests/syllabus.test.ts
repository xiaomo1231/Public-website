import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/syllabus-handbook-chunks.json'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { ProcessingService } from '@/services/processingService'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { CourseVocabService } from '@/services/courseVocabService'
import { QuizService } from '@/services/quizService'
import { SyllabusService } from '@/services/syllabusService'
import { loadQuizCandidates } from '@/services/sourceContext'
import { collectTopicSources } from '@/services/topicSources'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import { looksLikeSyllabus, parseSyllabusTopics } from '@/entities/syllabus/parse'
import { readAiSyllabus } from '@/entities/syllabus/aiExtract'
import { matchExamTopic, readAiMatches, rematchLocally } from '@/entities/syllabus/match'
import { examTopicCoverage } from '@/entities/syllabus/coverage'
import { planExamScopeEntries } from '@/entities/syllabus/examPlan'
import type { ExamTopic, SyllabusData } from '@/entities/syllabus/types'
import type { QuizConfig } from '@/entities/quiz/types'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

const chunks = fixture as Array<{
  id: string
  pageNumber: number
  contentType: string
  text: string
}>

let counter = 0
const newId = () => `id${++counter}`

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

describe('local exam-topic parser (Semmelweis handbook fixture)', () => {
  const scopes = parseSyllabusTopics(chunks, { newId })
  const topics = scopes.flatMap((scope) => scope.topics)

  it('finds the semifinal topic list as one final-exam scope', () => {
    expect(scopes).toHaveLength(1)
    expect(scopes[0]!.label).toBe('TOPICS OF THE SEMIFINAL EXAMINATION')
    expect(scopes[0]!.kind).toBe('final')
    // ~37 musculoskeletal + 9 further + ~16 embryology topics.
    expect(topics.length).toBeGreaterThanOrEqual(60)
    expect(topics.length).toBeLessThanOrEqual(75)
  })

  it('keeps the exact text, chunk and page of every topic', () => {
    const whole = collapse(chunks.map((chunk) => chunk.text).join(' '))
    for (const topic of topics) expect(whole).toContain(topic.text)
    const first = topics[0]!
    expect(first).toMatchObject({
      text: 'General osteology, classification of bones',
      page: 13,
      sourceChunkId: 'c84',
      source: 'local',
      order: 0,
    })
    // A topic wrapped onto the next line is joined…
    expect(topics.map((t) => t.text)).toContain(
      'Carpometacarpal, metacarpophalangeal and interphalangeal joints of the thumb and fingers, the gross anatomy of the muscles concerned with the movements',
    )
    // …also across a chunk boundary, keeping the chunk it starts in.
    const viscero = topics.find((t) => t.text.startsWith('Viscerocranium'))!
    expect(viscero.text.endsWith('pterygopalatine and infratemporal fossae)')).toBe(true)
    expect(viscero.sourceChunkId).toBe('c86')
    expect(topics.at(-1)!.text).toBe('Development of the muscular system')
    expect(topics.at(-1)!.page).toBe(14)
  })

  it('reads sub-headings as groups, not topics', () => {
    const texts = topics.map((t) => t.text)
    expect(texts).not.toContain('Musculoskeletal Anatomy')
    expect(texts).not.toContain('Further topics with relevence to the musculoskeletal system')
    expect(texts).not.toContain('General Embryology and development of the musculoskeletal system')
    expect(texts).not.toContain('Macroscopic Anatomy And Embryology I.')
    expect(topics.find((t) => t.text === 'Oogenesis')!.group).toBe(
      'General Embryology and development of the musculoskeletal system',
    )
    expect(topics.find((t) => t.text === 'Innervation of limbs')!.group).toBe(
      'Further topics with relevence to the musculoskeletal system',
    )
    expect(topics.filter((t) => t.group === 'Musculoskeletal Anatomy').length).toBeGreaterThan(30)
  })

  it('ignores rules, announcements and numbered regulations', () => {
    const texts = topics.map((t) => t.text).join('\n')
    expect(texts).not.toMatch(/Lab coats|wash your hands|Students|neptun|Passing rate/i)
  })

  it('reads numbered and bulleted lists, Chinese headings and kinds', () => {
    const parsed = parseSyllabusTopics(
      [
        {
          id: 'a',
          text: '期中考试题目\n1. 细胞膜的结构与功能\n2. 物质跨膜转运\n3. 静息电位的形成',
          pageNumber: 1,
        },
        { id: 'b', text: 'FINAL EXAM TOPICS', contentType: 'heading', pageNumber: 2 },
        {
          id: 'c',
          text: '• Brachial plexus\n• Rotator cuff muscles and the\nshoulder joint\n• Carpal tunnel',
          pageNumber: 2,
        },
        { id: 'd', text: 'GRADING', contentType: 'heading', pageNumber: 3 },
        { id: 'e', text: '1. Students must attend every class.\n2. Late work is not accepted.' },
      ],
      { newId },
    )
    expect(parsed.map((s) => [s.label, s.kind, s.topics.map((t) => t.text)])).toEqual([
      ['期中考试题目', 'midterm', ['细胞膜的结构与功能', '物质跨膜转运', '静息电位的形成']],
      [
        'FINAL EXAM TOPICS',
        'final',
        ['Brachial plexus', 'Rotator cuff muscles and the shoulder joint', 'Carpal tunnel'],
      ],
    ])
  })

  it('suggests the syllabus role from a file name or first page', () => {
    expect(looksLikeSyllabus('Macroscopic Anatomy and Embryology Handbook.pdf')).toBe(true)
    expect(looksLikeSyllabus('生理学考试大纲.docx')).toBe(true)
    expect(looksLikeSyllabus('notes.pdf', 'TOPICS OF THE SEMIFINAL EXAMINATION')).toBe(true)
    expect(looksLikeSyllabus('lecture 3.pptx', 'Announcements\nMidterm next week')).toBe(false)
    expect(looksLikeSyllabus('Gray anatomy.pdf', 'Chapter 1 The upper limb')).toBe(false)
  })
})

describe('AI extraction validation', () => {
  it('keeps only topics that occur in the document and locates them', () => {
    const { scopes, dropped } = readAiSyllabus(
      {
        scopes: [
          {
            label: 'TOPICS OF THE SEMIFINAL EXAMINATION',
            kind: 'final',
            topics: [
              'Shoulder joint, the gross anatomy of the muscles acting upon it',
              // Whitespace differs from the PDF line break: still the same text.
              'Viscerocranium, components and cavities (walls and connections of the nasal cavity, orbit, oral cavity,   pterygopalatine and infratemporal fossae)',
              'Anatomy of the heart', // invented
              'Shoulder joint and its muscles', // reworded
              42,
            ],
          },
          { label: 'Made up', kind: 'midterm', topics: ['Histology of the kidney'] },
        ],
      },
      chunks,
      newId,
    )
    expect(dropped).toBe(4)
    expect(scopes).toHaveLength(1)
    expect(scopes[0]!.topics.map((t) => [t.text, t.sourceChunkId, t.page, t.source])).toEqual([
      ['Shoulder joint, the gross anatomy of the muscles acting upon it', 'c84', 13, 'ai'],
      [
        'Viscerocranium, components and cavities (walls and connections of the nasal cavity, orbit, oral cavity, pterygopalatine and infratemporal fossae)',
        'c86',
        13,
        'ai',
      ],
    ])
  })
})

const TOPICS = [
  { id: 't-shoulder', name: 'Shoulder Joint and Rotator Cuff Muscles', description: '' },
  { id: 't-thorax', name: 'Thorax wall', description: 'Ribs, sternum and intercostal muscles' },
  { id: 't-embryo', name: 'Gastrulation and germ layers', description: '' },
  { id: 't-brachial', name: 'Brachial plexus', description: 'Roots, trunks, cords' },
]

describe('matching exam topics to course topics', () => {
  it('matches locally with stems and Latin / English variants', () => {
    expect(
      matchExamTopic('Shoulder joint, the gross anatomy of the muscles acting upon it', TOPICS),
    ).toEqual(['t-shoulder'])
    expect(matchExamTopic('Thoracic muscles', TOPICS)).toContain('t-thorax')
    expect(matchExamTopic('Gastrulation', TOPICS)).toEqual(['t-embryo'])
    expect(matchExamTopic('Twin formation', TOPICS)).toEqual([])
  })

  it('keeps AI matches whose topics still exist when re-matching locally', () => {
    const items: ExamTopic[] = [
      {
        id: 'e1',
        text: 'Twin formation',
        order: 0,
        source: 'local',
        topicIds: ['t-embryo'],
        matchedBy: 'ai',
      },
      {
        id: 'e2',
        text: 'Oogenesis',
        order: 1,
        source: 'local',
        topicIds: ['gone'],
        matchedBy: 'ai',
      },
      { id: 'e3', text: 'Brachial plexus', order: 2, source: 'local' },
    ]
    const out = rematchLocally(items, TOPICS)
    expect(out[0]).toMatchObject({ topicIds: ['t-embryo'], matchedBy: 'ai' })
    expect(out[1]!.topicIds).toBeUndefined()
    expect(out[2]).toMatchObject({ topicIds: ['t-brachial'], matchedBy: 'local' })
  })

  it('validates a closed-set AI answer', () => {
    const matches = readAiMatches(
      {
        matches: [
          { examTopicId: 'e1', topicIds: ['t1', 'invented', 't1', 't2'] },
          { examTopicId: 'e9', topicIds: ['t1'] }, // never asked
          { examTopicId: 'e2', topicIds: 'not a list' },
          { examTopicId: 'e3', topicIds: [] },
        ],
      },
      ['e1', 'e2', 'e3'],
      ['t1', 't2'],
    )
    expect([...matches.entries()]).toEqual([
      ['e1', ['t1', 't2']],
      ['e3', []],
    ])
  })
})

describe('coverage', () => {
  it('aggregates practice and mastery of the matched topics', () => {
    const item: ExamTopic = {
      id: 'e1',
      text: 'Shoulder joint',
      order: 0,
      source: 'local',
      topicIds: ['t-shoulder', 'deleted'],
      matchedBy: 'local',
    }
    const input = {
      topics: new Map([['t-shoulder', { id: 't-shoulder', name: 'Shoulder' }]]),
      pointsByTopic: new Map([['t-shoulder', ['Glenoid labrum']]]),
      mastery: [
        { knowledgePoint: 'glenoid labrum', mastery: 0.8, attempts: 3 },
        { knowledgePoint: 'Other', topicId: 't-shoulder', mastery: 0.4, attempts: 1 },
        { knowledgePoint: 'Unrelated', mastery: 0.1, attempts: 9 },
      ],
    }
    const coverage = examTopicCoverage(item, input)
    expect(coverage.covered).toBe(true)
    expect(coverage.topics).toEqual([{ id: 't-shoulder', name: 'Shoulder' }])
    expect(coverage.practiceCount).toBe(4)
    expect(coverage.mastery).toBeCloseTo((0.8 * 3 + 0.4) / 4)
    const none = examTopicCoverage({ id: 'e2', text: 'Twins', order: 1, source: 'manual' }, input)
    expect(none).toEqual({ topics: [], covered: false, practiceCount: 0, mastery: null })
  })
})

describe('exam-scope quiz planning', () => {
  const items: ExamTopic[] = [
    { id: 'a', text: 'Shoulder', order: 0, source: 'local', topicIds: ['t1'], matchedBy: 'local' },
    { id: 'b', text: 'Twins', order: 1, source: 'local' },
    { id: 'c', text: 'Hip', order: 2, source: 'local', topicIds: ['gone'], matchedBy: 'ai' },
  ]

  it('uses matched topics, and unmatched ones only when opted in', () => {
    const known = new Set(['t1'])
    expect(planExamScopeEntries(items, known, { includeUnmatched: false, count: 5 })).toEqual([
      { kind: 'matched', examTopicId: 'a', text: 'Shoulder', topicIds: ['t1'] },
    ])
    expect(
      planExamScopeEntries(items, known, { includeUnmatched: true, count: 5 }).map((e) => e.kind),
    ).toEqual(['matched', 'unmatched', 'unmatched'])
    // More exam topics than questions: spread over the scope.
    expect(
      planExamScopeEntries(items, known, { includeUnmatched: true, count: 2 }).map(
        (e) => e.examTopicId,
      ),
    ).toEqual(['a', 'b'])
  })
})

// ---- storage-backed ---------------------------------------------------------

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

afterEach(() => {
  db.close()
})

async function project(subject: 'medicine' | 'calculus' = 'medicine') {
  const projects = new ProjectService(db)
  const p = await projects.create({ name: 'Anatomy', subject })
  return { projects, projectId: p.id }
}

async function addDocument(
  projectId: string,
  materialType: LearningMaterialType,
  name: string,
  texts: string[],
): Promise<{ document: Document; chunkIds: string[] }> {
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId, type: 'pdf', name, sizeBytes: 1, materialType })
  const document = await docs.update(doc.id, { status: 'ready' })
  const rows = await new ChunkRepository(db).addMany(
    texts.map((text, i) => ({
      documentId: doc.id,
      projectId,
      materialType,
      contentType: 'paragraph' as const,
      text,
      sourceReference: name,
      order: i,
      pageNumber: i + 1,
    })),
  )
  return { document, chunkIds: rows.map((row) => row.id) }
}

const SYLLABUS_TEXT = [
  'FINAL EXAM TOPICS\n1. Shoulder joint and its muscles\n2. Twin formation\n3. Brachial plexus',
]

async function seedCourse() {
  const { projects, projectId } = await project()
  const book = await addDocument(projectId, 'textbook', 'atlas.pdf', [
    'The shoulder joint is a ball-and-socket joint stabilised by the rotator cuff.',
    'The brachial plexus is formed by the anterior rami of C5 to T1.',
  ])
  const syllabus = await addDocument(projectId, 'syllabus', 'handbook.pdf', SYLLABUS_TEXT)
  await new CourseAnalysisRepository(db).reseedProject(
    projectId,
    {
      topics: [
        {
          id: 't-shoulder',
          name: 'Shoulder Joint',
          description: 'Rotator cuff',
          sourceRefs: [],
          sourceChunkIds: [book.chunkIds[0]!],
        },
        {
          id: 't-brachial',
          name: 'Brachial plexus',
          description: 'Roots and cords',
          sourceRefs: [],
          sourceChunkIds: [book.chunkIds[1]!],
        },
      ],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map(),
      documentIds: [book.document.id, syllabus.document.id],
    },
    'en',
  )
  return { projects, projectId, book, syllabus }
}

describe('syllabus documents are excluded from course knowledge', () => {
  it('is left out of the analysis input, quiz passages, tutor fallback and course vocabulary', async () => {
    const { projects, projectId, book, syllabus } = await seedCourse()
    const documents = await new DocumentRepository(db).listByProject(projectId)
    expect(selectAnalysisDocuments(documents).map((d) => d.id)).toEqual([book.document.id])

    // Even if an older analysis listed it, its chunks are never quiz material…
    const candidates = await loadQuizCandidates({
      documentIds: [book.document.id, syllabus.document.id],
      chunks: new ChunkRepository(db),
    })
    expect(candidates.map((c) => c.documentId)).not.toContain(syllabus.document.id)

    // …nor tutor grounding.
    const analyses = new CourseAnalysisRepository(db)
    const topicless = await collectTopicSources(
      { analyses, chunks: new ChunkRepository(db) },
      projectId,
      't-shoulder',
      10,
    )
    expect(topicless.map((s) => s.documentId)).not.toContain(syllabus.document.id)

    // A course with only a syllabus has no material to analyse or mine for words.
    const only = await project()
    await addDocument(only.projectId, 'syllabus', 'handbook.pdf', SYLLABUS_TEXT)
    const ai = { chatJSON: vi.fn(), streamJSON: vi.fn() } as unknown as AIService
    await expect(
      new DocumentAnalysisService({ ai, projects, db }).analyzeProject(only.projectId),
    ).rejects.toMatchObject({ code: 'NO_DOCUMENTS' })
    await expect(
      new CourseVocabService({ projects, ai: null, db }).extract(only.projectId),
    ).rejects.toMatchObject({ code: 'NO_DOCUMENTS' })
  })

  it('reads the exam topics when a syllabus is processed', async () => {
    const { projects, projectId } = await project()
    const documents = new DocumentRepository(db)
    const blob = new Blob(
      [
        'Course handbook\n\nTOPICS OF THE FINAL EXAMINATION\n\nShoulder joint and its muscles\nBrachial plexus\nTwin formation\n',
      ],
      { type: 'text/plain' },
    )
    const doc = await new DocumentService({ documents, projects }).create({
      projectId,
      type: 'text',
      materialType: 'syllabus',
      name: 'handbook.txt',
      sizeBytes: blob.size,
      blob,
    })
    await new ProcessingService({
      documents,
      chunks: new ChunkRepository(db),
      jobs: new ProcessingJobRepository(db),
      projects,
    }).process(doc.id)
    const stored = await documents.get(doc.id)
    expect(stored.syllabus?.method).toBe('local')
    expect(stored.syllabus?.scopes[0]?.topics.map((t) => t.text)).toEqual([
      'Shoulder joint and its muscles',
      'Brachial plexus',
      'Twin formation',
    ])
  })
})

describe('SyllabusService', () => {
  it('matches locally, edits the list and reports coverage', async () => {
    const { projectId, syllabus } = await seedCourse()
    const service = new SyllabusService({ db })
    await service.extractLocally(syllabus.document.id)
    const overview = await service.overview(projectId)
    const data = overview.syllabi[0]!.data!
    const [shoulder, twins, plexus] = data.scopes[0]!.topics
    expect(shoulder!.topicIds).toEqual(['t-shoulder'])
    expect(twins!.topicIds).toBeUndefined()
    expect(plexus!.topicIds).toEqual(['t-brachial'])
    expect(overview.coverage.get(twins!.id)).toMatchObject({ covered: false, mastery: null })
    expect(overview.hasKnowledgeSource).toBe(true)

    const scopeId = data.scopes[0]!.id
    await service.renameScope(syllabus.document.id, scopeId, 'Final')
    await service.addTopic(syllabus.document.id, scopeId, 'Axillary artery')
    const merged = await service.mergeTopics(syllabus.document.id, scopeId, [
      shoulder!.id,
      plexus!.id,
    ])
    const scope = merged.scopes[0]!
    expect(scope.label).toBe('Final')
    expect(scope.topics.map((t) => [t.text, t.source])).toEqual([
      ['Shoulder joint and its muscles / Brachial plexus', 'manual'],
      ['Twin formation', 'local'],
      ['Axillary artery', 'manual'],
    ])
    expect(scope.topics[0]!.topicIds).toEqual(['t-shoulder', 't-brachial'])
    expect(merged.editedAt).toBeDefined()
    const deleted = await service.deleteTopic(syllabus.document.id, scopeId, scope.topics[1]!.id)
    expect(deleted.scopes[0]!.topics.map((t) => t.order)).toEqual([0, 1])
  })

  it('AI extraction drops topics that are not in the document', async () => {
    const { syllabus } = await seedCourse()
    const chatJSON = vi.fn(async () => ({
      data: {
        scopes: [
          {
            label: 'FINAL EXAM TOPICS',
            kind: 'final',
            topics: ['Twin formation', 'Cardiac cycle'],
          },
        ],
      },
    }))
    const service = new SyllabusService({ db })
    const result = await service.extractWithAi(syllabus.document.id, {
      chatJSON,
    } as unknown as AIService)
    expect(result.dropped).toBe(1)
    expect(result.data.method).toBe('ai')
    expect(result.data.scopes[0]!.topics.map((t) => t.text)).toEqual(['Twin formation'])
    // The prompt wraps the document as untrusted content.
    const messages = (chatJSON.mock.calls[0] as unknown as [ChatMessage[]])[0]
    expect(messages[1]!.content).toContain('UNTRUSTED CONTENT')

    const nothing = vi.fn(async () => ({
      data: { scopes: [{ label: 'x', topics: ['Invented topic'] }] },
    }))
    await expect(
      service.extractWithAi(syllabus.document.id, { chatJSON: nothing } as unknown as AIService),
    ).rejects.toMatchObject({ code: 'SYLLABUS_EMPTY' })
    // The earlier list is kept when nothing survives.
    expect((await new DocumentRepository(db).get(syllabus.document.id)).syllabus?.method).toBe('ai')
  })

  it('AI matching only accepts ids from the offered course topics', async () => {
    const { projectId, syllabus } = await seedCourse()
    const service = new SyllabusService({ db })
    await service.extractLocally(syllabus.document.id)
    await service.matchLocally(projectId, { force: true })
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      const user = messages[1]!.content
      // Course topics are offered as t1, t2…; exam topics as e1, e2…
      expect(user).toMatch(/t1 \| Shoulder Joint/)
      return {
        data: {
          matches: [
            { examTopicId: 'e2', topicIds: ['t1', 't-shoulder', 't99'] },
            { examTopicId: 'e1', topicIds: [] },
          ],
        },
      }
    })
    const found = await service.matchWithAi(syllabus.document.id, {
      chatJSON,
    } as unknown as AIService)
    expect(found).toBe(1)
    const topics = (await new DocumentRepository(db).get(syllabus.document.id)).syllabus!.scopes[0]!
      .topics
    expect(topics[1]).toMatchObject({
      text: 'Twin formation',
      topicIds: ['t-shoulder'],
      matchedBy: 'ai',
    })
    // An empty AI answer keeps the local match.
    expect(topics[0]).toMatchObject({ topicIds: ['t-shoulder'], matchedBy: 'local' })
  })

  it('re-labels a textbook as the syllabus and suggests it first', async () => {
    const { projectId } = await project()
    const { document } = await addDocument(projectId, 'textbook', 'Course Handbook 2026.pdf', [
      'TOPICS OF THE SEMIFINAL EXAMINATION\nShoulder joint\nHip joint\nKnee joint',
    ])
    const service = new SyllabusService({ db })
    expect((await service.overview(projectId)).suggestions.map((d) => d.id)).toEqual([document.id])
    const data = await service.markAsSyllabus(document.id, projectId)
    expect(data.scopes[0]!.topics).toHaveLength(3)
    const stored = await new DocumentRepository(db).get(document.id)
    expect(stored.materialType).toBe('syllabus')
    const chunk = (await new ChunkRepository(db).listByDocument(document.id))[0]!
    expect(chunk.materialType).toBe('syllabus')
    const overview = await service.overview(projectId)
    expect(overview.suggestions).toEqual([])
    expect(overview.hasKnowledgeSource).toBe(false)
  })
})

/** A model that answers each plan line with its type. */
function planAI() {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+)/gm)].map((m) => m[1]!)
    const chunk = messages[1]!.content.match(/\[chunk:([^\s·\]]+)/)?.[1]
    return {
      data: {
        questions: plan.map((type, i) => ({
          prompt: `Question ${i}`,
          type,
          correctAnswer: 'true',
          solution: '',
          knowledgePoint: '',
          difficulty: 'basic',
          hints: [],
          ...(chunk ? { sourceChunkId: chunk } : {}),
        })),
      },
    }
  })
  return { ai: { chatJSON, maxOutputTokens: 2048 } as unknown as AIService, chatJSON }
}

describe('quiz by exam scope', () => {
  async function scoped(includeUnmatched: boolean, examTopicId?: 'twins') {
    const course = await seedCourse()
    const service = new SyllabusService({ db })
    const data: SyllabusData = await service.extractLocally(course.syllabus.document.id)
    await service.matchLocally(course.projectId, { force: true })
    const scope = data.scopes[0]!
    const twins = scope.topics.find((t) => t.text === 'Twin formation')!
    const config: QuizConfig = {
      mode: 'mixed',
      count: 3,
      difficulty: 'basic',
      types: ['true_false'],
      topicName: scope.label,
      examScope: {
        documentId: course.syllabus.document.id,
        scopeId: scope.id,
        ...(examTopicId ? { examTopicId: twins.id } : {}),
        includeUnmatched,
      },
    }
    return { ...course, config }
  }

  it('quizzes matched exam topics from their course sources, unmatched ones labelled', async () => {
    const { projectId, config, book } = await scoped(true)
    const { ai, chatJSON } = planAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, config)
    const questions = await service.getQuestions(quiz.id)
    expect(questions).toHaveLength(3)
    const unlabelled = questions.filter((q) => q.origin !== 'ai_without_source')
    const labelled = questions.filter((q) => q.origin === 'ai_without_source')
    expect(labelled).toHaveLength(1)
    expect(labelled[0]!.sourceRefs).toEqual([])
    expect(labelled[0]!.knowledgePoint).toBe('Twin formation')
    expect(unlabelled.map((q) => q.topicId).sort()).toEqual(['t-brachial', 't-shoulder'])
    for (const q of unlabelled) {
      expect(q.sourceRefs.every((ref) => ref.documentId === book.document.id)).toBe(true)
    }
    // Only the textbook's passages were offered, never the syllabus.
    const prompts = chatJSON.mock.calls.map((c) => (c[0] as ChatMessage[])[1]!.content).join('\n')
    expect(prompts).not.toContain('2. Twin formation')
  })

  it('leaves unmatched exam topics out unless the student opts in', async () => {
    const { projectId, config } = await scoped(false)
    const { ai } = planAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, config)
    const questions = await service.getQuestions(quiz.id)
    expect(questions.some((q) => q.origin === 'ai_without_source')).toBe(false)

    const single = await scoped(false, 'twins')
    await expect(
      new QuizService({ ai, db }).generateQuiz(single.projectId, single.config),
    ).rejects.toMatchObject({ code: 'EXAM_SCOPE_EMPTY' })
  })
})
