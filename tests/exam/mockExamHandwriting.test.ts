import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkAnswerImageService } from '@/services/homeworkAnswerImageService'
import { MockExamService } from '@/services/mockExamService'
import {
  HandwritingRecognitionService,
  LocalModelRecognizer,
  VisionLlmRecognizer,
} from '@/services/handwriting/recognition'
import { storeStrokes } from '@/entities/handwriting/strokes'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

const PROMPTS = ['Solve x^2 = 4 for x > 0. (2 marks)', 'Explain why ice floats. (3 marks)']

/** No canvas in jsdom: bytes pass through unchanged (FileReader, as fake-indexeddb needs). */
async function passThrough(file: Blob) {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
  return { bytes, mimeType: 'image/png' as const, width: 10, height: 10 }
}

const png = (...bytes: number[]) => new Blob([Uint8Array.from(bytes)], { type: 'image/png' })

describe('mock exam with handwriting (纸上作答 / 平板手写)', () => {
  let db: AppDatabase
  let documentId: string
  /** Every request the grading AI received. */
  let graded: ChatMessage[][]
  /** Every request the recognition AI received. */
  let recognised: ChatMessage[][]

  const gradingAI = {
    chatJSON: async (messages: ChatMessage[]) => respond(messages),
    streamJSON: async (messages: ChatMessage[]) => respond(messages),
    chat: async () => ({ content: '' }),
    maxOutputTokens: 8192,
  } as unknown as AIService

  async function respond(messages: ChatMessage[]) {
    const system = messages[0]?.content ?? ''
    const user = messages[1]?.content ?? ''
    if (system.includes('extract the individual questions')) {
      const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
      return {
        data: {
          questions: ids.map((id, i) => ({
            number: String(i + 1),
            prompt: PROMPTS[i],
            sourceChunkIds: [id],
          })),
        },
        raw: {},
      }
    }
    if (system.includes('Assess ONE student homework answer')) {
      graded.push(messages)
      return {
        data: {
          status: 'ready',
          similarityPercent: 100,
          verdict: 'correct',
          feedback: 'ok',
          matchedPoints: [],
          missingPoints: [],
        },
        raw: {},
      }
    }
    return { data: { hints: ['h'], solution: 'Reference solution.' }, raw: {} }
  }

  function recognitionAI(reply: unknown | (() => never)): AIService {
    return {
      chatJSON: async (messages: ChatMessage[]) => {
        recognised.push(messages)
        if (typeof reply === 'function') (reply as () => never)()
        return { data: reply, raw: {} }
      },
    } as unknown as AIService
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    graded = []
    recognised = []
    const project = await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId: project.id,
      type: 'text',
      materialType: 'past_exam',
      name: 'Final 2024.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id
    await new ChunkRepository(db).addMany(
      PROMPTS.map((text, order) => ({
        documentId: doc.id,
        projectId: project.id,
        materialType: 'past_exam' as const,
        pageNumber: 1,
        contentType: 'paragraph' as const,
        text,
        sourceReference: 'Final 2024.pdf · Page 1',
        order,
      })),
    )
  })

  async function setup(recognitionReply: unknown | (() => never)): Promise<{
    set: HomeworkSet
    questions: HomeworkQuestion[]
    service: MockExamService
  }> {
    const homework = new HomeworkService({ db, ai: gradingAI })
    // jsdom has no canvas: images pass through unchanged.
    homework.answerImageService = () => new HomeworkAnswerImageService({ db, prepare: passThrough })
    const set = await homework.createFromDocument(documentId)
    const repo = new HomeworkRepository(db)
    const questions = (await repo.listQuestions(set.id)).sort((a, b) => a.order - b.order)
    for (const question of questions)
      await repo.updateQuestion(question.id, { answerText: 'reference', answerStatus: 'matched' })
    const recognition = new HandwritingRecognitionService({
      vision: new VisionLlmRecognizer(recognitionAI(recognitionReply), {
        model: 'vision-model',
        isOnline: () => true,
      }),
      local: new LocalModelRecognizer(null),
    })
    return { set, questions, service: new MockExamService({ homework, db, recognition }) }
  }

  it('recognises tablet writing only after submitting, and grades only the confirmed text', async () => {
    const { set, questions, service } = await setup({
      regions: [
        { text: 'x = [?:2]', confidence: 0.55 },
        { text: 'because $x>0$', confidence: 0.9 },
      ],
    })
    const q1 = questions[0]!
    const attempt = await service.start(set.id, 30, 'tablet')
    expect(attempt.mode).toBe('tablet')
    const strokes = storeStrokes(
      [
        {
          tool: 'pen',
          color: '#000',
          width: 3,
          pressureSensitive: true,
          points: [{ x: 1, y: 2, pressure: 0.5 }],
        },
      ],
      { width: 1000, height: 1400 },
    )
    await service.saveWritingArea(set.id, q1.id, [{ image: png(1, 2), strokes, page: 0 }])
    // Saving again replaces the area's pages.
    await service.saveWritingArea(set.id, q1.id, [
      { image: png(1, 2, 3), strokes, page: 0 },
      { image: png(4), strokes, page: 1 },
    ])
    const writing = await service.handwriting(set.id)
    const item = writing.items.find((entry) => entry.questionId === q1.id)!
    expect(item.images.map((image) => image.writingPage)).toEqual([0, 1])
    expect(item.images[0]!.strokes?.strokes).toHaveLength(1)
    expect(item.images[0]!.examAttemptId).toBe(attempt.id)

    // Exam integrity: no recognition (no AI) while the timer runs.
    await expect(service.recognize(set.id, 'en')).rejects.toThrow()
    expect(recognised).toHaveLength(0)
    // Exam pages are not the question's homework answer.
    expect(await new HomeworkAnswerImageService({ db }).list(q1.id)).toHaveLength(0)

    await service.submit(set.id)
    // After submitting the writing area is frozen.
    await expect(
      service.saveWritingArea(set.id, q1.id, [{ image: png(9), strokes, page: 0 }]),
    ).rejects.toThrow()
    await expect(service.imageStore(set.id).add(q1.id, png(9), 'upload')).rejects.toThrow()

    // Grading is refused until the transcript is confirmed.
    await expect(service.check(set.id, 'en')).rejects.toMatchObject({
      code: 'TRANSCRIPT_UNCONFIRMED',
    })
    expect(graded).toHaveLength(0)

    await service.recognize(set.id, 'en', { mode: 'auto' })
    expect(recognised).toHaveLength(1)
    expect(recognised[0]![1]!.images).toHaveLength(2)
    const after = await service.handwriting(set.id)
    const transcript = after.items.find((entry) => entry.questionId === q1.id)!.transcript!
    expect(transcript).toMatchObject({
      status: 'recognized',
      provider: 'vision-llm',
      model: 'vision-model',
      recognizedText: 'x = [?:2]\nbecause $x>0$',
    })
    expect(transcript.confirmedAt).toBeUndefined()

    // A transcript with [?] cannot be confirmed.
    await expect(
      service.confirmTranscript(set.id, q1.id, transcript.recognizedText!),
    ).rejects.toThrow()
    // The student reads their own writing: it says 2 (or corrects a misread).
    await service.confirmTranscript(set.id, q1.id, 'x = 2\nbecause $x>0$')

    const done = await service.check(set.id, 'en')
    expect(done.checkedAt).toBeDefined()
    expect(done.gradedAnswers?.[q1.id]).toBe('x = 2\nbecause $x>0$')
    // The grader received the confirmed text and no images at all.
    const sent = graded.find((messages) => messages[1]!.content.includes('x = 2'))
    expect(sent).toBeDefined()
    expect(graded.every((messages) => messages.every((message) => !message.images))).toBe(true)
    // Question 2 had no writing: unanswered, never guessed.
    const byId = new Map(done.results!.map((result) => [result.questionId, result]))
    expect(byId.get(questions[1]!.id)?.status).toBe('unanswered')
    expect(done.transcripts?.[q1.id]?.edited).toBe(true)
  })

  it('纸上作答: uploads are allowed after submitting until done; recognition waits for it', async () => {
    const { set, questions, service } = await setup({ regions: [{ text: 'ice is less dense' }] })
    const q2 = questions[1]!
    await service.start(set.id, 30, 'paper')
    await service.submit(set.id)
    const store = service.imageStore(set.id)
    await store.add(q2.id, png(5, 6), 'upload', {
      crop: { x: 0, y: 0.5, width: 1, height: 0.4, page: 0 },
    })
    const listed = await store.list(q2.id)
    expect(listed[0]!.crop).toMatchObject({ page: 0, y: 0.5 })
    // Not before the upload is done.
    await expect(service.recognize(set.id, 'en')).rejects.toThrow()
    await service.finishUploads(set.id)
    await expect(store.add(q2.id, png(7), 'upload')).rejects.toThrow()
    await service.recognize(set.id, 'en')
    expect(recognised).toHaveLength(1)
  })

  it('falls back to typing when the model cannot read images, and a new image makes the confirmation stale', async () => {
    const { set, questions, service } = await setup(() => {
      throw Object.assign(new Error('image_url is not supported'), { code: 'INVALID_REQUEST' })
    })
    const q1 = questions[0]!
    await service.start(set.id, 30, 'online')
    const store = service.imageStore(set.id)
    await store.add(q1.id, png(1), 'upload')
    await service.submit(set.id)
    await service.recognize(set.id, 'zh')
    let transcript = (await service.handwriting(set.id)).items[0]!.transcript!
    expect(transcript).toMatchObject({ status: 'unavailable', provider: 'typed' })
    expect(transcript.note).toBeTruthy()
    await service.confirmTranscript(set.id, q1.id, 'x = 2')
    transcript = (await service.handwriting(set.id)).items[0]!.transcript!
    expect(transcript.confirmedText).toBe('x = 2')

    // Simulate a changed image set (e.g. an earlier stale record): the confirmation no longer counts.
    const repo = new HomeworkRepository(db)
    const stored = await repo.getSet(set.id)
    const current = stored!.exam!.current!
    await repo.updateSet(set.id, {
      exam: {
        ...stored!.exam,
        current: {
          ...current,
          transcripts: {
            [q1.id]: { ...current.transcripts![q1.id]!, imageKey: 'another-image' },
          },
        },
      },
    })
    await expect(service.check(set.id, 'en')).rejects.toMatchObject({
      code: 'TRANSCRIPT_UNCONFIRMED',
    })
  })
})
