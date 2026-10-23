import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProcessingService } from '@/services/processingService'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { MaterialTypeService, autoCheckMaterialType } from '@/services/materialTypeService'
import type { AIService } from '@/services/aiService'
import type { LearningMaterialType } from '@/entities/document/types'
import { createGenerationRun } from '@/shared/lib/generationControl'

const EXAM_TEXT = [
  'MIDTERM EXAMINATION',
  'Time allowed: 90 minutes. Student ID: ________',
  'Answer ALL questions. Total marks: 40.',
  '1. (10 marks) A ball is thrown upward at 12 m/s.',
  '(a) Calculate the maximum height. [4]',
  '(b) Determine the time of flight. [3]',
  '(c) Sketch the velocity–time graph. [3]',
  '2. (12 marks) Show that the period of a pendulum is independent of mass.',
  '3. Evaluate the work done by friction. (6 marks)',
  '4. Find the tension in the rope. (8 marks)',
].join('\n')

const PROSE =
  'In this lecture we introduce the idea of elasticity. Elasticity measures how strongly the quantity demanded responds to a change in price. ' +
  'For example, when the price of coffee rises, some buyers switch to tea. Economists call demand elastic when the response is large. ' +
  'Note that elasticity is a ratio of percentage changes, so it has no units.'

/** A lecture with a short exercise block at the end: scores are close. */
const MIXED_TEXT = [
  'Chapter 4: Elasticity',
  'Learning objectives',
  PROSE,
  PROSE,
  'Section 4.2 Supply',
  PROSE,
  PROSE,
  'Section 4.3 Applications',
  PROSE,
  PROSE,
  '1. Calculate the elasticity. (2 marks)',
  '2. Explain why demand is elastic.',
  '3. Determine the total revenue. (2 marks)',
].join('\n')

function fakeAI(reply: unknown, onCall?: () => void): AIService {
  return {
    chatJSON: vi.fn(async () => {
      onCall?.()
      return { data: reply, raw: { content: JSON.stringify(reply) } }
    }),
  } as unknown as AIService
}

describe('MaterialTypeService', () => {
  let db: AppDatabase
  let documents: DocumentRepository
  let processing: ProcessingService
  let documentService: DocumentService
  let projectId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    projectId = (await projects.create({ name: 'Physics', subject: 'physics' })).id
    documents = new DocumentRepository(db)
    documentService = new DocumentService({ documents, projects, db })
    processing = new ProcessingService({
      documents,
      chunks: new ChunkRepository(db),
      jobs: new ProcessingJobRepository(db),
      projects,
      db,
    })
  })

  async function ingest(
    text: string,
    name: string,
    materialType: LearningMaterialType = 'textbook',
  ) {
    const blob = new Blob([text], { type: 'text/plain' })
    const doc = await documentService.create({
      projectId,
      type: 'text',
      name,
      materialType,
      sizeBytes: blob.size,
      blob,
    })
    await processing.process(doc.id)
    return documents.get(doc.id)
  }

  it('stores a suggestion after processing but never changes the role itself', async () => {
    const doc = await ingest(EXAM_TEXT, 'Chapter 5.txt')
    expect(doc.status).toBe('ready')
    expect(doc.materialType).toBe('textbook')
    expect(doc.suggestedMaterialType?.type).toBe('past_exam')
    expect(doc.suggestedMaterialType?.by).toBe('local')
    const chunks = await db.chunks.where('documentId').equals(doc.id).toArray()
    expect(chunks.every((chunk) => chunk.materialType === 'textbook')).toBe(true)
  })

  it('stores nothing when the content agrees with the role', async () => {
    const doc = await ingest(EXAM_TEXT, 'midterm.txt', 'past_exam')
    expect(doc.suggestedMaterialType).toBeUndefined()
  })

  it('the one role-change path applies the suggestion and clears it', async () => {
    const doc = await ingest(EXAM_TEXT, 'Chapter 5.txt')
    await documentService.changeMaterialType(doc.id, doc.suggestedMaterialType!.type, projectId)
    const after = await documents.get(doc.id)
    expect(after.materialType).toBe('past_exam')
    expect(after.suggestedMaterialType).toBeUndefined()
    const chunks = await db.chunks.where('documentId').equals(doc.id).toArray()
    expect(chunks.every((chunk) => chunk.materialType === 'past_exam')).toBe(true)
  })

  it('忽略 is remembered, also after re-processing', async () => {
    const doc = await ingest(EXAM_TEXT, 'Chapter 5.txt')
    await new MaterialTypeService({ db }).dismiss(doc.id, 42)
    let after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.dismissedAt).toBe(42)
    expect(after.materialType).toBe('textbook')
    await processing.process(doc.id)
    after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.dismissedAt).toBe(42)
  })

  it('a close call is decided by one light-model request, limited to the candidates', async () => {
    const doc = await ingest(MIXED_TEXT, 'Lecture4.txt')
    expect(doc.suggestedMaterialType?.candidates).toEqual(
      expect.arrayContaining(['textbook', 'homework']),
    )
    const ai = fakeAI({ type: 'homework' })
    const result = await new MaterialTypeService({ db }).checkWithAi(doc.id, ai)
    expect(ai.chatJSON).toHaveBeenCalledTimes(1)
    const call = (ai.chatJSON as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[1]).toMatchObject({ usageKind: 'other' })
    expect(result?.type).toBe('homework')
    const after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.by).toBe('ai')
    expect(after.materialType).toBe('textbook')
    // Not asked again.
    await new MaterialTypeService({ db }).checkWithAi(doc.id, ai)
    expect(ai.chatJSON).toHaveBeenCalledTimes(1)
  })

  it('a stopped check sends nothing and is not repeated', async () => {
    const doc = await ingest(MIXED_TEXT, 'Lecture4.txt')
    const run = createGenerationRun()
    run.stopNow()
    const ai = fakeAI({ type: 'homework' })
    await new MaterialTypeService({ db }).checkWithAi(doc.id, ai, { control: run })
    expect(ai.chatJSON).not.toHaveBeenCalled()
    const after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.aiCheckedAt).toBeDefined()
    expect(after.suggestedMaterialType?.by).toBe('local')
  })

  it('the automatic check does nothing without an AI key', async () => {
    const doc = await ingest(MIXED_TEXT, 'Lecture4.txt')
    await autoCheckMaterialType(doc.id, { db })
    const after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.aiCheckedAt).toBeUndefined()
  })

  it('the automatic check runs with an AI service and stays a suggestion', async () => {
    const doc = await ingest(MIXED_TEXT, 'Lecture4.txt')
    await autoCheckMaterialType(doc.id, { db, ai: fakeAI({ type: 'homework' }) })
    const after = await documents.get(doc.id)
    expect(after.suggestedMaterialType?.type).toBe('homework')
    expect(after.materialType).toBe('textbook')
  })
})
