import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import { QuestionWindowButton, QuestionWindowLayer } from '@/widgets/homework/QuestionWindowLayer'
import { resetQuestionTranslationsForTests } from '@/features/homework/questionTranslationRuns'
import {
  QUESTION_WINDOW_MIN,
  clampQuestionRect,
  convertQuestionPin,
  useQuestionWindows,
} from '@/features/homework/questionWindowStore'
import { translationSourceHash } from '@/entities/homework/questionTranslation'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'
import { installPointerEvent } from '../helpers/pointerEvent'

const translate = vi.hoisted(() => vi.fn())
vi.mock('@/services/questionTranslationService', () => ({
  buildQuestionTranslationService: async () => ({ translate, hasAI: () => true }),
}))

const PROMPT = 'Find the rank of $A$ and use 3 rows.'

vi.mock('@/features/homework/useWalkthrough', () => {
  const question = {
    id: 'qw',
    setId: 's1',
    order: 0,
    number: '4',
    prompt: 'Solve the system for 2 unknowns.',
  }
  return {
    useWalkthrough: () => ({
      state: {
        language: 'en',
        questions: [question],
        plan: [
          {
            id: 'q:qw',
            kind: 'question',
            question,
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: {
              id: 'q:qw',
              kind: 'question',
              questionId: 'qw',
              title: 'q:qw',
              conclusion: 'Unique solution.',
              body: 'Working.',
              status: 'ready',
              inputHash: 'h',
              generatedAt: 1,
            },
          },
        ],
      },
      notes: [],
      progress: undefined,
      loading: false,
      error: null,
      generate: vi.fn(),
      aiReady: true,
      regenerateSection: vi.fn(),
      generateVariants: vi.fn(),
      restorePrevious: vi.fn(),
      setSource: vi.fn(),
      setLevel: vi.fn(),
    }),
  }
})
vi.mock('@/features/homework/useHomeworkService', () => ({ useHomeworkService: () => null }))

function question(id: string, number: string, prompt = PROMPT): HomeworkQuestion {
  return {
    id,
    projectId: 'p1',
    setId: 's1',
    documentId: 'd1',
    documentName: 'hw.txt',
    order: Number(number) - 1,
    number,
    prompt,
    sourceRefs: [],
    hints: [],
    generationStatus: 'ready',
    promptVersion: 'v1',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  } as HomeworkQuestion
}

function stubService(q: HomeworkQuestion): HomeworkService {
  return {
    loadQuestionSourcePages: vi.fn(async () => []),
    resolveQuestionSources: vi.fn(async () => []),
    saveDraft: vi.fn(async () => q),
    listAnswerImages: vi.fn(async () => []),
  } as unknown as HomeworkService
}

const translation = {
  language: 'zh' as const,
  sourceHash: translationSourceHash(PROMPT),
  promptVersion: 'question-translate/v1',
  text: '求 $A$ 的秩，用 3 行。',
  createdAt: 1,
}

function windows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-question-window]'))
}

beforeEach(() => {
  translate.mockReset()
  resetQuestionTranslationsForTests()
  useQuestionWindows.setState({ windows: [], nextZ: 1 })
  window.localStorage.clear()
})
afterEach(() => {
  useQuestionWindows.setState({ windows: [], nextZ: 1 })
})

describe('原题浮动窗口', () => {
  it('opens from 查看原题 in the walkthrough, showing only the question', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <HomeworkWalkthroughPanel
          set={{ id: 's1', projectId: 'p1', walkthroughNoticeSeenAt: 1 } as unknown as HomeworkSet}
          mode="review"
        />
        <QuestionWindowLayer setId="s1" />
      </MemoryRouter>,
    )
    const section = document.getElementById('wt-q:qw')!
    await user.click(within(section).getByRole('button', { name: /floating window/i }))
    const dialog = screen.getByRole('dialog', { name: 'Question 4' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(dialog.textContent).toContain('Solve the system')
    expect(dialog.textContent).not.toContain('Unique solution')
    expect(dialog).toHaveFocus()
  })

  it('opens from the question view, one window per question, and stays across questions', async () => {
    const user = userEvent.setup()
    const q1 = question('q1', '1')
    const q2 = question('q2', '2', 'Compute the determinant of $B$.')
    const view = (q: HomeworkQuestion): JSX.Element => (
      <MemoryRouter>
        <HomeworkQuestionView key={q.id} question={q} service={stubService(q)} />
        <QuestionWindowLayer setId="s1" />
      </MemoryRouter>
    )
    const { rerender, unmount } = render(view(q1))
    const open = screen.getByRole('button', { name: /floating window/i })
    await user.click(open)
    expect(windows()).toHaveLength(1)
    // Again: the same window comes forward, no second one.
    await user.click(open)
    expect(windows()).toHaveLength(1)

    // Another question: the first window stays; a second one can open.
    rerender(view(q2))
    expect(screen.getByRole('dialog', { name: 'Question 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    expect(windows()).toHaveLength(2)

    // Esc closes the focused window and gives focus back to its opener.
    const second = screen.getByRole('dialog', { name: 'Question 2' })
    fireEvent.keyDown(second, { key: 'Escape' })
    expect(windows()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /floating window/i })).toHaveFocus()

    // Leaving the set closes its windows.
    unmount()
    expect(useQuestionWindows.getState().windows).toHaveLength(0)
  })

  it('translates inside the window once, then uses the cache', async () => {
    const user = userEvent.setup()
    translate.mockResolvedValue(translation)
    render(
      <>
        <QuestionWindowButton question={question('q1', '1')} />
        <QuestionWindowLayer setId="s1" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    const dialog = screen.getByRole('dialog')
    const [original, chinese] = within(
      within(dialog).getByRole('group', { name: /language/i }),
    ).getAllByRole('button')
    await user.click(chinese!)
    expect(await within(dialog).findByText(/求/)).toBeInTheDocument()
    await user.click(original!)
    await user.click(chinese!)
    expect(translate).toHaveBeenCalledTimes(1)

    // Closed and opened again in this visit: still no second request.
    await user.click(within(dialog).getByRole('button', { name: /^close$/i }))
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    const again = screen.getByRole('dialog')
    expect(again.textContent).toContain('求')
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('asks for no new translation in a mock exam, but shows one already made', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <>
        <QuestionWindowButton question={question('q1', '1')} translationMode="cached" />
        <QuestionWindowLayer setId="s1" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('group', { name: /language/i })).toBeNull()
    expect(dialog.querySelector('[data-translation-unavailable]')).not.toBeNull()
    expect(translate).not.toHaveBeenCalled()
    unmount()

    render(
      <>
        <QuestionWindowButton
          question={{ ...question('q3', '3'), translation }}
          translationMode="cached"
        />
        <QuestionWindowLayer setId="s1" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    const cached = screen.getByRole('dialog')
    const tabs = within(within(cached).getByRole('group', { name: /language/i })).getAllByRole(
      'button',
    )
    await user.click(tabs[1]!)
    expect(cached.textContent).toContain('求')
    expect(translate).not.toHaveBeenCalled()
  })

  it('changes the font size and remembers the layout per question', async () => {
    const user = userEvent.setup()
    render(
      <>
        <QuestionWindowButton question={question('q1', '1')} />
        <QuestionWindowLayer setId="s1" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: /floating window/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /larger text/i }))
    expect(useQuestionWindows.getState().windows[0]!.fontStep).toBe(3)
    act(() =>
      useQuestionWindows.getState().setRect('q1', { x: 40, y: 50, width: 300, height: 200 }),
    )
    const stored = JSON.parse(window.localStorage.getItem('ai-learning:question-window:q1')!)
    expect(stored).toMatchObject({ rect: { x: 40, y: 50 }, pinned: true, fontStep: 3 })
  })

  it('keeps a dragged and a resized window inside the viewport', async () => {
    const restore = installPointerEvent()
    try {
      const user = userEvent.setup()
      render(
        <>
          <QuestionWindowButton question={question('q1', '1')} />
          <QuestionWindowLayer setId="s1" />
        </>,
      )
      await user.click(screen.getByRole('button', { name: /floating window/i }))
      const dialog = screen.getByRole('dialog')
      const handle = dialog.querySelector<HTMLElement>('[data-drag-handle]')!
      fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerType: 'mouse' })
      fireEvent.pointerMove(window, {
        clientX: 5000,
        clientY: 5000,
        buttons: 1,
        pointerType: 'mouse',
      })
      fireEvent.pointerUp(window, { pointerType: 'mouse' })
      const moved = useQuestionWindows.getState().windows[0]!.rect
      expect(moved.x + moved.width).toBeLessThanOrEqual(window.innerWidth - 12)
      expect(moved.y + moved.height).toBeLessThanOrEqual(window.innerHeight - 12)

      const grip = dialog.querySelector<HTMLElement>('[data-resize-handle]')!
      fireEvent.pointerDown(grip, { button: 0, clientX: 100, clientY: 100, pointerType: 'mouse' })
      fireEvent.pointerMove(window, {
        clientX: -5000,
        clientY: -5000,
        buttons: 1,
        pointerType: 'mouse',
      })
      fireEvent.pointerUp(window, { pointerType: 'mouse' })
      const resized = useQuestionWindows.getState().windows[0]!.rect
      expect(resized.width).toBe(QUESTION_WINDOW_MIN.width)
      expect(resized.height).toBe(QUESTION_WINDOW_MIN.height)
    } finally {
      restore()
    }
  })
})

describe('window geometry', () => {
  it('clamps a dragged or resized window to the viewport', () => {
    const view = { width: 1000, height: 700 }
    expect(clampQuestionRect({ x: -50, y: 900, width: 380, height: 320 }, view)).toEqual({
      x: 12,
      y: 700 - 320 - 12,
      width: 380,
      height: 320,
    })
    const tiny = clampQuestionRect({ x: 0, y: 0, width: 10, height: 10 }, view)
    expect(tiny.width).toBe(QUESTION_WINDOW_MIN.width)
    expect(tiny.height).toBe(QUESTION_WINDOW_MIN.height)
    const huge = clampQuestionRect({ x: 0, y: 0, width: 5000, height: 5000 }, view)
    expect(huge.width).toBe(1000 - 24)
    expect(huge.height).toBe(700 - 24)
  })

  it('pins and unpins without moving on screen', () => {
    const rect = { x: 100, y: 80, width: 300, height: 200 }
    const page = convertQuestionPin(rect, false, { x: 0, y: 500 })
    expect(page.y).toBe(580)
    expect(convertQuestionPin(page, true, { x: 0, y: 500 })).toEqual(rect)
  })
})
