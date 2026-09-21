import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { PracticeService, formatQuestionStyleContext } from '@/services/practiceService'
import { parsePracticeQuestions } from '@/infrastructure/files/practiceExtraction'
import { prompts } from '@/infrastructure/ai/prompts'

const PRACTICE_TEXT = [
  '1. Find the derivative of f(x) = x^2 sin(x).',
  'A. 2x sin(x) + x^2 cos(x)',
  'B. x^2 cos(x)',
  'C. 2x cos(x)',
  'D. x sin(x)',
  '',
  '2. The derivative of a constant is zero.',
  'A. True',
  'B. False',
  '',
  '3. Evaluate the limit numerically.',
  '',
  '4. Explain why the derivative of x^2 is 2x.',
  '',
  'Answer Key',
  '1. A',
  '2. A',
  '3. 4.5',
].join('\n')

describe('parsePracticeQuestions', () => {
  it('separates questions and preserves A/B/C/D options', () => {
    const { questions } = parsePracticeQuestions(PRACTICE_TEXT)
    expect(questions).toHaveLength(4)
    expect(questions[0]!.number).toBe('1')
    expect(questions[0]!.options).toEqual([
      '2x sin(x) + x^2 cos(x)',
      'x^2 cos(x)',
      '2x cos(x)',
      'x sin(x)',
    ])
    expect(questions[0]!.type).toBe('single_choice')
  })

  it('matches an answer key to question numbers', () => {
    const { questions, answerKey } = parsePracticeQuestions(PRACTICE_TEXT)
    expect(answerKey['1']).toBe('A')
    expect(questions[0]!.answer).toBe('A')
    expect(questions[1]!.type).toBe('true_false')
    expect(questions[2]!.answer).toBe('4.5')
    expect(questions[2]!.type).toBe('numeric')
  })

  it('leaves subjective questions ungraded and untyped as choice', () => {
    const { questions } = parsePracticeQuestions(PRACTICE_TEXT)
    expect(questions[3]!.type).toBe('short_answer')
    expect(questions[3]!.answer).toBeUndefined()
  })

  it('keeps multi-part questions together', () => {
    const { questions } = parsePracticeQuestions(
      ['Question 5', 'Consider the function below.', '(a) find its domain', '(b) find its range'].join(
        '\n',
      ),
    )
    expect(questions).toHaveLength(1)
    expect(questions[0]!.prompt).toContain('(a) find its domain')
    expect(questions[0]!.prompt).toContain('(b) find its range')
  })

  it('marks Private Use Area text as low confidence', () => {
    const { questions } = parsePracticeQuestions('1. \uF0C5 ( ) A B')
    expect(questions[0]!.confidence).toBeLessThan(0.6)
  })
})

describe('PracticeService', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let service: PracticeService

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'professor_practice',
      name: 'practice1.txt',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id

    await new ChunkRepository(db).addMany([
      {
        documentId,
        projectId,
        materialType: 'professor_practice',
        pageNumber: 1,
        contentType: 'paragraph',
        text: PRACTICE_TEXT,
        sourceReference: 'practice1.txt · Page 1',
        order: 0,
      },
    ])

    await new CourseAnalysisRepository(db).reseedProject(
      projectId,
      {
        topics: [
          { name: 'Derivatives', description: 'derivative of a function', sourceRefs: [] },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
        documentIds: [documentId],
      },
      'en',
    )

    service = new PracticeService({ db })
  })

  it('imports a professor practice document into a question bank with provenance', async () => {
    const set = await service.importDocument(documentId)
    expect(set.questionCount).toBe(4)

    const questions = await service.listQuestions(set.id)
    expect(questions).toHaveLength(4)
    expect(questions[0]!.documentId).toBe(documentId)
    expect(questions[0]!.documentName).toBe('practice1.txt')
    expect(questions[0]!.pageNumber).toBe(1)
    expect(questions[0]!.chunkId).toBeTruthy()
    expect(questions[0]!.expectedAnswer).toBe('A')
    expect(questions[0]!.answerSource).toBe('professor')
    expect(questions[0]!.options[0]!.isCorrect).toBe(true)
  })

  it('refuses documents that are not marked Professor Practice', async () => {
    const other = await new DocumentRepository(db).create({
      projectId,
      type: 'text',
      materialType: 'textbook',
      name: 'book.txt',
      sizeBytes: 0,
    })
    await expect(service.importDocument(other.id)).rejects.toMatchObject({
      code: 'NOT_PRACTICE_MATERIAL',
    })
  })

  it('grades choice, numeric and math answers, and never guesses subjective ones', async () => {
    const set = await service.importDocument(documentId)
    const questions = await service.listQuestions(set.id)
    const [choice, , numeric, subjective] = questions

    expect((await service.recordAttempt(choice!.id, 'A')).isCorrect).toBe(true)
    expect((await service.recordAttempt(choice!.id, 'B')).isCorrect).toBe(false)
    expect((await service.recordAttempt(numeric!.id, '4.5')).isCorrect).toBe(true)

    const subjectiveResult = await service.recordAttempt(subjective!.id, 'because of the power rule')
    expect(subjectiveResult.isCorrect).toBeUndefined()
    expect(subjectiveResult.method).toBe('none')
  })

  it('tracks practice progress separately from other progress', async () => {
    const set = await service.importDocument(documentId)
    const questions = await service.listQuestions(set.id)
    await service.recordAttempt(questions[0]!.id, 'A')
    await service.recordAttempt(questions[1]!.id, 'B')

    const progress = await service.progress(set.id)
    expect(progress).toEqual({ total: 4, completed: 2, correct: 1, needsReview: 1 })
  })

  it('builds an evidence-based question-style profile', async () => {
    await service.importDocument(documentId)
    const context = await new CourseContextRepository(db).get(projectId)
    const style = context?.questionStyleProfile

    expect(style).toBeDefined()
    expect(style!.sampleSize).toBe(4)
    expect(style!.confidence).toBe('preliminary')
    expect(style!.questionTypeDistribution.single_choice).toBe(1)
    expect(style!.questionTypeDistribution.short_answer).toBe(1)
    expect(style!.calculationVsConceptual.calculation).toBeGreaterThanOrEqual(1)

    const text = formatQuestionStyleContext(style!)
    expect(text).toContain('Based on 4 uploaded practice question(s)')
    expect(text).toContain('preliminary')
  })
})

describe('quiz generator professor style context', () => {
  it('includes the style context and forbids copying questions', () => {
    const prompt = prompts.quizGenerator.buildUserPrompt({
      topicName: 'Derivatives',
      topicDescription: 'rate of change',
      knowledgePoints: [],
      plan: [{ difficulty: 'basic', type: 'math_expr' }],
      language: 'en',
      sourceSnippets: [],
      professorStyleContext: 'Based on 12 uploaded practice question(s) (moderate evidence).',
    })

    expect(prompt).toContain('PROFESSOR QUESTION STYLE CONTEXT')
    expect(prompt).toContain('Do not copy')
    expect(prompt).toContain('moderate evidence')
  })
})
