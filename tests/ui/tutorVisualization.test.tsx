import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type {
  LineVisualization,
  PointsVisualization,
  TableVisualization,
} from '@/entities/tutorVisualization/types'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import type { UseTutorLessonState } from '@/features/tutor/useTutorLesson'

const base = {
  schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
  placement: { scope: 'lesson' as const },
}

function functionViz(overrides: Partial<LineVisualization> = {}): LineVisualization {
  return {
    ...base,
    id: 'function_2d-0',
    type: 'function_2d',
    expressions: [{ latex: 'y = 2x + 1', relation: '=' }],
    ...overrides,
  }
}

beforeEach(() => {
  act(() => setUILanguage('en'))
})

describe('TutorVisualizationFigure — line graphs', () => {
  it('renders an accessible figure', () => {
    render(<TutorVisualizationFigure visualization={functionViz()} />)
    const svg = screen.getByRole('img', { name: 'Graph of y = 2x + 1' })
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.querySelector('title')?.textContent).toBe('Graph of y = 2x + 1')
  })

  it('draws one line per expression and a legend when there are several', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          type: 'equation_2d',
          expressions: [
            { latex: 'x + y = 6', relation: '=' },
            { latex: 'x - y = 2', relation: '=' },
          ],
        })}
      />,
    )
    expect(container.querySelectorAll('line[stroke^="hsl(var(--viz-series"]')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'Graph legend' })).toBeInTheDocument()
    // A solved intersection point is shown (4, 2).
    expect(container.textContent).toContain('(4, 2)')
  })

  it('handles a vertical line without producing NaN coordinates', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({ expressions: [{ latex: 'x = 2', relation: '=' }] })}
      />,
    )
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('shades a half-plane for an inequality', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          type: 'inequality_2d',
          expressions: [{ latex: 'y >= 2x - 1', relation: '>=' }],
        })}
      />,
    )
    expect(container.querySelector('polygon')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Shaded region for y >= 2x - 1/ })).toBeInTheDocument()
  })

  it('dashes a strict inequality boundary', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          type: 'inequality_2d',
          expressions: [{ latex: 'y < -x + 3', relation: '<' }],
        })}
      />,
    )
    const line = container.querySelector('line[stroke^="hsl(var(--viz-series"]')
    expect(line?.getAttribute('stroke-dasharray')).toBeTruthy()
  })
})

describe('TutorVisualizationFigure — points and tables', () => {
  const points: PointsVisualization = {
    ...base,
    id: 'points_2d-0',
    type: 'points_2d',
    caption: 'Three points',
    points: [
      { x: -2, y: 3 },
      { x: 0, y: 1 },
      { x: 2, y: 5 },
    ],
  }

  it('renders every point with an accessible label', () => {
    const { container } = render(<TutorVisualizationFigure visualization={points} />)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(
      screen.getByRole('img', { name: 'Plot of the points (-2, 3), (0, 1), (2, 5)' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Three points')).toBeInTheDocument()
  })

  it('renders a table with the original values', () => {
    const table: TableVisualization = {
      ...base,
      id: 'table_2d-0',
      type: 'table_2d',
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 3 },
      ],
    }
    render(<TutorVisualizationFigure visualization={table} />)
    expect(screen.getByRole('table', { name: 'Table of values' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('TutorVisualizationFigure — rendering guarantees', () => {
  it('is responsive: a viewBox, no fixed pixel width, and a clipped container', () => {
    const { container } = render(<TutorVisualizationFigure visualization={functionViz()} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 640 400')
    expect(svg.getAttribute('width')).toBeNull()
    expect(svg.getAttribute('class')).toContain('w-full')
    expect(svg.parentElement?.getAttribute('class')).toContain('overflow-hidden')
    expect(svg.parentElement?.getAttribute('class')).toContain('max-w-full')
  })

  it('draws with theme tokens rather than hardcoded colours', () => {
    const { container } = render(<TutorVisualizationFigure visualization={functionViz()} />)
    const markup = container.innerHTML
    expect(markup).toContain('var(--viz-')
    // No literal colours anywhere: everything goes through a theme token.
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(markup).not.toMatch(/rgba?\(/)
    expect(container.querySelector('line[stroke^="hsl(var(--viz-grid"]')).toBeInTheDocument()
    expect(container.querySelector('line[stroke^="hsl(var(--viz-series"]')).toBeInTheDocument()
  })

  it('keeps injected markup inert', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({ caption: '<script>window.__pwned = true</script>' })}
      />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('renders nothing for a visualization whose maths cannot be parsed', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({ expressions: [{ latex: 'y = x^2', relation: '=' }] })}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TutorLessonView — visualization section', () => {
  function lesson(overrides: Partial<TutorLesson> = {}): TutorLesson {
    return {
      id: 'lesson-1',
      projectId: 'p1',
      topicId: 't1',
      language: 'en',
      content: '## Overview\n\nA line \\(y = 2x + 1\\).',
      symbols: [],
      sourceChunkIds: [],
      contentHash: 'hash',
      promptVersion: 'v1',
      generatedAt: 1,
      updatedAt: 1,
      version: 3,
      ...overrides,
    }
  }

  function state(l: TutorLesson): UseTutorLessonState {
    return {
      status: 'ready',
      lesson: l,
      fromCache: true,
      streaming: false,
      regenerating: false,
      regenerate: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('shows the generated graph', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Linear Functions"
          state={state(lesson({ visualizations: [functionViz()] }))}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Visualizations' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Graph of y = 2x + 1' })).toBeInTheDocument()
  })

  it('renders an old cached lesson with no visualizations', () => {
    render(
      <MemoryRouter>
        <TutorLessonView topicName="Linear Functions" state={state(lesson())} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: 'Visualizations' })).not.toBeInTheDocument()
    expect(screen.getByText(/A line/)).toBeInTheDocument()
  })
})

describe('TutorVisualizationFigure — responsive sizing', () => {
  class ControlledResizeObserver {
    static instances: ControlledResizeObserver[] = []
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      ControlledResizeObserver.instances.push(this)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    emit(width: number): void {
      this.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
  }

  it('switches to a narrow viewBox so in-SVG text keeps its size', () => {
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver
    ControlledResizeObserver.instances = []
    try {
      const { container } = render(<TutorVisualizationFigure visualization={functionViz()} />)
      const svg = container.querySelector('svg')!
      // Before any measurement the wide default applies (unchanged behaviour).
      expect(svg.getAttribute('viewBox')).toBe('0 0 640 400')

      act(() => {
        ControlledResizeObserver.instances[0]!.emit(325)
      })

      // A phone-width container gets a square viewBox rendered at scale 1, so
      // the 11px labels stay 11px instead of shrinking to ~5.6px.
      expect(svg.getAttribute('viewBox')).toBe('0 0 325 325')
      expect(svg.querySelector('g[font-size="11"]')).toBeInTheDocument()
      expect(container.innerHTML).not.toContain('NaN')
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

describe('TutorVisualizationFigure — nonlinear curves (Phase 2)', () => {
  it('renders a nonlinear function as a polyline without NaN or Infinity', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          expressions: [{ latex: 'y = x^2', relation: '=', expression: 'x^2' }],
        })}
      />,
    )
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('splits a reciprocal into independent polylines', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          expressions: [{ latex: 'y = 1/x', relation: '=', expression: '1/x' }],
        })}
      />,
    )
    expect(container.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(2)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('renders a mixed linear + nonlinear graph with a legend', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          expressions: [
            { latex: 'y = 2x + 1', relation: '=' },
            { latex: 'y = x^2', relation: '=', expression: 'x^2' },
          ],
        })}
      />,
    )
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('line[stroke^="hsl(var(--viz-series"]').length).toBe(1)
    expect(screen.getByRole('list', { name: 'Graph legend' })).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('falls back to nothing when the expression is unsupported', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={functionViz({
          expressions: [{ latex: 'y = tan(x)', relation: '=', expression: 'tan(x)' }],
        })}
      />,
    )
    // Unsupported maths is never drawn as a guessed graph.
    expect(container).toBeEmptyDOMElement()
  })
})
