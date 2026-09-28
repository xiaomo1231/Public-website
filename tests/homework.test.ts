import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import {
  HomeworkService,
  normalizeQuestionContent,
  normalizeQuestions,
} from '@/services/homeworkService'
import type { AIService } from '@/services/aiService'
import type { Document } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { HomeworkQuestion } from '@/entities/homework/types'

type StubMessage = { role: string; content: string }
type StubHandler = (system: string, user: string) => unknown

/** A tiny AI stand-in that branches on the system prompt. */
function stubAI(handler: StubHandler): AIService {
  return {
    chatJSON: async (messages: StubMessage[]) => ({
      data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
      raw: {},
    }),
    chat: async () => ({ content: 'Start by writing down what is given.' }),
  } as unknown as AIService
}

function analyzer(ids: string[], prompts: string[]): unknown {
  return {
    questions: prompts.map((prompt, index) => ({
      number: String(index + 1),
      prompt,
      sourceChunkIds: [ids[index % ids.length]!],
    })),
  }
}

describe('homework normalization', () => {
  const chunkA = { id: 'c1', text: 'first passage', order: 0, pageNumber: 1 } as unknown as DocumentChunk
  const chunkB = { id: 'c2', text: 'second passage', order: 1 } as unknown as DocumentChunk
  const document = { id: 'doc1', name: 'hw.txt' } as unknown as Document

  it('keeps only questions grounded in real chunks', () => {
    const out = normalizeQuestions(
      {
        questions: [
          { prompt: 'Keep me', sourceChunkIds: ['c1', 'invented'] },
          { prompt: '', sourceChunkIds: ['c2'] },
          { prompt: 'No source', sourceChunkIds: ['invented'] },
        ],
      },
      [chunkA, chunkB],
      document,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.prompt).toBe('Keep me')
    expect(out[0]!.sourceRefs[0]!.chunkId).toBe('c1')
    expect(out[0]!.sourceRefs[0]!.documentName).toBe('hw.txt')
  })

  it('rejects incomplete hint/solution payloads', () => {
    expect(() => normalizeQuestionContent({ hints: [], solution: 'x' })).toThrow()
    expect(() => normalizeQuestionContent({ hints: ['h'], solution: '' })).toThrow()
    expect(normalizeQuestionContent({ hints: ['h', '  '], solution: 's' })).toEqual({
      hints: ['h'],
      solution: 's',
    })
  })
})

describe('HomeworkService', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let chunks: DocumentChunk[]

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw1.txt',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id

    chunks = await new ChunkRepository(db).addMany([
      {
        documentId,
        projectId,
        materialType: 'homework',
        pageNumber: 1,
        contentType: 'paragraph',
        text: 'Find the limit of x^2 as x tends to 3.',
        sourceReference: 'hw1.txt · Page 1',
        order: 0,
      },
      {
        documentId,
        projectId,
        materialType: 'homework',
        pageNumber: 2,
        contentType: 'paragraph',
        text: 'Differentiate 3x^2.',
        sourceReference: 'hw1.txt · Page 2',
        order: 1,
      },
    ])
  })

  it('extracts grounded questions and pre-generates hints + solution', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) =>
        system.includes('extract the individual questions')
          ? analyzer([chunks[0]!.id, chunks[1]!.id], ['Find the limit.', 'Differentiate.'])
          : { hints: ['Recall the definition.', 'Substitute x = 3.'], solution: 'The limit is 9.' },
      ),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect(set.questionCount).toBe(2)

    const questions = await service.listQuestions(set.id)
    expect(questions).toHaveLength(2)
    expect(questions[0]!.sourceRefs[0]!.chunkId).toBe(chunks[0]!.id)
    expect(questions[0]!.hints).toHaveLength(2)
    expect(questions[0]!.solution).toBe('The limit is 9.')
    expect(questions[0]!.generationStatus).toBe('ready')
  })

  it('isolates a per-question content failure', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          return analyzer([chunks[0]!.id, chunks[1]!.id], ['Good question.', 'FAIL question.'])
        }
        if (user.includes('FAIL')) throw new Error('model exploded')
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const questions = await service.listQuestions(set.id)
    const good = questions.find((q) => q.prompt === 'Good question.')
    const bad = questions.find((q) => q.prompt === 'FAIL question.')
    expect(good?.generationStatus).toBe('ready')
    expect(bad?.generationStatus).toBe('failed')
    expect(bad?.generationError).toBeTruthy()
  })

  it('persists drafts, hint progression and the revealed solution', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) =>
        system.includes('extract the individual questions')
          ? analyzer([chunks[0]!.id], ['Q'])
          : { hints: ['h1', 'h2', 'h3'], solution: 'full solution' },
      ),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.saveDraft(question!.id, 'my working')
    await service.revealNextHint(question!.id)
    await service.revealNextHint(question!.id)
    await service.revealSolution(question!.id)

    const updated = await service.getQuestion(question!.id)
    expect(updated?.draftText).toBe('my working')
    expect(updated?.revealedHints).toBe(2)
    expect(updated?.solutionRevealed).toBe(true)
  })

  it('records a failure rather than crashing when no provider is configured', async () => {
    const service = new HomeworkService({ ai: null, db })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toBeTruthy()
    expect(await service.listQuestions(set.id)).toHaveLength(0)
  })

  it('keeps the help conversation persisted and rejects empty messages', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) =>
        system.includes('extract the individual questions')
          ? analyzer([chunks[0]!.id], ['Q'])
          : { hints: ['h'], solution: 's' },
      ),
    })
    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)

    const reply = await service.ask(question!.id, 'How do I start?')
    expect(reply.role).toBe('assistant')
    expect(reply.content).toBeTruthy()

    const updated = await service.getQuestion(question!.id)
    expect(updated?.messages).toHaveLength(2)
    expect(updated?.messages[0]?.role).toBe('student')

    await expect(service.ask(question!.id, '   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('preserves student work across a re-analysis when the order changes', async () => {
    let analyzerCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          analyzerCalls += 1
          return analyzerCalls === 1
            ? analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
            : analyzer([chunks[1]!.id, chunks[0]!.id], ['Prompt two.', 'Prompt one.'])
        }
        return { hints: ['h1', 'h2'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const before = await service.listQuestions(set.id)
    const first = before.find((q) => q.prompt === 'Prompt one.')!
    await service.saveDraft(first.id, 'draft one')
    await service.revealNextHint(first.id)
    await service.ask(first.id, 'help?')

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ matched: 2, regenerated: 0, added: 0, retired: 0 })

    const after = await service.listQuestions(set.id)
    expect(after.map((q) => q.prompt)).toEqual(['Prompt two.', 'Prompt one.'])
    const still = after.find((q) => q.prompt === 'Prompt one.')!
    expect(still.id).toBe(first.id)
    expect(still.draftText).toBe('draft one')
    expect(still.revealedHints).toBe(1)
    expect(still.messages).toHaveLength(2)
  })

  it('keeps records when a question wording changes', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          return calls === 1
            ? analyzer([chunks[0]!.id], ['Find the limit of x^2 at 3.'])
            : analyzer([chunks[0]!.id], ['Compute the limit of x^2 as x approaches 3.'])
        }
        return { hints: ['new hint'], solution: 'new solution' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.saveDraft(question!.id, 'my work')
    await service.revealSolution(question!.id)

    const result = await service.retrySet(set.id)
    expect(result?.summary.regenerated).toBe(1)

    const [after] = await service.listQuestions(set.id)
    expect(after!.id).toBe(question!.id)
    expect(after!.prompt).toContain('approaches 3')
    expect(after!.draftText).toBe('my work')
    expect(after!.solutionRevealed).toBe(true)
    expect(after!.hints).toEqual(['new hint'])
  })

  it('retires a removed question instead of deleting its record', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          return calls === 1
            ? analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
            : analyzer([chunks[0]!.id], ['Prompt one.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const before = await service.listQuestions(set.id)
    const removed = before.find((q) => q.prompt === 'Prompt two.')!
    await service.saveDraft(removed.id, 'keep me')

    const result = await service.retrySet(set.id)
    expect(result?.summary.retired).toBe(1)

    const active = await service.listQuestions(set.id)
    expect(active.map((q) => q.prompt)).toEqual(['Prompt one.'])

    const retired = await service.listRetiredQuestions(set.id)
    const kept = retired.find((q) => q.id === removed.id)
    expect(kept).toBeTruthy()
    expect(kept?.draftText).toBe('keep me')
  })

  it('adds a new question without disturbing existing records', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          return calls === 1
            ? analyzer([chunks[0]!.id], ['Prompt one.'])
            : analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.saveDraft(question!.id, 'draft')

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ matched: 1, added: 1 })

    const after = await service.listQuestions(set.id)
    expect(after).toHaveLength(2)
    const kept = after.find((q) => q.prompt === 'Prompt one.')!
    expect(kept.id).toBe(question!.id)
    expect(kept.draftText).toBe('draft')
  })

  it('clamps revealed hints when regeneration returns fewer hints', async () => {
    let contentCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          return analyzer([chunks[0]!.id], ['Q'])
        }
        contentCalls += 1
        return contentCalls === 1
          ? { hints: ['h1', 'h2', 'h3'], solution: 's1' }
          : { hints: ['only'], solution: 's2' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.revealNextHint(question!.id)
    await service.revealNextHint(question!.id)
    await service.saveDraft(question!.id, 'draft')

    const next = await service.generateContent(question!.id)
    expect(next?.hints).toEqual(['only'])
    expect(next?.revealedHints).toBe(1)
    expect(next?.draftText).toBe('draft')
  })

  it('keeps the record when single-question regeneration fails', async () => {
    let contentCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          return analyzer([chunks[0]!.id], ['Q'])
        }
        contentCalls += 1
        if (contentCalls === 1) return { hints: ['h'], solution: 's' }
        throw new Error('model exploded')
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.saveDraft(question!.id, 'draft')
    await service.ask(question!.id, 'a question')

    const next = await service.generateContent(question!.id)
    expect(next?.generationStatus).toBe('failed')
    expect(next?.generationError).toBeTruthy()
    expect(next?.hints).toEqual(['h'])
    expect(next?.draftText).toBe('draft')
    expect(next?.messages).toHaveLength(2)
  })

  it('keeps newer student input made during regeneration', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let contentCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI(async (system) => {
        if (system.includes('extract the individual questions')) {
          return analyzer([chunks[0]!.id], ['Q'])
        }
        contentCalls += 1
        if (contentCalls === 1) return { hints: ['h'], solution: 's' }
        await gate
        return { hints: ['new h'], solution: 'new s' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)

    const regenerating = service.generateContent(question!.id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.saveDraft(question!.id, 'edited during generation')
    await service.ask(question!.id, 'asked during generation')
    release!()

    const result = await regenerating
    expect(result?.hints).toEqual(['new h'])
    expect(result?.draftText).toBe('edited during generation')
    expect(result?.messages).toHaveLength(2)
  })

  it('restores a retired question with all its records when it reappears', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          if (calls === 2) return analyzer([chunks[0]!.id], ['Prompt one.'])
          return analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
        }
        return { hints: ['h1', 'h2'], solution: 'solution' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const before = await service.listQuestions(set.id)
    const second = before.find((q) => q.prompt === 'Prompt two.')!
    await service.saveDraft(second.id, 'work two')
    await service.revealNextHint(second.id)
    await service.ask(second.id, 'how do I start?')
    await service.revealSolution(second.id)

    await service.retrySet(set.id)
    const archived = await service.listRetiredQuestions(set.id)
    expect(archived.map((q) => q.id)).toContain(second.id)

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 1, added: 0, retired: 0 })

    const active = await service.listQuestions(set.id)
    expect(active).toHaveLength(2)
    const restored = active.find((q) => q.prompt === 'Prompt two.')
    expect(restored?.id).toBe(second.id)
    expect(restored?.draftText).toBe('work two')
    expect(restored?.revealedHints).toBe(1)
    expect(restored?.solutionRevealed).toBe(true)
    expect(restored?.messages).toHaveLength(2)
    expect(await service.listRetiredQuestions(set.id)).toHaveLength(0)
    expect(active.filter((q) => q.prompt === 'Prompt two.')).toHaveLength(1)
  })

  it('restores a retired question when it reappears in a different position', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          if (calls === 1) return analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
          if (calls === 2) return analyzer([chunks[0]!.id], ['Prompt one.'])
          return analyzer([chunks[1]!.id, chunks[0]!.id], ['Prompt two.', 'Prompt one.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const before = await service.listQuestions(set.id)
    const second = before.find((q) => q.prompt === 'Prompt two.')!
    await service.saveDraft(second.id, 'kept')

    await service.retrySet(set.id)
    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 1 })

    const active = await service.listQuestions(set.id)
    expect(active.map((q) => q.prompt)).toEqual(['Prompt two.', 'Prompt one.'])
    expect(active[0]!.id).toBe(second.id)
    expect(active[0]!.draftText).toBe('kept')
  })

  it('does not restore when two archived questions look equally plausible', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          if (calls === 1) {
            return analyzer([chunks[0]!.id, chunks[0]!.id], ['Alpha beta gamma.', 'Alpha beta gamma!'])
          }
          if (calls === 2) return analyzer([chunks[1]!.id], ['Completely different.'])
          return analyzer([chunks[1]!.id, chunks[0]!.id], ['Completely different.', 'Alpha beta gamma.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    await service.retrySet(set.id)
    expect(await service.listRetiredQuestions(set.id)).toHaveLength(2)

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 0, added: 1 })
    expect(await service.listRetiredQuestions(set.id)).toHaveLength(2)
    expect(await service.listQuestions(set.id)).toHaveLength(2)
  })

  it('keeps an active question instead of reviving an archived look-alike', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          return calls === 1
            ? analyzer([chunks[0]!.id, chunks[0]!.id], ['Alpha.', 'Alpha!'])
            : analyzer([chunks[0]!.id], ['Alpha.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const before = await service.listQuestions(set.id)
    const keeper = before[0]!
    const lookAlike = before[1]!
    await service.saveDraft(keeper.id, 'draft A')
    await service.saveDraft(lookAlike.id, 'draft R')

    await service.retrySet(set.id)
    expect((await service.listRetiredQuestions(set.id)).map((q) => q.id)).toContain(lookAlike.id)

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 0, added: 0, matched: 1 })

    const active = await service.listQuestions(set.id)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe(keeper.id)
    expect(active[0]!.draftText).toBe('draft A')
    const archived = await service.listRetiredQuestions(set.id)
    expect(archived).toHaveLength(1)
    expect(archived[0]!.id).toBe(lookAlike.id)
    expect(archived[0]!.draftText).toBe('draft R')
  })

  it('heals an old blank active duplicate by restoring the archived record', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) =>
        system.includes('extract the individual questions')
          ? analyzer([chunks[0]!.id], ['Alpha beta gamma.'])
          : { hints: ['h'], solution: 's' },
      ),
    })

    const set = await service.createFromDocument(documentId)
    const [original] = await service.listQuestions(set.id)
    const blank: HomeworkQuestion = {
      ...original!,
      id: 'blank-active',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
    }
    const worked: HomeworkQuestion = {
      ...original!,
      id: 'retired-worked',
      retired: true,
      retiredAt: Date.now(),
      draftText: 'kept work',
      revealedHints: 1,
      solutionRevealed: true,
      messages: [{ id: 'm1', role: 'student' as const, content: 'hi', createdAt: 1 }],
    }
    await db.homeworkQuestions.delete(original!.id)
    await db.homeworkQuestions.put(blank)
    await db.homeworkQuestions.put(worked)

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 1, added: 0 })

    const active = await service.listQuestions(set.id)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe('retired-worked')
    expect(active[0]!.draftText).toBe('kept work')
    expect(active[0]!.messages).toHaveLength(1)
    expect(await db.homeworkQuestions.get('blank-active')).toBeUndefined()
    expect(await service.listRetiredQuestions(set.id)).toHaveLength(0)
  })

  it('keeps the record when the restored question content fails to regenerate', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          if (calls === 1) return analyzer([chunks[0]!.id], ['Original wording here.'])
          if (calls === 2) return analyzer([chunks[1]!.id], ['Filler question.'])
          return analyzer([chunks[1]!.id, chunks[0]!.id], ['Filler question.', 'Original wording here too.'])
        }
        if (user.includes('too')) throw new Error('model exploded')
        return { hints: ['old hint'], solution: 'old solution' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    await service.saveDraft(question!.id, 'draft')
    await service.ask(question!.id, 'help')

    await service.retrySet(set.id)
    expect((await service.listRetiredQuestions(set.id)).map((q) => q.id)).toContain(question!.id)

    const result = await service.retrySet(set.id)
    expect(result?.summary).toMatchObject({ restored: 1, failed: 1 })

    const active = await service.listQuestions(set.id)
    const restored = active.find((q) => q.id === question!.id)
    expect(restored?.generationStatus).toBe('failed')
    expect(restored?.hints).toEqual(['old hint'])
    expect(restored?.draftText).toBe('draft')
    expect(restored?.messages).toHaveLength(2)
  })

  it('keeps a student edit made during re-analysis instead of healing the blank', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let analyzerCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI(async (system) => {
        if (system.includes('extract the individual questions')) {
          analyzerCalls += 1
          if (analyzerCalls >= 2) await gate
          return analyzer([chunks[0]!.id], ['Alpha beta gamma.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const [original] = await service.listQuestions(set.id)
    const blank: HomeworkQuestion = { ...original!, id: 'blank-active', draftText: '', messages: [], revealedHints: 0, solutionRevealed: false }
    const worked: HomeworkQuestion = {
      ...original!,
      id: 'retired-worked',
      retired: true,
      retiredAt: Date.now(),
      draftText: 'kept work',
      messages: [{ id: 'm1', role: 'student' as const, content: 'hi', createdAt: 1 }],
    }
    await db.homeworkQuestions.delete(original!.id)
    await db.homeworkQuestions.put(blank)
    await db.homeworkQuestions.put(worked)

    const running = service.retrySet(set.id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.saveDraft('blank-active', 'typed while analyzing')
    release!()
    await running

    const active = await service.listQuestions(set.id)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe('blank-active')
    expect(active[0]!.draftText).toBe('typed while analyzing')
    const archived = await service.listRetiredQuestions(set.id)
    expect(archived.map((q) => q.id)).toContain('retired-worked')
  })

  it('leaves active and archived rows untouched when a re-analysis fails', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          if (calls === 3) throw new Error('analyzer exploded')
          if (calls === 2) return analyzer([chunks[0]!.id], ['Prompt one.'])
          return analyzer([chunks[0]!.id, chunks[1]!.id], ['Prompt one.', 'Prompt two.'])
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    const second = (await service.listQuestions(set.id)).find((q) => q.prompt === 'Prompt two.')!
    await service.saveDraft(second.id, 'retired draft')
    await service.retrySet(set.id)

    const activeBefore = await service.listQuestions(set.id)
    const retiredBefore = await service.listRetiredQuestions(set.id)
    await service.retrySet(set.id)

    expect(await service.listQuestions(set.id)).toEqual(activeBefore)
    expect(await service.listRetiredQuestions(set.id)).toEqual(retiredBefore)
  })
})
