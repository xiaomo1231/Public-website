import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SlideStudyPage } from '@/pages/SlideStudyPage'
import { StudyModeTabs } from '@/widgets/slides/StudyModeTabs'
import type { SlideLessonService } from '@/services/slideLessonService'
import type { Document } from '@/entities/document/types'
import type { SlideLesson } from '@/entities/slideLesson/types'

const holder = vi.hoisted(() => ({
  service: null as unknown as SlideLessonService,
}))

vi.mock('@/features/slides/useSlideLessonService', () => ({
  useSlideLessonService: () => holder.service,
}))
vi.mock('@/widgets/project/ProjectFlowNav', () => ({ ProjectFlowNav: () => <div /> }))
vi.mock('@/widgets/source/VisualSourceFigure', () => ({
  VisualSourceFigure: () => <div data-testid="slide-image" />,
}))

const DOCUMENT: Document = {
  id: 'd1',
  projectId: 'p1',
  type: 'pptx',
  name: 'Lecture 03.pptx',
  sizeBytes: 0,
  hasBlob: false,
  status: 'ready',
  warnings: [],
  metadata: { slideCount: 10 },
  uploadedAt: 1,
}

function index() {
  return {
    document: DOCUMENT,
    slideTotal: 10,
    slides: Array.from({ length: 10 }, (_, i) => ({
      slideNumber: i + 1,
      chunkCount: 2,
      hasText: true,
      hasImage: i === 1,
    })),
  }
}

function content(slideNumber: number) {
  return {
    document: DOCUMENT,
    slideNumber,
    slideTotal: 10,
    title: `Slide ${slideNumber} title`,
    text: 'The limit of x^2 at 3 is 9.',
    notes: 'Emphasise substitution.',
    blocks: [
      { contentType: 'heading' as const, text: `Slide ${slideNumber} title` },
      { contentType: 'paragraph' as const, text: 'The limit of x^2 at 3 is 9.' },
    ],
    material: 'Title: x\nContent: y',
    chunkIds: ['c1'],
    visuals: [],
  }
}

function readyLesson(): SlideLesson {
  return {
    id: 'l1',
    projectId: 'p1',
    documentId: 'd1',
    documentName: 'Lecture 03.pptx',
    slideNumber: 1,
    slideTotal: 10,
    language: 'en',
    status: 'ready',
    content: 'A limit describes the value a function approaches.',
    question: 'Why can we substitute here?',
    symbols: [],
    sourceChunkIds: ['c1'],
    sourceRefs: [
      { documentId: 'd1', documentName: 'Lecture 03.pptx', page: 1, quote: 'x', chunkId: 'c1' },
    ],
    messages: [],
    contentHash: 'h',
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  }
}

function stubService(overrides: Partial<SlideLessonService> = {}): SlideLessonService {
  return {
    listSlideDocuments: vi.fn(async () => [
      { document: DOCUMENT, slideCount: 10, ready: true },
    ]),
    buildIndex: vi.fn(async () => index()),
    resumeSlideNumber: vi.fn(async () => 1),
    getSlideContent: vi.fn(async (_d: string, n: number) => content(n)),
    getLesson: vi.fn(async () => undefined),
    generate: vi.fn(async () => ({ lesson: readyLesson(), fromCache: false })),
    regenerate: vi.fn(async () => ({ lesson: readyLesson(), fromCache: false })),
    ask: vi.fn(async () => readyLesson()),
    ...overrides,
  } as unknown as SlideLessonService
}

function renderPage(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/slides" element={<SlideStudyPage />} />
        <Route path="/projects/:id/slides/:documentId" element={<SlideStudyPage />} />
        <Route path="/projects/:id/slides/:documentId/:slideNumber" element={<SlideStudyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  holder.service = stubService()
})

describe('StudyModeTabs', () => {
  it('links to both study modes and marks the active one', () => {
    render(
      <MemoryRouter>
        <StudyModeTabs projectId="p1" active="slides" />
      </MemoryRouter>,
    )
    const knowledge = screen.getByRole('link', { name: /By topic/ })
    const slides = screen.getByRole('link', { name: /By slide/ })
    expect(knowledge).toHaveAttribute('href', '/projects/p1/tutor')
    expect(slides).toHaveAttribute('href', '/projects/p1/slides')
    expect(slides).toHaveAttribute('aria-current', 'page')
    expect(knowledge).not.toHaveAttribute('aria-current')
  })
})

describe('SlideStudyPage', () => {
  it('shows the current slide and only generates when asked', async () => {
    renderPage('/projects/p1/slides/d1/1')

    expect((await screen.findAllByText('Slide 1 title')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/The limit of x\^2 at 3 is 9\./).length).toBeGreaterThan(0)
    // No lesson yet: the CTA is shown and the AI has not been called.
    expect(holder.service.generate).not.toHaveBeenCalled()
    const explain = screen.getByRole('button', { name: /Explain this slide/ })

    fireEvent.click(explain)
    expect(await screen.findByText(/A limit describes the value/)).toBeInTheDocument()
    expect(screen.getByText('Why can we substitute here?')).toBeInTheDocument()
    expect(holder.service.generate).toHaveBeenCalledTimes(1)
  })

  it('offers retry with the reason when the slide failed', async () => {
    const failed: SlideLesson = { ...readyLesson(), status: 'failed', content: undefined, errorMessage: 'provider exploded' }
    holder.service = stubService({ getLesson: vi.fn(async () => failed) })
    renderPage('/projects/p1/slides/d1/1')

    expect(await screen.findByText('provider exploded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry this slide/ }))
    await waitFor(() => expect(holder.service.regenerate).toHaveBeenCalledTimes(1))
  })

  it('disables previous on the first slide and enables next', async () => {
    renderPage('/projects/p1/slides/d1/1')
    await screen.findAllByText('Slide 1 title')
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled()
  })

  it('shows an actionable message when the presentation is not ready', async () => {
    const processing = { ...DOCUMENT, status: 'processing' as const }
    holder.service = stubService({
      listSlideDocuments: vi.fn(async () => [
        { document: processing, slideCount: 0, ready: false },
      ]),
    })
    renderPage('/projects/p1/slides/d1/1')
    expect(await screen.findByText(/not ready/i)).toBeInTheDocument()
  })

  it('says so when the project has no presentations', async () => {
    holder.service = stubService({ listSlideDocuments: vi.fn(async () => []) })
    renderPage('/projects/p1/slides')
    expect(await screen.findByText('No presentations yet')).toBeInTheDocument()
  })
})
