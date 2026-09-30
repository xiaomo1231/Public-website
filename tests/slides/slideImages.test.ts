import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { ProcessingService } from '@/services/processingService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { extractPptxSlideImages } from '@/infrastructure/files/pptxExtractor'
import { makeTestPptx } from '../fixtures/makeTestPptx'

describe('extractPptxSlideImages', () => {
  it('extracts the images a slide embeds', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'Diagram', body: 'Look at the figure.', images: [{ name: 'diagram.png' }] },
        { title: 'Plain', body: 'No image here.' },
      ],
    })
    const images = await extractPptxSlideImages(blob)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ slideNumber: 1, mimeType: 'image/png' })
    expect(images[0]!.bytes.byteLength).toBeGreaterThanOrEqual(1024)
  })

  it('ignores images below the size floor (icons/bullets)', async () => {
    const blob = await makeTestPptx({
      slides: [
        {
          title: 'Icons',
          body: 'Bullets.',
          images: [{ name: 'icon.png', bytes: new Uint8Array(200) }],
        },
      ],
    })
    expect(await extractPptxSlideImages(blob)).toHaveLength(0)
  })

  it('returns nothing for a presentation with no images', async () => {
    const blob = await makeTestPptx({ slides: [{ title: 'Text only', body: 'Words.' }] })
    expect(await extractPptxSlideImages(blob)).toEqual([])
  })
})

describe('ProcessingService — slide images', () => {
  let db: AppDatabase
  let projectId: string
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let jobs: ProcessingJobRepository
  let visuals: VisualSourceRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    jobs = new ProcessingJobRepository(db)
    visuals = new VisualSourceRepository(db)
    const project = await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })
    projectId = project.id
  })

  it('preserves a slide image and binds it to the slide number', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'Force', body: 'A force has magnitude and direction.', images: [{ name: 'arrow.png' }] },
        { title: 'Energy', body: 'Energy is conserved.' },
      ],
    })
    const doc = await documents.create({
      projectId,
      type: 'pptx',
      name: 'lecture.pptx',
      sizeBytes: 0,
      blob,
    })
    await new ProcessingService({ documents, chunks, jobs, projects: new ProjectService(db), visuals }).process(doc.id)

    const sources = await visuals.listByDocument(doc.id)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      projectId,
      documentId: doc.id,
      pageNumber: 1,
      imageMimeType: 'image/png',
    })
    // The visual references the real chunks of its own slide.
    expect(sources[0]!.sourceChunkIds.length).toBeGreaterThan(0)
    expect(await visuals.getImage(sources[0]!.id)).toBeTruthy()
  })
})
