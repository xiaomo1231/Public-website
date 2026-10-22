import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService } from '@/services/quizService'
import { SyllabusService } from '@/services/syllabusService'
import { oralLanguage, validateOralItem } from '@/services/oralExamService'
import { observationFromAttempt } from '@/services/masteryService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { LearningMaterialType } from '@/entities/document/types'
import type { QuizConfig } from '@/entities/quiz/types'
import type { Question } from '@/entities/question/types'
import {
  oralGroups,
  oralNextStep,
  oralResumePoint,
  oralTopicScores,
} from '@/entities/question/oral'
import type { SourceSnippet } from '@/services/sourceContext'
import { highlightEvidence } from '@/shared/lib/evidenceHighlight'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

// ---- validation -------------------------------------------------------------

const snippet: SourceSnippet = {
  chunkId: 'c1',
  documentId: 'd1',
  documentName: 'atlas.pdf',
  pageNumber: 3,
  text: 'The shoulder joint is a ball-and-socket joint stabilised by the rotator cuff.',
}
const index = new Map([[snippet.chunkId, snippet]])
const points = (n: number) => Array.from({ length: n }, (_, i) => `Category ${i}: fact ${i}`)

function item(overrides: Record<string, unknown> = {}) {
  return {
    question: 'Describe the shoulder joint and the muscles acting upon it.',
    knowledgePoint: 'Shoulder joint',
    outline: '- Parts\n- Muscles',
    rubric: points(7),
    followUps: [
      {
        question: 'Which nerve supplies the deltoid?',
        answer: 'The axillary nerve.',
        rubric: ['Axillary nerve'],
      },
      {
        question: 'What limits abduction?',
        answer: 'The acromion.',
        rubric: ['Acromion', 'Rotator cuff'],
      },
    ],
    sources: [
      { chunkId: 'c1', quote: 'ball-and-socket joint stabilised by the rotator cuff' },
      { chunkId: 'invented', quote: 'made up' },
    ],
    ...overrides,
  }
}

describe('oral item validation', () => {
  const options = { aiOnly: false, fallbackPoint: 'Shoulder' }

  it('needs 4–10 distinct scoring points and cuts extras', () => {
    expect(validateOralItem(item({ rubric: points(3) }), index, options)).toBeNull()
    expect(
      validateOralItem(item({ rubric: ['A: x', 'a: X', 'B: y', 'C: z', ''] }), index, options),
    ).toBeNull()
    expect(validateOralItem(item({ rubric: points(4) }), index, options)?.rubric).toHaveLength(4)
    expect(validateOralItem(item({ rubric: points(14) }), index, options)?.rubric).toHaveLength(10)
    expect(validateOralItem(item({ question: ' ' }), index, options)).toBeNull()
    expect(validateOralItem(item({ outline: '' }), index, options)).toBeNull()
  })

  it('keeps at most two well-formed follow-ups with 1–3 points', () => {
    const result = validateOralItem(
      item({
        followUps: [
          { question: '', answer: 'x', rubric: ['x'] },
          { question: 'No answer?', rubric: ['x'] },
          { question: 'No points?', answer: 'x', rubric: [] },
          {
            question: 'Describe the shoulder joint and the muscles acting upon it.',
            answer: 'x',
            rubric: ['x'],
          },
          { question: 'Q1', answer: 'A1', rubric: ['1', '2', '3', '4', '5'] },
          { question: 'Q2', answer: 'A2', rubric: ['p'] },
          { question: 'Q3', answer: 'A3', rubric: ['p'] },
        ],
      }),
      index,
      options,
    )!
    expect(result.followUps.map((f) => f.question)).toEqual(['Q1', 'Q2'])
    expect(result.followUps[0]!.rubric).toHaveLength(3)
  })

  it('cites only offered chunks, and nothing for an AI-only topic', () => {
    const result = validateOralItem(item(), index, options)!
    expect(result.sourceRefs).toHaveLength(1)
    expect(result.sourceRefs[0]).toMatchObject({ chunkId: 'c1', documentId: 'd1', page: 3 })
    const aiOnly = validateOralItem(item(), index, { aiOnly: true, fallbackPoint: 'Twins' })!
    expect(aiOnly.sourceRefs).toEqual([])
    expect(validateOralItem(item({ knowledgePoint: '' }), index, options)!.knowledgePoint).toBe(
      'Shoulder',
    )
  })

  it('examines international medicine in English', () => {
    expect(
      oralLanguage({ subject: 'medicine', examStyle: 'international' }, 'zh_terms', 'zh'),
    ).toBe('en')
    expect(oralLanguage({ subject: 'medicine', examStyle: 'domestic' }, 'zh_terms', 'en')).toBe(
      'zh_terms',
    )
    expect(oralLanguage({ subject: 'biology' }, 'source', 'en')).toBe('en')
  })
})

describe('evidence highlighting', () => {
  it('marks the quoted words across spacing, case and punctuation', () => {
    const segments = highlightEvidence('The deltoid is supplied by the  Axillary nerve, C5.', [
      'axillary nerve c5',
    ])
    expect(segments.filter((s) => s.mark).map((s) => s.text)).toEqual(['Axillary nerve, C5'])
    expect(segments.map((s) => s.text).join('')).toBe(
      'The deltoid is supplied by the  Axillary nerve, C5.',
    )
  })

  it('merges overlapping quotes and ignores quotes not in the text', () => {
    const segments = highlightEvidence('肩关节由肱骨头和关节盂构成', [
      '肱骨头和',
      '和关节盂',
      '不存在',
    ])
    expect(segments).toEqual([
      { text: '肩关节由', mark: false },
      { text: '肱骨头和关节盂', mark: true },
      { text: '构成', mark: false },
    ])
    expect(highlightEvidence('abc', [])).toEqual([{ text: 'abc', mark: false }])
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

async function addDocument(
  projectId: string,
  materialType: LearningMaterialType,
  name: string,
  texts: string[],
) {
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

async function seedCourse() {
  const project = await new ProjectService(db).create({ name: 'Anatomy', subject: 'medicine' })
  const projectId = project.id
  const book = await addDocument(projectId, 'textbook', 'atlas.pdf', [
    'The shoulder joint is a ball-and-socket joint stabilised by the rotator cuff.',
    'The brachial plexus is formed by the anterior rami of C5 to T1.',
  ])
  const syllabus = await addDocument(projectId, 'syllabus', 'handbook.pdf', [
    'FINAL EXAM TOPICS\n1. Shoulder joint and its muscles\n2. Twin formation\n3. Brachial plexus',
  ])
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
  const service = new SyllabusService({ db })
  const data = await service.extractLocally(syllabus.document.id)
  await service.matchLocally(projectId, { force: true })
  return { projectId, book, syllabus, scope: data.scopes[0]! }
}

const STUDENT_MAIN =
  'The shoulder is a ball and socket joint. The rotator cuff stabilises it. The deltoid abducts the arm.'

/**
 * A model that writes oral items (citing the first offered chunk plus an
 * invented id) and grades short answers: it claims every point, quoting the
 * first sentence of the answer for p1 and a phrase NOT in the answer for p2.
 */
function oralAI() {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    if (system.includes('examiner at a university oral exam')) {
      const chunk = user.match(/\[chunk:([^\s·\]]+)/)?.[1]
      return {
        data: item({
          sources: [
            ...(chunk ? [{ chunkId: chunk, quote: 'stabilised by the rotator cuff' }] : []),
            { chunkId: 'invented-chunk', quote: 'x' },
          ],
        }),
      }
    }
    const answer = user.match(/=== BEGIN STUDENT ANSWER[^\n]*\n([\s\S]*?)\n=== END/)?.[1] ?? ''
    const ids = [...user.matchAll(/^(p\d+): /gm)].map((m) => m[1]!)
    return {
      data: {
        status: 'ready',
        points: ids.map((id, i) => ({
          id,
          covered: true,
          evidence: i === 0 ? answer.split('.')[0] : 'the suprascapular nerve supplies it',
        })),
        feedback: 'Add the innervation.',
      },
    }
  })
  return { ai: { chatJSON, maxOutputTokens: 2048 } as unknown as AIService, chatJSON }
}

function oralConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    mode: 'oral',
    count: 2,
    difficulty: 'adaptive',
    types: ['short_answer'],
    oral: { timerSeconds: 180 },
    ...overrides,
  }
}

describe('oral quiz generation', () => {
  it('draws topics and stores each as a main short answer with linked follow-ups', async () => {
    const { projectId, book } = await seedCourse()
    const { ai, chatJSON } = oralAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, oralConfig())
    expect(quiz.config.mode).toBe('oral')
    expect(quiz.config.count).toBe(2)
    expect(chatJSON).toHaveBeenCalledTimes(2)
    const questions = await service.getQuestions(quiz.id)
    expect(questions).toHaveLength(6)
    expect(questions.every((q) => q.type === 'short_answer')).toBe(true)
    const groups = oralGroups(questions)
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      expect(group.main.oral?.role).toBe('main')
      expect(group.main.rubric).toHaveLength(7)
      expect(group.main.rubric![0]!.id).toBe('p1')
      expect(group.followUps).toHaveLength(2)
      expect(group.followUps.every((f) => f.oral?.role === 'follow_up')).toBe(true)
      // The matched course topic and its name as knowledge point.
      expect(['t-shoulder', 't-brachial']).toContain(group.main.topicId)
      expect(group.followUps.every((f) => f.topicId === group.main.topicId)).toBe(true)
      expect(group.main.knowledgePoint).toBe(group.topic)
      // Only the real chunk is cited, never the invented id.
      expect(group.main.sourceRefs.length).toBe(1)
      expect(group.main.sourceRefs[0]!.documentId).toBe(book.document.id)
      expect(group.main.origin).toBeUndefined()
    }
    // The system prompt carries the subject profile.
    const system = (chatJSON.mock.calls[0]![0] as ChatMessage[])[0]!.content
    expect(system).toContain('COURSE SUBJECT')
  })

  it('draws one exam topic from the exam-topic list; unmatched only when opted in', async () => {
    const { projectId, syllabus, scope } = await seedCourse()
    const twins = scope.topics.find((t) => t.text === 'Twin formation')!
    const shoulder = scope.topics.find((t) => t.text.startsWith('Shoulder'))!
    const { ai, chatJSON } = oralAI()
    const service = new QuizService({ ai, db })

    const single = await service.generateQuiz(
      projectId,
      oralConfig({
        count: 3,
        examScope: {
          documentId: syllabus.document.id,
          scopeId: scope.id,
          examTopicId: shoulder.id,
          includeUnmatched: false,
        },
      }),
    )
    const singleGroups = oralGroups(await service.getQuestions(single.id))
    expect(singleGroups).toHaveLength(1)
    expect(singleGroups[0]!.topic).toBe(shoulder.text)
    expect(singleGroups[0]!.main.topicId).toBe('t-shoulder')

    const unmatched = await service.generateQuiz(
      projectId,
      oralConfig({
        count: 1,
        examScope: {
          documentId: syllabus.document.id,
          scopeId: scope.id,
          examTopicId: twins.id,
          includeUnmatched: true,
        },
      }),
    )
    const questions = await service.getQuestions(unmatched.id)
    expect(questions.every((q) => q.origin === 'ai_without_source')).toBe(true)
    expect(questions.every((q) => q.sourceRefs.length === 0)).toBe(true)
    expect(questions[0]!.knowledgePoint).toBe('Twin formation')
    expect(questions[0]!.topicId).toBeUndefined()
    const lastUser = (chatJSON.mock.calls.at(-1)![0] as ChatMessage[])[1]!.content
    expect(lastUser).toContain('NO SOURCE MATERIAL')

    await expect(
      service.generateQuiz(
        projectId,
        oralConfig({
          examScope: {
            documentId: syllabus.document.id,
            scopeId: scope.id,
            examTopicId: twins.id,
            includeUnmatched: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'EXAM_SCOPE_EMPTY' })
  })

  it('skips a topic whose output stays invalid and fails when none is usable', async () => {
    const { projectId } = await seedCourse()
    const chatJSON = vi.fn(async () => ({ data: item({ rubric: points(2) }) }))
    const service = new QuizService({ ai: { chatJSON } as unknown as AIService, db })
    await expect(service.generateQuiz(projectId, oralConfig({ count: 1 }))).rejects.toBeTruthy()
    expect(chatJSON).toHaveBeenCalledTimes(2)
  })
})

describe('oral grading, follow-ups and results', () => {
  it('grades each answer by its points with verified evidence, then scores per topic', async () => {
    const { projectId } = await seedCourse()
    const { ai } = oralAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, oralConfig({ count: 1 }))
    const questions = await service.getQuestions(quiz.id)
    const groups = oralGroups(questions)
    const answered = new Set<string>()

    // Main question first, then each follow-up, then the topic's feedback.
    let position = oralResumePoint(groups, answered)
    expect(position).toEqual({ groupIndex: 0, step: 0 })
    const order: Question[] = []
    for (;;) {
      const group = groups[position!.groupIndex]!
      const question = [group.main, ...group.followUps][position!.step]!
      order.push(question)
      const answer =
        position!.step === 0
          ? STUDENT_MAIN
          : 'The axillary nerve. It comes from the posterior cord.'
      const result = await service.submitAnswer(quiz.id, question.id, answer, {
        gradeShortAnswer: true,
      })
      // p1's quote is in the answer; p2's is not, so only p1 is covered.
      expect(result.evaluation.method).toBe('rubric_ai')
      expect(result.evaluation.rubric![0]!.covered).toBe(true)
      expect(result.evaluation.rubric![1]?.covered ?? false).toBe(false)
      answered.add(question.id)
      const next = oralNextStep(groups, position!)
      if (next === 'feedback') {
        expect(result.isLastQuestion).toBe(true)
        break
      }
      position = next
    }
    expect(order.map((q) => q.oral?.role)).toEqual(['main', 'follow_up', 'follow_up'])
    expect(oralResumePoint(groups, answered)).toBeNull()

    const completed = await service.getQuiz(quiz.id)
    expect(completed.status).toBe('completed')
    const attempts = await service.getAttempts(quiz.id)
    // Main: 1/7, follow-up 1: 1/1, follow-up 2: 1/2 → topic 3/10.
    const [topic] = oralTopicScores(questions, attempts)
    expect(topic).toMatchObject({ earned: 3, total: 10, percentage: 30, unscored: 0 })
    // Quiz percentage: (1/7 + 1 + 1/2) / 3 graded questions.
    expect(completed.score!.percentage).toBe(Math.round(((1 / 7 + 1 + 0.5) / 3) * 100))
    // Short-answer mastery: half weight.
    const main = attempts.find((a) => a.questionId === groups[0]!.main.id)!
    expect(observationFromAttempt(main).weight).toBe(0.5)

    // Disputing the main answer takes it out of the topic score.
    await service.disputeAttempt(main.id)
    const after = oralTopicScores(questions, await service.getAttempts(quiz.id))[0]!
    expect(after).toMatchObject({ earned: 2, total: 3, unscored: 1 })
  })

  it('scores a blank answer after the countdown as timed out, without asking the AI', async () => {
    const { projectId } = await seedCourse()
    const { ai, chatJSON } = oralAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, oralConfig({ count: 1 }))
    const main = oralGroups(await service.getQuestions(quiz.id))[0]!.main
    chatJSON.mockClear()

    const result = await service.submitAnswer(quiz.id, main.id, '   ', {
      gradeShortAnswer: true,
      timedOut: true,
    })
    expect(chatJSON).not.toHaveBeenCalled()
    expect(result.evaluation.isCorrect).toBe(false)
    expect(result.evaluation.score).toEqual({ earned: 0, total: main.rubric!.length })
    expect(result.attempt.timedOut).toBe(true)
  })
})
