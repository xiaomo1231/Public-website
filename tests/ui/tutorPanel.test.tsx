import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TutorPanel } from '@/widgets/tutor/TutorPanel'
import { buildAIServices } from '@/services/aiServices'
import type { TutorSession } from '@/entities/tutorSession/types'

vi.mock('@/services/aiServices', () => ({
  buildAIServices: vi.fn(),
}))

const INTRO = 'A derivative measures how a function changes at a point.'

function sessionWith(intro: string): TutorSession {
  return {
    id: 's1',
    projectId: 'p1',
    topicId: 't1',
    topicName: 'Derivatives',
    language: 'en',
    messages: [],
    turns: [{ role: 'tutor', kind: 'introduction', content: intro, createdAt: 1 }],
    streakCorrect: 0,
    streakWrong: 0,
    currentDifficulty: 'intermediate',
    hintsRevealed: 0,
    mastery: 0,
    status: 'active',
    startedAt: 1,
    updatedAt: 1,
  }
}

function renderPanel() {
  return render(
    <TutorPanel
      projectId="p1"
      topicId="t1"
      topicName="Derivatives"
      topicDescription="Rates of change."
      language="en"
    />,
  )
}

beforeEach(() => {
  vi.mocked(buildAIServices).mockReset()
})

describe('TutorPanel', () => {
  it('shows the explanation and the question when both halves succeed', async () => {
    const session = sessionWith(INTRO)
    session.pendingQuestion = {
      id: 'q1',
      prompt: 'What is a derivative?',
      type: 'numeric',
      expectedAnswer: 'rate of change',
      explanation: '',
      knowledgePoint: 'Derivatives',
      difficulty: 'basic',
      sourceRefs: [],
      hints: [],
    }
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi.fn().mockImplementation(async (_id, opts) => {
          opts?.onDelta?.(INTRO)
          return { session, turn: session.turns[0]!, finished: false }
        }),
      },
    } as never)

    renderPanel()

    expect(await screen.findByText(INTRO)).toBeInTheDocument()
    expect(screen.getByText('What is a derivative?')).toBeInTheDocument()
    expect(screen.queryByText('Tutor unavailable')).not.toBeInTheDocument()
  })

  it('still shows the explanation when only the question half fails', async () => {
    // This is the reported bug: the explanation streamed fine, but a failed
    // question replaced the whole panel with "Tutor unavailable".
    const session = sessionWith(INTRO)
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi.fn().mockImplementation(async (_id, opts) => {
          opts?.onDelta?.(INTRO)
          return {
            session,
            turn: session.turns[0]!,
            finished: false,
            questionError: 'The AI tutor returned data that could not be read. Please try again.',
          }
        }),
      },
    } as never)

    renderPanel()

    expect(await screen.findByText(INTRO)).toBeInTheDocument()
    expect(
      screen.getByText('The AI tutor returned data that could not be read. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Tutor unavailable')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try another question' })).toBeInTheDocument()
  })

  it('reports an empty explanation with its own message', async () => {
    const { AppError } = await import('@/infrastructure/errors/AppError')
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi
          .fn()
          .mockRejectedValue(new AppError('empty', 'EMPTY_TUTOR_RESPONSE')),
      },
    } as never)

    renderPanel()

    expect(await screen.findByText('Tutor unavailable')).toBeInTheDocument()
    expect(screen.getByText('The AI tutor returned no explanation.')).toBeInTheDocument()
  })

  it('reports a provider outage with its own message', async () => {
    const { AIProviderError } = await import('@/infrastructure/ai/errors')
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi
          .fn()
          .mockRejectedValue(new AIProviderError('down', 'PROVIDER_UNAVAILABLE')),
      },
    } as never)

    renderPanel()

    expect(await screen.findByText('Tutor unavailable')).toBeInTheDocument()
    expect(screen.getByText('The AI tutor cannot reach the AI service right now.')).toBeInTheDocument()
  })

  it('reports a timeout with its own message', async () => {
    const { AIProviderError } = await import('@/infrastructure/ai/errors')
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi.fn().mockRejectedValue(new AIProviderError('slow', 'TIMEOUT')),
      },
    } as never)

    renderPanel()

    expect(await screen.findByText('Tutor unavailable')).toBeInTheDocument()
    expect(screen.getByText('The AI tutor timed out. Please try again in a moment.')).toBeInTheDocument()
  })

  it('reports a topic with no course content without blaming the AI', async () => {
    const { AppError } = await import('@/infrastructure/errors/AppError')
    const session = sessionWith(INTRO)
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        startSession: vi.fn().mockResolvedValue(sessionWith('')),
        beginTopic: vi.fn().mockImplementation(async (_id, opts) => {
          opts?.onDelta?.(INTRO)
          return {
            session,
            turn: session.turns[0]!,
            finished: false,
            questionError: new AppError('none', 'NO_TOPIC_CONTENT').message,
          }
        }),
      },
    } as never)

    renderPanel()

    // The explanation is still shown; only the question is unavailable.
    expect(await screen.findByText(INTRO)).toBeInTheDocument()
    expect(screen.queryByText('Tutor unavailable')).not.toBeInTheDocument()
  })
})
