import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import { fillMissingExcerpts } from '@/services/citationExcerpts'
import { QuestionSource } from '@/widgets/quiz/QuestionSource'
import type { SourceReference } from '@/entities/courseAnalysis/types'

describe('citations stored without an excerpt', () => {
  let db: AppDatabase
  let chunkIds: string[]

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const chunks = await new ChunkRepository(db).addMany(
      [
        { page: 2, text: 'The subacromial bursa is separated from the joint cavity.' },
        { page: 2, text: 'The subscapular bursa often communicates with it.' },
        { page: 4, text: 'The glenoid labrum deepens the glenoid cavity.' },
      ].map(({ page, text }, order) => ({
        documentId: 'doc',
        projectId: 'p',
        contentType: 'paragraph' as const,
        text,
        sourceReference: 'atlas',
        order,
        pageNumber: page,
      })),
    )
    chunkIds = chunks.map((chunk) => chunk.id)
  })

  const ref = (overrides: Partial<SourceReference>): SourceReference => ({
    documentId: 'doc',
    documentName: 'Shoulder joint, shoulder girdle',
    ...overrides,
  })

  it('shows the cited chunk, or else the cited page, and leaves real excerpts alone', async () => {
    const filled = await fillMissingExcerpts(
      [
        ref({ page: 2 }),
        ref({ chunkId: chunkIds[2]!, page: 4 }),
        ref({ page: 4, quote: 'Kept as recorded.' }),
        ref({ page: 9 }),
        ref({ page: 2, quotePending: true }),
      ],
      db,
    )
    expect(filled[0]).toMatchObject({
      quote: 'The subacromial bursa is separated from the joint cavity. The subscapular bursa often communicates with it.',
      pageExcerpt: true,
    })
    expect(filled[1]).toMatchObject({ quote: 'The glenoid labrum deepens the glenoid cavity.' })
    expect(filled[1]!.pageExcerpt).toBeUndefined()
    expect(filled[2]!.quote).toBe('Kept as recorded.')
    // Nothing on that page, and a homework citation awaiting verification: unchanged.
    expect(filled[3]!.quote).toBeUndefined()
    expect(filled[4]!.quote).toBeUndefined()
  })

  it('renders the page text with a note instead of "no course text found"', async () => {
    render(
      <MemoryRouter>
        <QuestionSource sourceRefs={[ref({ page: 2 }), ref({ page: 4 })]} projectId="p" />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/The subacromial bursa is separated/)).toBeInTheDocument()
    expect(screen.getByText(/The glenoid labrum/)).toBeInTheDocument()
    expect(screen.getAllByText(/exact sentence was not recorded/)).toHaveLength(2)
    expect(screen.queryByText(/No matching course excerpt/i)).toBeNull()
  })
})
