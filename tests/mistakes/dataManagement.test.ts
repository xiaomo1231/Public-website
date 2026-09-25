import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DataManagementService } from '@/services/dataManagementService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { MistakeService } from '@/services/mistakeService'
import { MasteryService } from '@/services/masteryService'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { TranslationRepository } from '@/entities/translation/repository'
// SettingsService is loaded dynamically inside the test to avoid a duplicate import warning.

describe('DataManagementService', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('returns an empty inventory for a fresh database', async () => {
    const inv = await new DataManagementService().inventory()
    expect(inv.projects).toBe(0)
    expect(inv.documents).toBe(0)
    expect(inv.hasApiKey).toBe(false)
  })

  it('counts every table when data exists', async () => {
    const projects = new ProjectService(db)
    const docs = new DocumentRepository(db)
    const p = await projects.create({ name: 'P', subject: 'cs' })
    await docs.create({
      projectId: p.id,
      type: 'text',
      name: 'a.txt',
      sizeBytes: 5,
      blob: new Blob(['hello'], { type: 'text/plain' }),
    })
    const mistakes = new MistakeService(db)
    await mistakes.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const mastery = new MasteryService(db)
    await mastery.record({
      id: 'x',
      projectId: p.id,
      questionId: 'q',
      knowledgePoint: 'KP',
      questionType: 'numeric',
      difficulty: 'basic',
      userAnswer: 'a',
      evaluation: { isCorrect: false, method: 'exact', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    })
    const sessions = new TutorSessionRepository(db)
    await sessions.upsert({
      id: 's1',
      projectId: p.id,
      topicId: 't1',
      topicName: 'T',
      language: 'en',
      messages: [],
      turns: [],
      streakCorrect: 0,
      streakWrong: 0,
      currentDifficulty: 'basic',
      hintsRevealed: 0,
      mastery: 0,
      status: 'active',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const translations = new TranslationRepository(db)
    await translations.add({
      id: 't1',
      projectId: p.id,
      sourceText: 'word',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      translation: '字',
      contextNote: '',
      alternatives: [],
      context: { surrounding: '' },
      createdAt: Date.now(),
    })

    const inv = await new DataManagementService().inventory()
    expect(inv.projects).toBe(1)
    expect(inv.documents).toBe(1)
    expect(inv.mistakes).toBe(1)
    expect(inv.knowledgeMastery).toBe(1)
    expect(inv.tutorSessions).toBe(1)
    expect(inv.translations).toBe(1)
    expect(inv.estimatedTotalBytes).toBeGreaterThan(0)
  })

  it('exportAll returns a JSON bundle with every row', async () => {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const bundle = await new DataManagementService().exportAll()
    expect(bundle.json.exportedAt).toBeTypeOf('string')
    expect(Array.isArray((bundle.json as { projects: unknown[] }).projects)).toBe(true)
    expect((bundle.json as { projects: { id: string }[] }).projects[0]!.id).toBe(p.id)
    expect(Array.isArray(bundle.blobs)).toBe(true)
  })

  it('exports all project tables and lossless binary data without API credentials', async () => {
    const project = await new ProjectService(db).create({ name: 'P', subject: 'cs' })
    const bytes = new Uint8Array([0, 1, 127, 255]).buffer
    await db.documentBlobs.put({ id: 'doc', projectId: project.id, mimeType: 'application/pdf', bytes })
    await db.visualSourceImages.put({ id: 'figure', projectId: project.id, mimeType: 'image/png', bytes })
    await db.table('practiceSets').put({ id: 'set', projectId: project.id })
    await db.table('practiceQuestions').put({ id: 'practice-q', projectId: project.id })
    await db.table('practiceAttempts').put({ id: 'practice-a', projectId: project.id })
    await db.table('courseStructureNodes').put({ id: 'chapter', projectId: project.id })
    await db.settings.put({
      id: 'singleton', provider: 'openai', baseURL: '', model: '', temperature: 0.7,
      maxTokens: 100, updatedAt: 1, apiKey: 'legacy-secret', apiKeyEncrypted: 'encrypted-secret',
    })

    const bundle = await new DataManagementService(db).exportAll()
    for (const name of ['practiceSets', 'practiceQuestions', 'practiceAttempts', 'courseStructureNodes']) {
      expect((bundle.json[name] as unknown[]).length).toBe(1)
    }
    expect(JSON.stringify(bundle)).not.toContain('legacy-secret')
    expect(JSON.stringify(bundle)).not.toContain('encrypted-secret')
    expect(bundle.blobs).toEqual([
      { id: 'doc', kind: 'document', mimeType: 'application/pdf', bytesBase64: 'AAF//w==' },
      { id: 'figure', kind: 'visualSource', mimeType: 'image/png', bytesBase64: 'AAF//w==' },
    ])
  })

  it('preserves binary bytes across base64 segment boundaries', async () => {
    const project = await new ProjectService(db).create({ name: 'P', subject: 'cs' })
    const bytes = Uint8Array.from({ length: 8195 }, (_, index) => index % 256)
    await db.documentBlobs.put({ id: 'large', projectId: project.id, mimeType: 'application/pdf', bytes: bytes.buffer })
    const { blobs } = await new DataManagementService(db).exportAll()
    const decoded = Uint8Array.from(atob(blobs[0]!.bytesBase64), (char) => char.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })

  it('deleteProject removes every table row for that project', async () => {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId: p.id, type: 'text', name: 'a.txt', sizeBytes: 5, blob: new Blob(['x'], { type: 'text/plain' }) })
    const mistakes = new MistakeService(db)
    const mistake = await mistakes.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const mastery = new MasteryService(db)
    await mastery.record({
      id: 'x',
      projectId: p.id,
      questionId: 'q',
      knowledgePoint: 'KP',
      questionType: 'numeric',
      difficulty: 'basic',
      userAnswer: 'a',
      evaluation: { isCorrect: false, method: 'exact', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    })
    const sessions = new TutorSessionRepository(db)
    await sessions.upsert({
      id: 's1',
      projectId: p.id,
      topicId: 't',
      topicName: 'T',
      language: 'en',
      messages: [],
      turns: [],
      streakCorrect: 0,
      streakWrong: 0,
      currentDifficulty: 'basic',
      hintsRevealed: 0,
      mastery: 0,
      status: 'active',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const translations = new TranslationRepository(db)
    await translations.add({
      id: 'tr1',
      projectId: p.id,
      sourceText: 'a',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      translation: 'a',
      contextNote: '',
      alternatives: [],
      context: { surrounding: '' },
      createdAt: Date.now(),
    })
    const questionRepo = new QuestionRepository(db)
    await questionRepo.addMany([
      {
        projectId: p.id,
        knowledgePoint: 'KP',
        type: 'numeric',
        difficulty: 'basic',
        prompt: 'Q?',
        correctAnswer: 'a',
        hints: [],
      },
    ])
    const attemptRepo = new QuestionAttemptRepository(db)
    const q = (await questionRepo.listByProject(p.id))[0]!
    await attemptRepo.add({
      id: 'a1',
      projectId: p.id,
      questionId: q.id,
      knowledgePoint: 'KP',
      questionType: 'numeric',
      difficulty: 'basic',
      userAnswer: 'a',
      evaluation: { isCorrect: true, method: 'exact', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    })

    await new DataManagementService().deleteProject(p.id)
    const inv = await new DataManagementService().inventory()
    expect(inv.projects).toBe(0)
    expect(inv.documents).toBe(0)
    expect(inv.questions).toBe(0)
    expect(inv.questionAttempts).toBe(0)
    expect(inv.mistakes).toBe(0)
    expect(inv.knowledgeMastery).toBe(0)
    expect(inv.tutorSessions).toBe(0)
    expect(inv.translations).toBe(0)
    expect(doc.id).toBeDefined() // still in memory but no longer in db
    void mistake
  })

  it('removes lessons and professor practice atomically with the project', async () => {
    const projects = new ProjectService(db)
    const a = await projects.create({ name: 'A', subject: 'cs' })
    const b = await projects.create({ name: 'B', subject: 'cs' })
    for (const project of [a, b]) {
      await db.table('tutorLessons').put({ id: `lesson-${project.id}`, projectId: project.id })
      await db.table('practiceSets').put({ id: `set-${project.id}`, projectId: project.id })
      await db.table('practiceQuestions').put({ id: `q-${project.id}`, projectId: project.id })
      await db.table('practiceAttempts').put({ id: `attempt-${project.id}`, projectId: project.id })
    }

    await new DataManagementService(db).deleteProject(a.id)
    for (const name of ['tutorLessons', 'practiceSets', 'practiceQuestions', 'practiceAttempts']) {
      expect(await db.table(name).where('projectId').equals(a.id).count()).toBe(0)
      expect(await db.table(name).where('projectId').equals(b.id).count()).toBe(1)
    }
  })

  it('rolls back project deletion when the final delete fails', async () => {
    const project = await new ProjectService(db).create({ name: 'P', subject: 'cs' })
    const doc = await new DocumentRepository(db).create({
      projectId: project.id, type: 'text', name: 'a.txt', sizeBytes: 1,
      blob: new Blob(['x'], { type: 'text/plain' }),
    })
    await db.table('practiceSets').put({ id: 'set', projectId: project.id })
    db.projects.hook('deleting', () => { throw new Error('delete blocked') })

    await expect(new DataManagementService(db).deleteProject(project.id)).rejects.toThrow('delete blocked')
    expect(await db.projects.get(project.id)).toBeDefined()
    expect(await db.documents.get(doc.id)).toBeDefined()
    expect(await db.documentBlobs.get(doc.id)).toBeDefined()
    expect(await db.table('practiceSets').get('set')).toBeDefined()
  })

  it('deleteAll wipes every table', async () => {
    const projects = new ProjectService(db)
    await projects.create({ name: 'P', subject: 'cs' })
    await new DataManagementService().deleteAll()
    const inv = await new DataManagementService().inventory()
    expect(inv.projects).toBe(0)
    expect(inv.documents).toBe(0)
  })

  it('clearAISettings scrubs the API key but keeps data', async () => {
    const projects = new ProjectService(db)
    await projects.create({ name: 'P', subject: 'cs' })
    const settings = (await import('@/services/settingsService')).SettingsService
    await new settings(db).update({
      provider: 'openai',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-test',
    })
    const inv = await new DataManagementService().inventory()
    expect(inv.hasApiKey).toBe(true)
    await new DataManagementService().clearAISettings()
    const inv2 = await new DataManagementService().inventory()
    expect(inv2.hasApiKey).toBe(false)
    expect(inv2.projects).toBe(1)
  })
})
