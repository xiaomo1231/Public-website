import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type {
  Eigen2DVisualization,
  GraphVisualization,
  LineVisualization,
  PointsVisualization,
  TableVisualization,
  TransformVisualization,
  VectorsVisualization,
  VennVisualization,
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

function vectorsVisualization(overrides: Partial<VectorsVisualization> = {}): VectorsVisualization {
  return {
    ...base,
    id: 'vectors_2d-0',
    type: 'vectors_2d',
    operation: 'addition',
    vectors: [
      { id: 'v0', x: 2, y: 1, label: 'v', role: 'vector' },
      { id: 'v1', x: 1, y: 3, label: 'w', role: 'vector' },
      { id: 'v2', x: 3, y: 4, label: 'v+w', role: 'result' },
    ],
    ...overrides,
  }
}

function graphVisualization(overrides: Partial<GraphVisualization> = {}): GraphVisualization {
  return {
    ...base,
    id: 'graph_2d-0',
    type: 'graph_2d',
    graphKind: 'directed',
    layout: 'circular',
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    edges: [
      { source: 'a', target: 'b', directed: true, label: 'e1' },
      { source: 'b', target: 'b', directed: true },
    ],
    ...overrides,
  }
}

describe('TutorVisualizationFigure — vectors_2d (Phase 3.0)', () => {
  it('renders one arrow per vector with an accessible label and summary', () => {
    const { container } = render(<TutorVisualizationFigure visualization={vectorsVisualization()} />)
    expect(container.querySelectorAll('line[marker-end]')).toHaveLength(3)
    expect(screen.getByRole('img', { name: 'Vector diagram with 3 vectors' })).toBeInTheDocument()
    expect(screen.getByText(/Vectors:/)).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('uses the same colour slot for a vector line and its arrowhead (regression)', () => {
    const { container } = render(<TutorVisualizationFigure visualization={vectorsVisualization()} />)
    for (const line of container.querySelectorAll('line[marker-end]')) {
      const strokeSlot = /viz-series-(\d)/.exec(line.getAttribute('stroke') ?? '')?.[1]
      const markerSlot = /viz-varrow-(\d)/.exec(line.getAttribute('marker-end') ?? '')?.[1]
      expect(strokeSlot).toBe(markerSlot)
    }
  })

  it('draws a head-to-tail vector from its start point', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={vectorsVisualization({
          operation: 'display',
          vectors: [{ id: 'v0', x: 2, y: 1, start: { x: 1, y: 1 }, label: 't' }],
        })}
      />,
    )
    expect(container.querySelectorAll('line[marker-end]')).toHaveLength(1)
  })

  it('shows a legend that distinguishes roles without relying on colour alone', () => {
    render(<TutorVisualizationFigure visualization={vectorsVisualization()} />)
    expect(screen.getByRole('list', { name: 'Graph legend' })).toBeInTheDocument()
    expect(screen.getByText(/result/)).toBeInTheDocument()
  })

  it('keeps an injected label inert', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={vectorsVisualization({
          vectors: [{ id: 'v0', x: 1, y: 1, label: '<script>window.__pwned = true</script>' }],
        })}
      />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('TutorVisualizationFigure — graph_2d (Phase 3.0)', () => {
  it('renders nodes, directed edges and a self-loop with an accessible summary', () => {
    const { container } = render(<TutorVisualizationFigure visualization={graphVisualization()} />)
    expect(
      screen.getByRole('img', { name: 'Directed graph with 3 nodes and 2 edges' }),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(container.querySelectorAll('line[marker-end]')).toHaveLength(1)
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(1)
    expect(screen.getByText(/Nodes: A, B, C/)).toBeInTheDocument()
    expect(screen.getByText(/Edges:/)).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('renders an undirected edge without an arrow marker', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={graphVisualization({
          graphKind: 'undirected',
          edges: [{ source: 'a', target: 'b' }],
        })}
      />,
    )
    expect(container.querySelectorAll('line')).toHaveLength(1)
    expect(container.querySelector('line')?.getAttribute('marker-end')).toBeNull()
    expect(screen.getByRole('img', { name: 'Undirected graph with 3 nodes and 1 edges' })).toBeInTheDocument()
  })

  it('renders a bipartite layout in two columns', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={graphVisualization({
          graphKind: 'undirected',
          layout: 'bipartite',
          nodes: [
            { id: 'a', label: 'A', partition: 'left' },
            { id: 'b', label: 'B', partition: 'right' },
          ],
          edges: [{ source: 'a', target: 'b' }],
        })}
      />,
    )
    const circles = [...container.querySelectorAll('circle')]
    const left = Number(circles[0]?.getAttribute('cx'))
    const right = Number(circles[1]?.getAttribute('cx'))
    expect(left).toBeLessThan(right)
  })

  it('constrains a long node label so it cannot overflow the node (regression)', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={graphVisualization({
          nodes: [{ id: 'a', label: 'A very long node label' }],
          edges: [],
        })}
      />,
    )
    const text = container.querySelector('svg text')
    expect(text?.textContent).toMatch(/…$/)
    expect(text?.getAttribute('textLength')).toBeTruthy()
  })

  it('keeps an injected node label inert', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={graphVisualization({
          nodes: [{ id: 'a', label: '<svg onload="window.__pwned = true"></svg>' }],
          edges: [],
        })}
      />,
    )
    expect(container.querySelector('svg[onload]')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

function transformVisualization(
  overrides: Partial<TransformVisualization> = {},
): TransformVisualization {
  return {
    ...base,
    id: 'transform_2d-0',
    type: 'transform_2d',
    matrix: { a: 2, b: 0, c: 0, d: 1 },
    vectors: [{ id: 't0', x: 1, y: 1, label: 'v' }],
    showBasis: true,
    showUnitSquare: true,
    showGrid: true,
    showArea: true,
    ...overrides,
  }
}

function vennVisualization(overrides: Partial<VennVisualization> = {}): VennVisualization {
  return {
    ...base,
    id: 'venn_2d-0',
    type: 'venn_2d',
    operation: 'intersection',
    operands: ['a', 'b'],
    sets: [
      { id: 'a', label: 'A', elements: ['1', '2', '3'] },
      { id: 'b', label: 'B', elements: ['3', '4', '5'] },
    ],
    ...overrides,
  }
}

describe('TutorVisualizationFigure — transform_2d (Phase 3.1)', () => {
  it('renders the matrix, the two squares and the determinant fact', () => {
    const { container } = render(
      <TutorVisualizationFigure visualization={transformVisualization()} />,
    )
    expect(screen.getByRole('img', { name: 'A 2D linear transformation' })).toBeInTheDocument()
    // Original unit square + transformed parallelogram.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('det A = 2')
    expect(container.textContent).toContain('area scaled by 2')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('renders a degenerate transformation safely', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={transformVisualization({ matrix: { a: 1, b: 0, c: 0, d: 0 } })}
      />,
    )
    expect(container.textContent).toContain('collapses onto a line')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('does not rely on colour alone for original vs image (dashed vs solid)', () => {
    const { container } = render(
      <TutorVisualizationFigure visualization={transformVisualization()} />,
    )
    const dashed = [...container.querySelectorAll('[stroke-dasharray]')]
    expect(dashed.length).toBeGreaterThan(0)
  })

  it('uses the same colour slot for each transform arrow and its head (regression)', () => {
    const { container } = render(
      <TutorVisualizationFigure visualization={transformVisualization()} />,
    )
    const arrows = [...container.querySelectorAll('line[marker-end]')]
    expect(arrows.length).toBeGreaterThan(0)
    for (const line of arrows) {
      const strokeSlot = /viz-series-(\d)/.exec(line.getAttribute('stroke') ?? '')?.[1]
      const markerSlot = /viz-varrow-(\d)/.exec(line.getAttribute('marker-end') ?? '')?.[1]
      expect(strokeSlot).toBe(markerSlot)
    }
  })
})

describe('TutorVisualizationFigure — venn_2d (Phase 3.1)', () => {
  it('renders two circles with a highlighted intersection and a summary', () => {
    const { container } = render(<TutorVisualizationFigure visualization={vennVisualization()} />)
    expect(screen.getByRole('img', { name: 'Venn diagram of 2 sets' })).toBeInTheDocument()
    // Base circles are direct children of a group; clip/mask circles live in defs.
    expect(container.querySelectorAll('svg > g > circle')).toHaveLength(2)
    expect(container.querySelectorAll('mask').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Result = 3')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('renders three circles for a three-set diagram', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={vennVisualization({
          sets: [
            { id: 'a', label: 'A', elements: ['1', '2', '3'] },
            { id: 'b', label: 'B', elements: ['3', '4', '5'] },
            { id: 'c', label: 'C', elements: ['3', '5', '7'] },
          ],
          operands: ['a', 'b', 'c'],
        })}
      />,
    )
    expect(container.querySelectorAll('svg > g > circle')).toHaveLength(3)
  })

  it('keeps injected set elements inert', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={vennVisualization({
          sets: [
            { id: 'a', label: 'A', elements: ['<script>window.__pwned = true</script>'] },
            { id: 'b', label: 'B', elements: ['2'] },
          ],
        })}
      />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

function eigenVisualization(
  overrides: Partial<Eigen2DVisualization> = {},
): Eigen2DVisualization {
  return {
    ...base,
    id: 'eigen_2d-0',
    type: 'eigen_2d',
    matrix: { a: 2, b: 1, c: 1, d: 2 },
    eigenpairs: [
      { value: 3, vector: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, label: 'v1' },
      { value: 1, vector: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, label: 'v2' },
    ],
    fullEigenspace: false,
    defective: false,
    showUnitCircle: true,
    showTransform: true,
    ...overrides,
  }
}

describe('TutorVisualizationFigure — eigen_2d (Phase 3.2)', () => {
  it('renders the matrix, one arrow per eigenpair and the λ values', () => {
    const { container } = render(<TutorVisualizationFigure visualization={eigenVisualization()} />)
    expect(screen.getByRole('img', { name: 'Eigenvector diagram' })).toBeInTheDocument()
    expect(container.textContent).toContain('λ = 3')
    expect(container.textContent).toContain('Av1 = (2.12, 2.12)')
    expect(container.querySelectorAll('line[marker-end]').length).toBeGreaterThanOrEqual(4)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('marks λ = 0 as a point at the origin', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={eigenVisualization({
          matrix: { a: 0, b: 0, c: 0, d: 1 },
          eigenpairs: [{ value: 0, vector: { x: 1, y: 0 } }],
        })}
      />,
    )
    expect(container.textContent).toContain('mapped to the origin')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('shows the defective note with a single direction', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={eigenVisualization({
          matrix: { a: 2, b: 1, c: 0, d: 2 },
          eigenpairs: [{ value: 2, vector: { x: 1, y: 0 } }],
          defective: true,
        })}
      />,
    )
    expect(container.textContent).toContain('defective')
    expect(container.querySelectorAll('line[marker-end]')).toHaveLength(2)
  })

  it('shows the whole-plane note for a scalar matrix', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={eigenVisualization({
          matrix: { a: 3, b: 0, c: 0, d: 3 },
          eigenpairs: [
            { value: 3, vector: { x: 1, y: 0 } },
            { value: 3, vector: { x: 0, y: 1 } },
          ],
          fullEigenspace: true,
        })}
      />,
    )
    expect(container.textContent).toContain('every non-zero vector is an eigenvector')
  })

  it('keeps an injected label inert', () => {
    const { container } = render(
      <TutorVisualizationFigure
        visualization={eigenVisualization({
          eigenpairs: [
            { value: 3, vector: { x: 1, y: 1 }, label: '<script>window.__pwned = true</script>' },
          ],
        })}
      />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('TutorLessonView — visualization placement', () => {
  function lesson(overrides: Partial<TutorLesson> = {}): TutorLesson {
    return {
      id: 'lesson-1',
      projectId: 'p1',
      topicId: 't1',
      language: 'en',
      content: [
        '## Example',
        '',
        'A = [[2, 0], [0, 1]].',
        '',
        '## Summary',
        '',
        'Done.',
      ].join('\n'),
      symbols: [],
      sourceChunkIds: [],
      contentHash: 'hash',
      promptVersion: 'v2',
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

  it('places a section-anchored figure inline and not in the trailing section', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Linear transformations"
          state={state(
            lesson({
              visualizations: [
                transformVisualization({ placement: { scope: 'section', block: 'example', index: 0 } }),
              ],
            }),
          )}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'A 2D linear transformation' })).toBeInTheDocument()
    // It was anchored, so there is no trailing "Visualizations" heading.
    expect(screen.queryByRole('heading', { name: 'Visualizations' })).not.toBeInTheDocument()
  })

  it('keeps a lesson-scope figure in the trailing section', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Linear transformations"
          state={state(lesson({ visualizations: [transformVisualization()] }))}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Visualizations' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'A 2D linear transformation' })).toBeInTheDocument()
  })

  it('renders an old cached lesson with no visualizations', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Linear transformations"
          state={state(lesson({ visualizations: undefined }))}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: 'Visualizations' })).not.toBeInTheDocument()
    expect(screen.getByText(/A = \[\[2, 0\]/)).toBeInTheDocument()
  })

  it('keeps a markdown table in its Example section and still anchors the figure', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Linear transformations"
          state={state(
            lesson({
              content: [
                '## Example',
                '',
                '| P | Q |',
                '| --- | --- |',
                '| T | T |',
                '',
                '## Summary',
                '',
                'Done.',
              ].join('\n'),
              visualizations: [
                transformVisualization({ placement: { scope: 'section', block: 'example', index: 0 } }),
              ],
            }),
          )}
        />
      </MemoryRouter>,
    )
    // The table renders, the anchored figure renders, and nothing trails.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'A 2D linear transformation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Visualizations' })).not.toBeInTheDocument()
  })
})
