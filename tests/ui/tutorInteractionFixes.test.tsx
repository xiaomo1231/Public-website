import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import { buildAIServices } from '@/services/aiServices'
import { loadStoredLesson } from '@/services/tutorLessonService'
import { findResumableSession } from '@/services/tutorService'
import { useTutorLesson, type UseTutorLessonState } from '@/features/tutor/useTutorLesson'
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { isUnknownTopic } from '@/features/tutor/isUnknownTopic'
import { tutorErrorInfo } from '@/features/tutor/tutorErrors'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import { TutorPanel } from '@/widgets/tutor/TutorPanel'
import { TutorSymbolsPanel } from '@/widgets/tutor/TutorSymbolsPanel'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { legendLabelFor } from '@/widgets/tutor/plotLayout'
import { TutorPage } from '@/pages/TutorPage'
import { InteractiveTutorPage } from '@/pages/InteractiveTutorPage'
import { AIProviderError } from '@/infrastructure/ai/errors'
import { classifyTeachingBlock } from '@/shared/lib/teachingBlocks'
import { parseLessonSections } from '@/shared/lib/lessonDocument'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import type { TutorSession } from '@/entities/tutorSession/types'
import type { Topic } from '@/entities/courseAnalysis/types'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/services/tutorLessonService', () => ({ loadStoredLesson: vi.fn() }))
vi.mock('@/services/tutorService', () => ({ findResumableSession: vi.fn() }))
vi.mock('@/features/tutor/useProjectTopics', () => ({ useProjectTopics: vi.fn() }))
vi.mock('@/features/tutor/useCourseContext', () => ({
  useCourseContext: () => ({ context: undefined }),
}))
vi.mock('@/features/slides/useSlideDocuments', () => ({
  useSlideDocuments: () => ({ documents: [] }),
}))
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ profile: undefined, loaded: true }),
}))
vi.mock('@/widgets/courseStructure/CourseStructurePanel', () => ({
  CourseStructurePanel: () => null,
}))
vi.mock('@/widgets/project/ProjectFlowNav', () => ({ ProjectFlowNav: () => null }))

const LESSON: TutorLesson = {
  id: 'lesson-1',
  projectId: 'p1',
  topicId: 't1',
  language: 'en',
  content: '## Overview\n\nRow reduction simplifies a system.',
  symbols: [],
  sourceChunkIds: [],
  contentHash: 'h',
  promptVersion: 'v1',
  generatedAt: 1,
  updatedAt: 1,
  version: 1,
}

function lessonState(overrides: Partial<UseTutorLessonState> = {}): UseTutorLessonState {
  return {
    status: 'ready',
    lesson: LESSON,
    fromCache: true,
    streaming: false,
    regenerating: false,
    generation: null,
    stop: () => undefined,
    stopped: false,
    regenerate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function session(overrides: Partial<TutorSession> = {}): TutorSession {
  return {
    id: 's1',
    projectId: 'p1',
    topicId: 't1',
    topicName: 'Row reduction',
    language: 'en',
    messages: [],
    turns: [
      { role: 'tutor', kind: 'introduction', content: 'Intro to row reduction.', createdAt: 1 },
      { role: 'tutor', kind: 'question', content: 'Reduce the matrix.', createdAt: 2 },
      { role: 'student', kind: 'answer', content: 'My earlier answer', createdAt: 3 },
      { role: 'tutor', kind: 'feedback', content: 'Close — check row 2.', createdAt: 4 },
    ],
    streakCorrect: 0,
    streakWrong: 0,
    currentDifficulty: 'intermediate',
    hintsRevealed: 0,
    mastery: 0,
    status: 'active',
    startedAt: 1,
    updatedAt: 4,
    ...overrides,
  }
}

const TOPIC = { id: 't1', name: 'Row reduction', description: 'Echelon forms' } as Topic

beforeEach(() => {
  act(() => setUILanguage('en'))
  vi.mocked(buildAIServices).mockReset()
  vi.mocked(loadStoredLesson).mockReset()
  vi.mocked(findResumableSession).mockReset()
  vi.mocked(useProjectTopics).mockReset()
})

describe('R04 — a saved lesson is readable without an AI provider', () => {
  it('loads the stored lesson instead of hiding it', async () => {
    vi.mocked(buildAIServices).mockResolvedValue(null)
    vi.mocked(loadStoredLesson).mockResolvedValue(LESSON)
    const { result } = renderHook(() =>
      useTutorLesson({
        projectId: 'p1',
        topicId: 't1',
        topicName: 'Row reduction',
        topicDescription: '',
        language: 'en',
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.lesson?.id).toBe('lesson-1')
    expect(result.current.noProvider).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it('without a stored lesson reports the missing provider as a Settings fix', async () => {
    vi.mocked(buildAIServices).mockResolvedValue(null)
    vi.mocked(loadStoredLesson).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useTutorLesson({
        projectId: 'p1',
        topicId: 't1',
        topicName: 'Row reduction',
        topicDescription: '',
        language: 'en',
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorNeedsSettings).toBe(true)
  })

  it('shows the lesson with a notice linking to Settings', () => {
    render(
      <MemoryRouter>
        <TutorLessonView topicName="Row reduction" state={lessonState({ noProvider: true })} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Row reduction simplifies a system.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open settings/i })).toHaveAttribute(
      'href',
      '/settings',
    )
  })
})

describe('R16 — tutor errors give the cause and what to do', () => {
  it('maps configuration errors to a Settings fix and transient ones to retry only', () => {
    expect(tutorErrorInfo(new AIProviderError('x', 'AUTH_FAILED')).needsSettings).toBe(true)
    expect(tutorErrorInfo(new AIProviderError('x', 'QUOTA_EXCEEDED')).needsSettings).toBe(true)
    expect(tutorErrorInfo(new AIProviderError('x', 'TIMEOUT')).needsSettings).toBe(false)
    expect(tutorErrorInfo(new AIProviderError('x', 'AUTH_FAILED')).message).not.toMatch(
      /something went wrong/i,
    )
  })

  it('a failed lesson offers Retry and Open settings', async () => {
    const state = lessonState({
      status: 'error',
      lesson: undefined,
      error: 'The API key was rejected.',
      errorNeedsSettings: true,
    })
    render(
      <MemoryRouter>
        <TutorLessonView topicName="Row reduction" state={state} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The API key was rejected.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(state.regenerate).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /open settings/i })).toBeInTheDocument()
  })
})

describe('R07 — interactive tutor failures and earlier turns', () => {
  function renderPanel() {
    return render(
      <MemoryRouter>
        <TutorPanel
          projectId="p1"
          topicId="t1"
          topicName="Row reduction"
          topicDescription=""
          language="en"
        />
      </MemoryRouter>,
    )
  }

  it('without a provider still shows the earlier conversation, with a Settings link', async () => {
    vi.mocked(buildAIServices).mockResolvedValue(null)
    vi.mocked(findResumableSession).mockResolvedValue(session())
    renderPanel()
    expect(await screen.findByText('Intro to row reduction.')).toBeInTheDocument()
    expect(screen.getByText(/earlier in this conversation \(3\)/i)).toBeInTheDocument()
    expect(screen.getByText('My earlier answer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open settings/i })).toBeInTheDocument()
    expect(screen.queryByText('Tutor unavailable')).not.toBeInTheDocument()
  })

  it('a failed first request offers Retry (which reopens) and Open settings', async () => {
    const beginTopic = vi
      .fn()
      .mockRejectedValueOnce(new AIProviderError('bad key', 'AUTH_FAILED'))
      .mockImplementation(async () => ({
        session: session(),
        turn: session().turns[0]!,
        finished: false,
      }))
    vi.mocked(buildAIServices).mockResolvedValue({
      tutor: {
        findOrStartSession: vi
          .fn()
          .mockResolvedValue({ session: session({ turns: [] }), resumed: false }),
        beginTopic,
      },
    } as never)
    renderPanel()
    expect(await screen.findByText('Tutor unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open settings/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Intro to row reduction.')).toBeInTheDocument()
    expect(beginTopic).toHaveBeenCalledTimes(2)
  })
})

describe('R43 — an unknown topic address shows "not found"', () => {
  it('detects ids the course does not contain', () => {
    expect(isUnknownTopic('nope', [TOPIC])).toBe(true)
    expect(isUnknownTopic('t1', [TOPIC])).toBe(false)
    expect(isUnknownTopic(undefined, [TOPIC])).toBe(false)
  })

  it('the lesson page never falls back to (and generates) another topic', async () => {
    vi.mocked(useProjectTopics).mockReturnValue({
      loading: false,
      analysis: { language: 'en' } as never,
      topics: [TOPIC],
    })
    vi.mocked(buildAIServices).mockResolvedValue(null)
    vi.mocked(loadStoredLesson).mockResolvedValue(LESSON)
    render(
      <MemoryRouter initialEntries={['/projects/p1/tutor/missing']}>
        <Routes>
          <Route path="/projects/:id/tutor/:topicId" element={<TutorPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Topic not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view all topics/i })).toHaveAttribute(
      'href',
      '/projects/p1/tutor',
    )
    expect(buildAIServices).not.toHaveBeenCalled()
    expect(loadStoredLesson).not.toHaveBeenCalled()
  })

  it('the interactive page says "topic not found", not "course not analysed"', () => {
    vi.mocked(useProjectTopics).mockReturnValue({
      loading: false,
      analysis: { language: 'en' } as never,
      topics: [TOPIC],
    })
    render(
      <MemoryRouter initialEntries={['/projects/p1/tutor/missing/interactive']}>
        <Routes>
          <Route
            path="/projects/:id/tutor/:topicId/interactive"
            element={<InteractiveTutorPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Topic not found')).toBeInTheDocument()
    expect(buildAIServices).not.toHaveBeenCalled()
  })
})

describe('R46 — teaching-block headings with their own titles', () => {
  it('recognises numbered and titled blocks but not look-alike words', () => {
    expect(classifyTeachingBlock('Example 2: Solving a 3×3 system')).toMatchObject({
      kind: 'example',
      titled: true,
    })
    expect(classifyTeachingBlock('Worked Example — back substitution')?.kind).toBe('workedExample')
    expect(classifyTeachingBlock('定义 1.2（行阶梯形）')?.kind).toBe('definition')
    expect(classifyTeachingBlock('例 3')?.kind).toBe('example')
    expect(classifyTeachingBlock('2. Common Mistakes')?.kind).toBe('commonMistake')
    expect(classifyTeachingBlock('Key Takeaways')?.kind).toBe('summary')
    // 定义域 is "domain", not a definition; plain sections keep exact matching.
    expect(classifyTeachingBlock('定义域')).toBeUndefined()
    expect(classifyTeachingBlock('Summary of row operations')).toBeUndefined()
  })

  it('keeps a titled heading (with its maths) inside the block', () => {
    const sections = parseLessonSections('## Example 2: Solve $Ax = b$\n\nStart with the matrix.')
    expect(sections[0]?.spec?.kind).toBe('example')
    expect(sections[0]?.blocks[0]).toMatchObject({ kind: 'heading' })
  })
})

describe('R34 — lab symbol glyphs never wrap mid-expression', () => {
  it('renders each glyph in a no-wrap, scrollable cell', () => {
    const { container } = render(
      <TutorSymbolsPanel
        symbols={[
          {
            latex: '\\mathbf{A}',
            displayLatex: '\\mathbf{A}\\mathbf{x} = \\mathbf{b}',
            name: 'System',
          },
        ]}
      />,
    )
    const glyph = container.querySelector('[data-symbol-glyph]')
    expect(glyph?.className).toContain('whitespace-nowrap')
    expect(glyph?.className).toContain('overflow-x-auto')
  })
})

describe('R32 — equation_2d figure', () => {
  it('drops a legend label that only repeats its equation', () => {
    expect(legendLabelFor({ latex: 'y = 2x + 1', label: 'y=2x+1' })).toBeUndefined()
    expect(legendLabelFor({ latex: 'x + y = 4', label: '$x + y = 4$' })).toBeUndefined()
    expect(legendLabelFor({ latex: 'x + y = 4', label: 'Budget line' })).toBe('Budget line')
  })

  it('is width-constrained and shows no legend for a lone self-labelled equation', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={{
          schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
          placement: { scope: 'lesson' },
          id: 'equation_2d-0',
          type: 'equation_2d',
          expressions: [{ latex: 'y = 2x + 1', relation: '=', label: 'y = 2x + 1' }],
        }}
      />,
    )
    const figure = container.querySelector('figure')
    expect(figure?.className).toContain('max-w-[37rem]')
    expect(screen.queryByRole('list', { name: /legend/i })).not.toBeInTheDocument()
  })
})
