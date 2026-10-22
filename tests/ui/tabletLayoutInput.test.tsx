import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import {
  isTextEntry,
  keyboardInsetFrom,
  MIN_KEYBOARD_INSET,
  revealScrollDelta,
} from '@/shared/lib/keyboardInset'
import { answerFieldAttrs } from '@/shared/lib/answerFieldAttrs'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { Input } from '@/shared/ui/Input'
import { MathField } from '@/widgets/mathInput/MathField'
import { MatrixInputGrid } from '@/widgets/homework/guided/MatrixParts'
import { isPalmContact, initialBoard } from '@/widgets/handwriting/strokeModel'
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { useTutorLesson } from '@/features/tutor/useTutorLesson'
import { TutorPage } from '@/pages/TutorPage'
import type { Topic } from '@/entities/courseAnalysis/types'

vi.mock('@/features/tutor/useProjectTopics', () => ({ useProjectTopics: vi.fn() }))
vi.mock('@/features/tutor/useTutorLesson', () => ({ useTutorLesson: vi.fn() }))
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

beforeEach(() => {
  act(() => setUILanguage('en'))
})

describe('on-screen keyboard geometry', () => {
  it('reports the hidden part of the layout viewport only when it is a keyboard', () => {
    expect(keyboardInsetFrom(1024, { height: 1024, offsetTop: 0 })).toBe(0)
    expect(keyboardInsetFrom(1024, { height: 640, offsetTop: 0, scale: 1 })).toBe(384)
    // Browser chrome jitter is not a keyboard.
    expect(keyboardInsetFrom(1024, { height: 1024 - (MIN_KEYBOARD_INSET - 1), offsetTop: 0 })).toBe(
      0,
    )
    // Pinch zoom shrinks the visual viewport for another reason.
    expect(keyboardInsetFrom(1024, { height: 500, offsetTop: 0, scale: 2 })).toBe(0)
    expect(keyboardInsetFrom(0, { height: 500, offsetTop: 0 })).toBe(0)
  })

  it('scrolls just enough to keep a field above the keyboard', () => {
    const visible = { top: 0, bottom: 600 }
    // Already visible with margin.
    expect(revealScrollDelta({ top: 100, bottom: 144 }, visible, 24)).toBe(0)
    // Behind the keyboard: scroll down so its bottom sits 24px above it.
    expect(revealScrollDelta({ top: 700, bottom: 744 }, visible, 24)).toBe(168)
    // Above the top edge: scroll up.
    expect(revealScrollDelta({ top: -50, bottom: -6 }, visible, 24)).toBe(-74)
    // Taller than the visible area: align the top (caret line) instead.
    expect(revealScrollDelta({ top: 300, bottom: 1300 }, visible, 24)).toBe(276)
  })

  it('treats only text-entry fields as keyboard targets', () => {
    const text = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    const area = document.createElement('textarea')
    const readOnly = document.createElement('textarea')
    readOnly.readOnly = true
    expect(isTextEntry(text)).toBe(true)
    expect(isTextEntry(area)).toBe(true)
    expect(isTextEntry(box)).toBe(false)
    expect(isTextEntry(readOnly)).toBe(false)
    expect(isTextEntry(document.createElement('button'))).toBe(false)
  })
})

describe('touch targets on coarse pointers', () => {
  it('shared buttons and inputs grow to 44px only under `coarse:`', () => {
    expect(buttonVariants({ size: 'default' })).toContain('coarse:h-11')
    expect(buttonVariants({ size: 'sm' })).toContain('coarse:h-11')
    expect(buttonVariants({ size: 'icon' })).toMatch(/coarse:h-11.*coarse:w-11/)
    // Desktop sizes are unchanged.
    expect(buttonVariants({ size: 'default' })).toContain('h-9')
    render(<Input aria-label="field" />)
    expect(screen.getByLabelText('field').className).toContain('coarse:h-11')
  })

  it('the global touch rules sit behind (pointer: coarse)', () => {
    const css = readFileSync(path.resolve(__dirname, '../../src/shared/styles/globals.css'), 'utf8')
    const block = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(block).toContain('touch-action: manipulation')
    expect(block).toContain('min-height: 44px')
    expect(block).toContain('user-select: none')
    expect(css).toContain('--keyboard-inset: 0px')
  })

  it('symbol keys grow on touch', () => {
    render(<MathField mode="expression" value="" onChange={() => undefined} aria-label="ans" />)
    const key = screen.getAllByRole('button', { name: /^insert /i })[0]!
    expect(key.className).toContain('coarse:h-11')
  })
})

describe('Scribble-friendly answer fields', () => {
  it('maps answer kinds to keyboards', () => {
    expect(answerFieldAttrs('number').inputMode).toBe('decimal')
    expect(answerFieldAttrs('fraction').inputMode).toBe('numeric')
    expect(answerFieldAttrs('expression')).toMatchObject({
      inputMode: 'text',
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
    })
    expect(answerFieldAttrs('text').spellCheck).toBe(true)
  })

  it('matrix cells are real inputs with a numeric keyboard', () => {
    render(
      <MatrixInputGrid
        values={[
          ['', ''],
          ['', ''],
        ]}
        onChange={() => undefined}
        onSubmit={() => undefined}
        label="Result"
      />,
    )
    const cells = screen.getAllByRole('textbox')
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      expect(cell.tagName).toBe('INPUT')
      expect(cell).toHaveAttribute('inputmode', 'numeric')
      expect(cell).toHaveAttribute('autocapitalize', 'off')
      expect(cell).toHaveAttribute('enterkeyhint', 'go')
    }
  })

  it('number answers use the decimal keyboard; expressions never auto-capitalise', () => {
    const { unmount } = render(
      <MathField mode="number" value="" onChange={() => undefined} aria-label="num" />,
    )
    expect(screen.getByLabelText('num')).toHaveAttribute('inputmode', 'decimal')
    unmount()
    render(
      <MathField
        mode="expression"
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        aria-label="expr"
      />,
    )
    const field = screen.getByLabelText('expr')
    expect(field.tagName).toBe('INPUT')
    expect(field).toHaveAttribute('inputmode', 'text')
    expect(field).toHaveAttribute('autocapitalize', 'off')
    expect(field).toHaveAttribute('enterkeyhint', 'go')
  })

  it('the Enter-to-submit hint is hidden on touch (a submit button replaces it)', () => {
    render(
      <MathField
        mode="expression"
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        aria-label="expr"
      />,
    )
    expect(screen.getByText(/enter/i).className).toContain('coarse:hidden')
  })
})

describe('pen board palm rejection', () => {
  it('ignores a finger only while the pen is writing or just lifted', () => {
    const idle = initialBoard()
    expect(isPalmContact(idle, 'touch', 1000)).toBe(false)
    const writing = { ...idle, lastPenAt: 900 }
    expect(isPalmContact(writing, 'touch', 1000)).toBe(true)
    expect(isPalmContact(writing, 'pen', 1000)).toBe(false)
    expect(isPalmContact(writing, 'mouse', 1000)).toBe(false)
    expect(isPalmContact(writing, 'touch', 10_000)).toBe(false)
  })
})

describe('tutor contents on iPad widths', () => {
  const TOPICS = [
    { id: 't1', name: 'Row reduction', description: '' },
    { id: 't2', name: 'Determinants', description: '' },
  ] as Topic[]

  function mockWidth(wide: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: wide,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  }

  beforeEach(() => {
    vi.mocked(useProjectTopics).mockReturnValue({
      loading: false,
      analysis: { language: 'en' } as never,
      topics: TOPICS,
    })
    vi.mocked(useTutorLesson).mockReturnValue({
      status: 'idle',
      lesson: null,
      fromCache: false,
      streaming: false,
      regenerating: false,
      generation: null,
      stop: () => undefined,
      stopped: false,
      regenerate: vi.fn(),
    } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPage(): void {
    render(
      <MemoryRouter initialEntries={['/projects/p1/tutor/t1']}>
        <Routes>
          <Route path="/projects/:id/tutor/:topicId" element={<TutorPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('narrow: the contents fold into a toggle showing the current topic', async () => {
    mockWidth(false)
    renderPage()
    const toggle = screen.getByTestId('tutor-toc-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Row reduction')
    expect(document.getElementById('tutor-contents')).not.toBeVisible()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('tutor-contents')).toBeVisible()
    // Picking a topic folds the list again.
    await userEvent.click(screen.getByRole('button', { name: /Determinants/ }))
    expect(screen.getByTestId('tutor-toc-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('wide: the contents column is always shown, no toggle', () => {
    mockWidth(true)
    renderPage()
    expect(screen.queryByTestId('tutor-toc-toggle')).toBeNull()
    expect(document.getElementById('tutor-contents')).toBeVisible()
  })
})
