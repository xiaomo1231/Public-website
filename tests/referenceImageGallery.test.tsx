import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReferenceImageGallery } from '@/widgets/tutor/ReferenceImageGallery'
import type { UseReferenceImagesState } from '@/features/tutor/useReferenceImages'
import type { ReferenceImage } from '@/entities/referenceImage/types'

const image: ReferenceImage = {
  id: 'r1',
  projectId: 'p',
  topicId: 't',
  source: 'wikimedia',
  query: 'mitochondrion diagram',
  purpose: 'Mitochondrion structure',
  title: 'Mitochondrion',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Mito.png',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  author: 'Jane Doe',
  relevance: 'unverified',
  mimeType: 'image/png',
  createdAt: 1,
}

function state(overrides: Partial<UseReferenceImagesState>): UseReferenceImagesState {
  return {
    available: true,
    images: [],
    searching: false,
    searchedEmpty: false,
    search: vi.fn(),
    remove: vi.fn(),
    loadImage: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

describe('reference image gallery', () => {
  it('stays hidden when the feature is off and nothing is cached', () => {
    const { container } = render(<ReferenceImageGallery state={state({ available: false })} hasCourseFigures={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('prefers course figures: no search button when the lesson has its own', () => {
    render(<ReferenceImageGallery state={state({ images: [image] })} hasCourseFigures />)
    expect(screen.queryByRole('button', { name: /Find/ })).not.toBeInTheDocument()
    expect(screen.getByText('Mitochondrion structure')).toBeInTheDocument()
  })

  it('shows the source, licence, author and the unverified note', () => {
    render(<ReferenceImageGallery state={state({ images: [image] })} hasCourseFigures={false} />)
    expect(screen.getByRole('button', { name: 'Find more' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Mitochondrion/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeInTheDocument()
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument()
    expect(screen.getByText('Reference picture — may not match exactly')).toBeInTheDocument()
  })
})
