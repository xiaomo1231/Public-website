import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProcessingService } from '@/services/processingService'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { t } from '@/i18n'

/**
 * End-to-end guard for the extraction → chunk → storage path.
 *
 * pdf.js assigns Private Use Area code points to glyphs it cannot map to
 * Unicode. Those code points must survive normalisation untouched (we cannot
 * reconstruct them), while genuinely meaningless control characters are
 * removed and the user is warned.
 */
describe('extraction text-encoding pipeline', () => {
  let db: AppDatabase
  let documentsRepo: DocumentRepository
  let chunksRepo: ChunkRepository
  let processing: ProcessingService
  let documentsSvc: DocumentService
  let projectId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    documentsRepo = new DocumentRepository(db)
    chunksRepo = new ChunkRepository(db)
    const jobs = new ProcessingJobRepository(db)
    documentsSvc = new DocumentService({ documents: documentsRepo, projects })
    processing = new ProcessingService({
      documents: documentsRepo,
      chunks: chunksRepo,
      jobs,
      projects,
    })
  })

  async function ingest(text: string) {
    const blob = new Blob([text], { type: 'text/plain' })
    const doc = await documentsSvc.create({
      projectId,
      type: 'text',
      name: 'lecture.txt',
      sizeBytes: blob.size,
      blob,
    })
    await processing.process(doc.id)
    const refreshed = await documentsRepo.get(doc.id)
    const chunks = await chunksRepo.listByDocument(doc.id)
    return { doc: refreshed, chunks, text: chunks.map((c) => c.text).join('\n') }
  }

  it('keeps maths symbols intact through chunking', async () => {
    const source =
      'For any sets A and B, the union is written A ∪ B and the intersection A ∩ B. ' +
      'The empty set is ∅ and x ∈ A means x belongs to A. ' +
      'A function is continuous when the limit equals the value.'

    const { text } = await ingest(source)

    expect(text).toContain('∪')
    expect(text).toContain('∩')
    expect(text).toContain('∅')
    expect(text).toContain('∈')
  })

  it('keeps undecodable Private Use Area characters rather than deleting them', async () => {
    const source =
      'Let \uF0C7 denote the intersection and \uF0C8 the union of two sets. ' +
      'These definitions are used throughout the course material. ' +
      'A further paragraph makes the document long enough to chunk.'

    const { text } = await ingest(source)

    expect(text).toContain('\uF0C7')
    expect(text).toContain('\uF0C8')
  })

  it('warns the user when undecodable characters are present', async () => {
    const source =
      'The set operation \uF0C7 appears here. ' +
      'A second sentence ensures the chunker produces at least one chunk. ' +
      'A third sentence adds a little more length.'

    const { doc } = await ingest(source)

    expect(doc.warnings.some((w) => w.includes('无法解码') || w.includes('could not be decoded'))).toBe(true)
    expect(doc.warnings).toContain(t('errors.undecodableCharacters', { count: 1 }))
  })

  it('does not warn for clean documents', async () => {
    const source =
      'The derivative measures the instantaneous rate of change. ' +
      'It is defined as a limit of a difference quotient. ' +
      'For the function x squared the derivative is two x.'

    const { doc, text } = await ingest(source)

    expect(doc.warnings).toEqual([])
    expect(text).toContain('derivative')
  })

  it('does not warn for documents that only use legitimate maths symbols', async () => {
    const source =
      'We write x ≤ y and x ≥ 0 and x ≠ y and x ≈ y. ' +
      'The integral ∫ and the sum ∑ and the root √ are all valid. ' +
      'Greek letters such as α, β and Ω are expected in this course.'

    const { doc, text } = await ingest(source)

    expect(doc.warnings).toEqual([])
    expect(text).toContain('≤')
    expect(text).toContain('∫')
    expect(text).toContain('α')
  })

  it('strips control characters before storage', async () => {
    const source =
      'First sentence with a stray control char \u0007 here. ' +
      'Second sentence with a null \u0000 byte. ' +
      'Third sentence to give the chunker something to work with.'

    const { text } = await ingest(source)

    expect(text).not.toContain('\u0007')
    expect(text).not.toContain('\u0000')
    expect(text).toContain('First sentence')
  })

  it('preserves mixed Chinese and maths content', async () => {
    const source =
      'Let x ≥ 0，求 √(x² + 1)。这是课程中的一道例题。 ' +
      '集合的并集记作 A ∪ B，交集记作 A ∩ B。 ' +
      '以上内容需要完整保留，不能被规范化破坏。'

    const { text } = await ingest(source)

    expect(text).toContain('√(x² + 1)')
    expect(text).toContain('A ∪ B')
    expect(text).toContain('集合的并集')
  })

  it('preserves LaTeX source verbatim', async () => {
    const source =
      'The Gaussian integral is written \\[\\int_0^\\infty e^{-x^2} dx\\] in LaTeX. ' +
      'Students should recognise the \\frac{a}{b} form as well. ' +
      'This paragraph makes the material long enough to be chunked.'

    const { text } = await ingest(source)

    expect(text).toContain('\\int_0^\\infty e^{-x^2} dx')
    expect(text).toContain('\\frac{a}{b}')
  })

  it('keeps the replacement character so the surrounding text is unchanged', async () => {
    const source =
      'A glyph failed to decode as \uFFFD in this sentence. ' +
      'The rest of the sentence is still readable and useful. ' +
      'A third sentence keeps the document chunkable.'

    const { doc, text } = await ingest(source)

    expect(text).toContain('\uFFFD')
    expect(doc.warnings.some((w) => w.includes('could not be decoded') || w.includes('无法解码'))).toBe(true)
  })
})
