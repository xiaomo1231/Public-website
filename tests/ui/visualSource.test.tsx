import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VisualSourceFigure } from '@/widgets/source/VisualSourceFigure'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import type { TutorLesson, TutorVisual } from '@/entities/tutorLesson/types'
import type { UseTutorLessonState } from '@/features/tutor/useTutorLesson'

const VISUAL: TutorVisual = {
  id: 'visual-1',
  documentId: 'doc-1',
  pageNumber: 12,
  type: 'diagram',
  caption: 'Figure from course material, page 12.',
  hasImage: false,
}

function lesson(overrides: Partial<TutorLesson> = {}): TutorLesson {
  return {
    id: 'lesson-1',
    projectId: 'p1',
    topicId: 't1',
    language: 'en',
    content: '## Definition\n\nThe symmetric difference of two sets.',
    symbols: [],
    sourceChunkIds: ['chunk-1'],
    contentHash: 'abc',
    promptVersion: 'v1',
    generatedAt: 1,
    updatedAt: 1,
    version: 2,
    ...overrides,
  }
}

function state(overrides: Partial<UseTutorLessonState> = {}): UseTutorLessonState {
  return {
    status: 'ready',
    lesson: lesson(),
    fromCache: true,
    streaming: false,
    regenerating: false,
    regenerate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('VisualSourceFigure', () => {
  it('shows the provenance caption and a fallback when no image is stored', () => {
    render(<VisualSourceFigure visual={VISUAL} />)
    expect(screen.getByText('Figure from course material, page 12.')).toBeInTheDocument()
    expect(screen.getByText('The original figure could not be displayed.')).toBeInTheDocument()
  })

  it('does not attempt to load bytes when the visual has no image', () => {
    // `hasImage: false` short-circuits before any repository access.
    const { container } = render(<VisualSourceFigure visual={VISUAL} />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})

describe('TutorLessonView — visual sources', () => {
  it('renders a figures section when the lesson has visuals', () => {
    render(
      <MemoryRouter>
        <TutorLessonView topicName="Symmetric Difference" state={state({ lesson: lesson({ visuals: [VISUAL] }) })} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Figures from the source' })).toBeInTheDocument()
    expect(screen.getByText('Figure from course material, page 12.')).toBeInTheDocument()
  })

  it('does not render a figures section when there are no visuals', () => {
    render(
      <MemoryRouter>
        <TutorLessonView topicName="Sets" state={state()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: 'Figures from the source' })).not.toBeInTheDocument()
  })
})
