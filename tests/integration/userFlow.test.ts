import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'

// Services under test
import { InviteService } from '@/services/inviteService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingService } from '@/services/processingService'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { QuizService } from '@/services/quizService'
import { MasteryService } from '@/services/masteryService'
import { MistakeService } from '@/services/mistakeService'
import { MistakeAnalysisService } from '@/services/mistakeAnalysisService'
import { WeaknessService } from '@/services/weaknessService'
import { ReviewSessionService } from '@/services/reviewSessionService'
import { TutorService } from '@/services/tutorService'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'

import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

/**
 * A scripted fake AI that returns plausible responses based on the prompt
 * it receives. This lets the integration test exercise the whole pipeline
 * without a network.
 */
function scriptedAI(): AIService {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const user = messages.find((m) => m.role === 'user')?.content ?? ''

    // Document analyzer
    if (system.includes('extracts structured knowledge')) {
      return {
        data: {
          language: 'en',
          topics: [
            {
              name: 'Derivatives',
              description: 'Rates of change',
              sourceRefs: [{ documentName: 'notes.txt', page: 1 }],
            },
          ],
          concepts: [
            {
              name: 'Power Rule',
              definition: 'd/dx x^n = n x^(n-1)',
              topicNames: ['Derivatives'],
              sourceRefs: [{ documentName: 'notes.txt', page: 1 }],
            },
          ],
          formulas: [
            {
              name: 'Power Rule',
              latex: '\\frac{d}{dx} x^n = n x^{n-1}',
              description: 'Derivative of a power',
              variables: [{ symbol: 'n', meaning: 'exponent' }],
              sourceRefs: [{ documentName: 'notes.txt', page: 1 }],
            },
          ],
          symbols: [
            { symbol: 'd/dx', meaning: 'derivative operator', context: 'calculus', sourceRefs: [{ documentName: 'notes.txt', page: 1 }] },
          ],
          examples: [],
          exercises: [],
          prerequisites: [],
        },
        raw: { content: '{}', model: 'fake' },
      }
    }

    // Quiz generator
    if (system.includes('assessment designer')) {
      const count = (user.match(/Generate exactly (\d+)/)?.[1] ?? '1')
      const n = Number(count)
      return {
        data: {
          questions: Array.from({ length: n }, (_, i) => ({
            prompt: `Derivative of x^${i + 2}?`,
            type: 'math_expr',
            correctAnswer: `${i + 2}x^${i + 1}`,
            solution: 'Apply the power rule.',
            knowledgePoint: 'Power Rule',
            difficulty: 'basic',
            hints: ['Use the power rule'],
          })),
        },
        raw: { content: '{}', model: 'fake' },
      }
    }

    // Mistake analyzer
    if (system.includes('analysing a student mistake')) {
      return {
        data: {
          whereWrong: 'The exponent was not reduced.',
          firstError: 'The power was left unchanged.',
          whyWrong: 'The power rule subtracts one from the exponent.',
          correctApproach: 'Multiply by the exponent, then reduce it by one.',
          possibleCause: 'This may indicate the power rule is still being memorised.',
          mistakeType: 'formula',
          reviewKnowledgePoints: ['Power Rule'],
          shouldPracticeMore: true,
          similarExample: { prompt: 'Derivative of x^5?', answer: '5x^4' },
          continuePrompt: 'Would you like to try a similar question?',
        },
        raw: { content: '{}', model: 'fake' },
      }
    }

    // Tutor question
    if (system.includes('generating the next practice question')) {
      return {
        data: {
          prompt: 'What is the derivative of x^3?',
          type: 'math_expr',
          expectedAnswer: '3x^2',
          explanation: 'Power rule.',
          knowledgePoint: 'Power Rule',
          difficulty: 'basic',
          sourceRefs: [],
          hints: ['Bring the 3 down'],
        },
        raw: { content: '{}', model: 'fake' },
      }
    }

    // Tutor evaluate
    if (system.includes('evaluating a student answer')) {
      return {
        data: {
          isCorrect: false,
          feedback: 'Not quite — check the exponent.',
          breakdown: ['The coefficient is right, the exponent is not.'],
          nextSteps: 'Try applying the power rule again.',
          groundedExplanation: 'd/dx x^3 = 3x^2.',
          isSupplementary: false,
        },
        raw: { content: '{}', model: 'fake' },
      }
    }

    return { data: {}, raw: { content: '{}', model: 'fake' } }
  })

  return {
    chat: vi.fn(async () => ({ content: 'Welcome to derivatives.', model: 'fake' })),
    chatJSON,
    streamChat: vi.fn(async (_m, onDelta: (d: string) => void) => {
      onDelta('Welcome to derivatives.')
      return { content: 'Welcome to derivatives.', model: 'fake' }
    }),
    testConnection: vi.fn(async () => ({ ok: true, latencyMs: 12, model: 'fake' })),
    reset: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
}

describe('End-to-end user flow', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('runs invite → project → document → analysis → tutor → mistake → review → mastery', async () => {
    const ai = scriptedAI()
    const invite = new InviteService(db)
    const projects = new ProjectService(db)
    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const analyses = new CourseAnalysisRepository(db)
    const mastery = new MasteryService(db)
    const mistakes = new MistakeService(db)
    const quiz = new QuizService({
      ai,
      db,
      questions: new QuestionRepository(db),
      attempts: new QuestionAttemptRepository(db),
      quizzes: new QuizRepository(db),
      analyses,
      chunks,
      mastery,
      mistakes,
    })
    const tutor = new TutorService({
      ai,
      db,
      projects,
      sessions: new TutorSessionRepository(db),
      analyses,
      chunks,
    })

    // 1. Invite code
    await invite.ensureSeeded()
    expect(await invite.validate('WELCOME-LEARN')).toBe(true)
    await invite.unlock('welcome-learn')
    expect(await invite.isUnlocked()).toBe(true)

    // 2. Create a project
    const project = await projects.create({ name: 'Calculus I', subject: 'calculus' })
    expect(project.id).toBeTruthy()

    // 3. Upload + process a document
    const text = 'Chapter 1: Derivatives. The power rule states that d/dx x^n = n x^(n-1).'
    const blob = new Blob([text], { type: 'text/plain' })
    const doc = await docs.create({
      projectId: project.id,
      type: 'text',
      name: 'notes.txt',
      sizeBytes: blob.size,
      blob,
    })
    const processing = new ProcessingService({
      documents: docs,
      chunks,
      jobs: new (await import('@/entities/processingJob/repository')).ProcessingJobRepository(db),
      projects,
    })
    await processing.process(doc.id)
    const processed = await docs.get(doc.id)
    expect(processed.status).toBe('ready')
    expect(processed.chunkCount).toBeGreaterThan(0)

    // 4. Analyze the course
    const analysisService = new DocumentAnalysisService({
      ai,
      projects,
      db,
      documents: docs,
      chunks,
      analyses,
    })
    await analysisService.analyzeProject(project.id)
    const analysis = await analyses.getByProject(project.id)
    expect(analysis?.status).toBe('ready')
    const topics = await analyses.listTopics(project.id)
    expect(topics.length).toBeGreaterThan(0)
    const topic = topics[0]!

    // 5. Generate + take a quiz, answering wrong on purpose
    const quizConfig = {
      mode: 'topic' as const,
      topicId: topic.id,
      topicName: topic.name,
      count: 2,
      difficulty: 'adaptive' as const,
      types: ['math_expr' as const],
    }
    const generated = await quiz.generateQuiz(project.id, quizConfig)
    expect(generated.questionIds).toHaveLength(2)
    const questions = await quiz.getQuestions(generated.id)
    expect(questions).toHaveLength(2)

    // First answer: wrong → goes into the mistake book
    const first = await quiz.submitAnswer(generated.id, questions[0]!.id, 'wrong')
    expect(first.evaluation.isCorrect).toBe(false)
    const mistakeRows = await mistakes.list(project.id, { status: 'active' })
    expect(mistakeRows).toHaveLength(1)
    expect(mistakeRows[0]!.question).toContain('Derivative')

    // Second answer: correct → quiz completes
    const second = await quiz.submitAnswer(generated.id, questions[1]!.id, `${3}x^2`)
    expect(second.isLastQuestion).toBe(true)
    const completed = await quiz.getQuiz(generated.id)
    expect(completed.status).toBe('completed')
    expect(completed.score?.total).toBe(2)

    // 6. Adaptive difficulty produced a recommendation
    expect(second.nextDifficulty).toBeTruthy()
    expect(second.difficultyReason.length).toBeGreaterThan(0)

    // 7. Mastery was recorded for the knowledge point
    const masteryRow = await mastery.get(project.id, 'Power Rule')
    expect(masteryRow).toBeDefined()
    expect(masteryRow!.attempts).toBeGreaterThan(0)

    // 8. AI analysis of the mistake
    const analysisSvc = new MistakeAnalysisService({ ai, mistakes, chunks, analyses })
    const analysed = await analysisSvc.analyze(mistakeRows[0]!.id)
    expect(analysed.analysisStatus).toBe('ready')
    expect(analysed.analysis?.mistakeType).toBe('formula')
    expect(analysed.analysis?.possibleCause).toMatch(/possible|may indicate/i)

    // 9. Weakness detection surfaces the knowledge point
    const weakness = new WeaknessService(db)
    const report = await weakness.analyze(project.id)
    expect(report.totalMistakes).toBeGreaterThan(0)
    expect(report.areas[0]!.knowledgePoint).toBe('Power Rule')
    expect(report.areas[0]!.reason).toMatch(/mistake/)

    // 10. Review session from mistakes
    const review = new ReviewSessionService({ quiz, mistakes, weakness, db })
    const reviewSession = await review.createReviewSession(project.id, { count: 3 })
    expect(reviewSession.config.mode).toBe('review')
    expect(reviewSession.questionIds.length).toBeGreaterThan(0)

    // 11. Practice a single mistake — harder
    const practice = await review.practiceMistake(mistakeRows[0]!.id, 'harder')
    expect(practice.config.sourceMistakeId).toBe(mistakeRows[0]!.id)

    // 12. Tutor session on the topic
    const session = await tutor.startSession({
      projectId: project.id,
      topicId: topic.id,
      topicName: topic.name,
      topicDescription: topic.description,
      language: analysis!.language,
    })
    const begun = await tutor.beginTopic(session.id)
    expect(begun.session.pendingQuestion?.prompt).toContain('derivative')
    const evaluated = await tutor.submitAnswer(session.id, 'wrong answer')
    expect(evaluated.turn.evaluation?.isCorrect).toBe(false)

    // 13. Everything stayed local: verify counts
    const inv = await new (await import('@/services/dataManagementService')).DataManagementService(db).inventory()
    expect(inv.projects).toBe(1)
    expect(inv.documents).toBe(1)
    expect(inv.mistakes).toBeGreaterThanOrEqual(1)
    expect(inv.quizzes).toBeGreaterThanOrEqual(1)
    expect(inv.tutorSessions).toBe(1)
  })

  it('keeps projects isolated end to end', async () => {
    const ai = scriptedAI()
    const projects = new ProjectService(db)
    const mistakes = new MistakeService(db)

    const a = await projects.create({ name: 'A', subject: 'calculus' })
    const b = await projects.create({ name: 'B', subject: 'physics' })

    await mistakes.addManual({ projectId: a.id, question: 'QA', studentAnswer: 'x', correctAnswer: 'y', knowledgePoint: 'KP-A' })
    await mistakes.addManual({ projectId: b.id, question: 'QB', studentAnswer: 'x', correctAnswer: 'y', knowledgePoint: 'KP-B' })

    const listA = await mistakes.list(a.id)
    const listB = await mistakes.list(b.id)
    expect(listA).toHaveLength(1)
    expect(listB).toHaveLength(1)
    expect(listA[0]!.knowledgePoint).toBe('KP-A')
    expect(listB[0]!.knowledgePoint).toBe('KP-B')

    void ai
  })
})
