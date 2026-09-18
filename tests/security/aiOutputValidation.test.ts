import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { normalizeDocumentAnalysis } from '@/infrastructure/ai/prompts/document-analyzer/normalize'
import {
  normalizeTutorEvaluation,
  normalizeTutorQuestion,
} from '@/infrastructure/ai/prompts/tutor/normalize'
import { normalizeTranslation } from '@/services/translationService'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AIService } from '@/services/aiService'

function fakeAI(data: unknown): AIService {
  const result = { data, raw: { content: '{}', model: 'fake' } }
  return {
    chatJSON: vi.fn().mockResolvedValue(result),
    // The analysis path streams; both are provided so either path works.
    streamJSON: vi.fn().mockResolvedValue(result),
    chat: vi.fn(),
    streamChat: vi.fn(),
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: {},
    maxOutputTokens: 2048,
  } as unknown as AIService
}

describe('normalizeDocumentAnalysis', () => {
  it('rejects a response that is not an object', () => {
    expect(() => normalizeDocumentAnalysis(null)).toThrow()
    expect(() => normalizeDocumentAnalysis('nope')).toThrow()
    expect(() => normalizeDocumentAnalysis([1, 2, 3])).toThrow()
  })

  it('turns wrong field types into empty collections rather than crashing', () => {
    const result = normalizeDocumentAnalysis({
      language: 42,
      topics: 'not-an-array',
      concepts: { nope: true },
      formulas: null,
      symbols: undefined,
      examples: 7,
      exercises: false,
      prerequisites: [],
    })
    expect(result.language).toBe('mixed')
    expect(result.topics).toEqual([])
    expect(result.concepts).toEqual([])
    expect(result.formulas).toEqual([])
    expect(result.symbols).toEqual([])
    expect(result.examples).toEqual([])
    expect(result.exercises).toEqual([])
    expect(result.prerequisites).toEqual([])
  })

  it('drops entries missing required fields but keeps valid ones', () => {
    const result = normalizeDocumentAnalysis({
      language: 'en',
      topics: [
        { name: 'Derivatives', description: 'rates of change', sourceRefs: [] },
        { description: 'no name' },
        null,
        'string entry',
      ],
      concepts: [
        { name: 'Power Rule', definition: 'd/dx x^n = n x^(n-1)', topicNames: ['Derivatives'] },
        { name: 'No definition' },
      ],
      formulas: [
        { name: 'Chain', latex: '\\frac{dy}{dx}', description: '', variables: [], sourceRefs: [] },
        { name: 'Missing latex' },
      ],
      symbols: [
        { symbol: 'μ', meaning: 'mean', context: 'statistics' },
        { meaning: 'no symbol' },
      ],
      examples: [],
      exercises: [
        { prompt: 'Differentiate x^2', difficulty: 'nonsense', topicNames: [] },
      ],
      prerequisites: [{ name: 'Algebra', description: 'basics' }],
    })

    expect(result.topics).toHaveLength(1)
    expect(result.concepts).toHaveLength(1)
    expect(result.formulas).toHaveLength(1)
    expect(result.symbols).toHaveLength(1)
    expect(result.exercises).toHaveLength(1)
    expect(result.prerequisites).toHaveLength(1)
    // Unknown difficulty falls back rather than being persisted verbatim.
    expect(result.exercises[0]!.difficulty).toBe('basic')
  })

  it('sanitises nested source references', () => {
    const result = normalizeDocumentAnalysis({
      language: 'en',
      topics: [
        {
          name: 'T',
          description: '',
          sourceRefs: [
            { documentName: 'calc.pdf', page: 12, section: 'Derivatives' },
            { page: 3 },
            'garbage',
          ],
        },
      ],
    })
    expect(result.topics[0]!.sourceRefs).toHaveLength(1)
    expect(result.topics[0]!.sourceRefs[0]).toMatchObject({ documentName: 'calc.pdf', page: 12 })
  })
})

describe('normalizeTutorQuestion', () => {
  it('rejects a question without a prompt or answer', () => {
    expect(() => normalizeTutorQuestion({})).toThrow(/usable question/i)
    expect(() => normalizeTutorQuestion({ prompt: 'Q?' })).toThrow(/usable question/i)
    expect(() => normalizeTutorQuestion(null)).toThrow(/usable question/i)
  })

  it('coerces a valid question and clamps hints', () => {
    const q = normalizeTutorQuestion({
      prompt: 'Differentiate x^3',
      type: 'math_expr',
      expectedAnswer: '3x^2',
      knowledgePoint: 'Power Rule',
      difficulty: 'advanced',
      hints: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
    expect(q.prompt).toBe('Differentiate x^3')
    expect(q.type).toBe('math_expr')
    expect(q.difficulty).toBe('advanced')
    expect(q.hints.length).toBeLessThanOrEqual(5)
  })

  it('falls back for unknown type and difficulty', () => {
    const q = normalizeTutorQuestion({
      prompt: 'Q',
      expectedAnswer: 'A',
      type: 'telepathy',
      difficulty: 'impossible',
      hints: 'not-an-array',
    })
    expect(q.type).toBe('multiple_choice')
    expect(q.difficulty).toBe('basic')
    expect(q.hints).toEqual([])
  })
})

describe('normalizeTutorEvaluation', () => {
  it('never throws and always yields a usable verdict', () => {
    for (const input of [null, undefined, 'x', 42, [], {}]) {
      const evaluation = normalizeTutorEvaluation(input)
      expect(typeof evaluation.isCorrect).toBe('boolean')
      expect(evaluation.feedback.length).toBeGreaterThan(0)
      expect(Array.isArray(evaluation.breakdown)).toBe(true)
      expect(typeof evaluation.isSupplementary).toBe('boolean')
    }
  })

  it('treats a missing isCorrect as incorrect rather than correct', () => {
    expect(normalizeTutorEvaluation({ feedback: 'hmm' }).isCorrect).toBe(false)
  })

  it('falls back to feedback when no grounded explanation is given', () => {
    const evaluation = normalizeTutorEvaluation({ isCorrect: true, feedback: 'Nice work.' })
    expect(evaluation.groundedExplanation).toBe('Nice work.')
  })
})

describe('normalizeTranslation', () => {
  it('rejects a response without a translation', () => {
    expect(() => normalizeTranslation({})).toThrow(/translation/i)
    expect(() => normalizeTranslation(null)).toThrow(/translation/i)
    expect(() => normalizeTranslation({ translation: '   ' })).toThrow(/translation/i)
  })

  it('coerces alternatives and caps them', () => {
    const out = normalizeTranslation({
      translation: '导数',
      contextNote: 'calculus term',
      alternatives: ['微商', '导函数', 'a', 'b'],
    })
    expect(out.translation).toBe('导数')
    expect(out.alternatives).toEqual(['微商', '导函数', 'a'])
  })

  it('tolerates non-array alternatives', () => {
    const out = normalizeTranslation({ translation: 'x', alternatives: 'nope' })
    expect(out.alternatives).toEqual([])
  })
})

describe('DocumentAnalysisService with malformed AI output', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setup() {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calculus', subject: 'calculus' })
    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const analyses = new CourseAnalysisRepository(db)
    const doc = await docs.create({ projectId: project.id, type: 'text', name: 'c.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 'The power rule states d/dx x^n = n x^(n-1).',
        sourceReference: 'c.txt',
        order: 0,
      },
    ])
    return { project, docs, chunks, analyses, projects }
  }

  it('does not persist garbage when the model returns a non-object', async () => {
    const { project, docs, chunks, analyses, projects } = await setup()
    const svc = new DocumentAnalysisService({
      ai: fakeAI('this is not JSON'),
      projects,
      db,
      documents: docs,
      chunks,
      analyses,
    })
    await expect(svc.analyzeProject(project.id)).rejects.toBeDefined()

    // Nothing was written.
    const stored = await analyses.listTopics(project.id)
    expect(stored).toEqual([])
    const analysis = await analyses.getByProject(project.id)
    expect(analysis?.status).toBe('failed')
  })

  it('persists only sanitised entries from a partially-malformed response', async () => {
    const { project, docs, chunks, analyses, projects } = await setup()
    const svc = new DocumentAnalysisService({
      ai: fakeAI({
        language: 'en',
        topics: [
          { name: 'Derivatives', description: 'rates of change', sourceRefs: [{ documentName: 'c.txt' }] },
          { description: 'missing name' },
        ],
        concepts: [],
        formulas: [],
        symbols: [{ meaning: 'missing symbol' }],
        examples: [],
        exercises: [],
        prerequisites: [],
      }),
      projects,
      db,
      documents: docs,
      chunks,
      analyses,
    })
    await svc.analyzeProject(project.id)

    const topics = await analyses.listTopics(project.id)
    expect(topics).toHaveLength(1)
    expect(topics[0]!.name).toBe('Derivatives')
    // The malformed symbol entry was dropped, not written.
    expect(await analyses.listSymbols(project.id)).toEqual([])
  })
})
