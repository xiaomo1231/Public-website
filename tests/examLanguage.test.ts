import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import {
  examLanguageInstruction,
  examLanguageKey,
  examLanguageOf,
  isExamLanguageKey,
} from '@/infrastructure/ai/prompts/exam-language/v1'
import { languageRule } from '@/infrastructure/ai/prompts/homework-walkthrough/v1'
import { examModeKey, plainContentLanguage, resolveContentLanguage } from '@/entities/user/types'
import { walkthroughId, walkthroughLanguage } from '@/entities/homework/walkthrough'
import { quizLanguage } from '@/services/quizService'
import { oralLanguage } from '@/services/oralExamService'
import { detectExamLanguage, detectTextLanguage } from '@/entities/project/examLanguage'
import {
  getCourseLanguageMode,
  loadCourseLanguage,
  setCourseLanguageMode,
} from '@/services/courseLanguage'
import { ProjectService } from '@/services/projectService'
import { UserRepository } from '@/entities/user/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { tutorLessonKeyString } from '@/entities/tutorLesson/types'
import { fnv1a } from '@/shared/lib/hash'
import { languagePromptFixtures } from './helpers/languagePromptFixtures'

/**
 * fnv1a of each fixture prompt as built by the commit before 跟随考试语言
 * (v0.9.5, `tests/helpers/languagePromptFixtures.ts` run against it): the
 * existing languages must give the same text, byte for byte.
 */
const BEFORE: Record<string, string> = {
  'tutorLesson:zh': '3b3e7a17',
  'tutorQuestion:zh': '889e4766',
  'tutorEvaluate:zh': 'a0cc332f',
  'tutorIntroduce:zh': 'd0f63260',
  'mistakeAnalyzer:zh': 'df03de65',
  'tutorLesson:en': 'c8627750',
  'tutorQuestion:en': '08fc0d91',
  'tutorEvaluate:en': '9d22a87e',
  'tutorIntroduce:en': 'b8d5f283',
  'mistakeAnalyzer:en': '112c088c',
  'tutorLesson:mixed': '9e046d2e',
  'tutorQuestion:mixed': 'cabebea3',
  'tutorEvaluate:mixed': '9d22a87e',
  'tutorIntroduce:mixed': '116247d9',
  'mistakeAnalyzer:mixed': 'ab9eb132',
  'quizGenerator:zh': '02b1654c',
  'oralExam:zh': '8acac8b9',
  'quizGenerator:en': '16d4f0cd',
  'oralExam:en': '50903444',
  'quizGenerator:mixed': 'b7352873',
  'oralExam:mixed': 'd8b404c3',
  'quizGenerator:zh_terms': 'b3dc4b9a',
  'oralExam:zh_terms': 'dc4fc3bf',
  'walkthroughRule:zh_terms': '65e6a639',
  'walkthroughQuestion:zh_terms': '3f6be720',
  'walkthroughRule:zh': 'e2e0947a',
  'walkthroughQuestion:zh': '340d0ccd',
  'walkthroughRule:en': 'aea0fd53',
  'walkthroughQuestion:en': 'd0fd0b16',
  'practiceGenerate:zh': 'd21deedb',
  'practiceGenerate:en': '1b0e62ee',
}

describe('跟随考试语言: prompts', () => {
  it('leaves every existing language byte-identical', () => {
    const now = Object.fromEntries(
      Object.entries(languagePromptFixtures()).map(([key, text]) => [key, fnv1a(text)]),
    )
    expect(now).toEqual(BEFORE)
  })

  it('writes in the exam language with Chinese glosses for an exam key', () => {
    const key = examLanguageKey('de')
    const instruction = examLanguageInstruction('de')
    expect(instruction).toContain('German')
    expect(instruction).toContain('Simplified Chinese gloss')
    const snippets = ['Der Plexus brachialis entsteht aus C5–Th1.']
    const built = [
      prompts.tutorLesson.buildUserPrompt({
        topicName: 'Plexus',
        topicDescription: '',
        language: key,
        sourceSnippets: snippets,
      }),
      prompts.tutorQuestion.buildUserPrompt({
        topicName: 'Plexus',
        topicDescription: '',
        difficulty: 'basic',
        language: key,
        sourceSnippets: snippets,
      }),
      prompts.tutorEvaluate.buildUserPrompt({
        topicName: 'Plexus',
        question: 'q',
        expectedAnswer: 'a',
        studentAnswer: 'b',
        language: key,
        sourceSnippets: snippets,
        sourceRefs: [],
      }),
      prompts.mistakeAnalyzer.buildUserPrompt({
        question: 'q',
        studentAnswer: 'b',
        correctAnswer: 'a',
        language: key,
      }),
      prompts.quizGenerator.buildUserPrompt({
        topicName: 'Plexus',
        topicDescription: '',
        knowledgePoints: [],
        plan: [{ difficulty: 'basic', type: 'multiple_choice' }],
        language: key,
        sourceSnippets: snippets,
      }),
      prompts.oralExam.buildUserPrompt({
        topic: 'Plexus',
        courseTopics: [],
        knowledgePoints: [],
        sourceSnippets: snippets,
        language: key,
      }),
      languageRule(key),
      prompts.practiceGenerate.buildUserPrompt({ language: key, keyPoints: '', slots: [] }),
    ]
    for (const text of built) expect(text).toContain(instruction)
  })

  it('reads and writes exam keys', () => {
    expect(examLanguageKey('DE')).toBe('exam:de')
    expect(isExamLanguageKey('exam:hu')).toBe(true)
    expect(isExamLanguageKey('zh_terms')).toBe(false)
    expect(examLanguageOf('exam:hu')).toBe('hu')
    expect(examLanguageOf('en')).toBeUndefined()
    expect(plainContentLanguage('exam:de')).toBe('mixed')
    expect(plainContentLanguage('zh')).toBe('zh')
  })
})

describe('跟随考试语言: resolution', () => {
  it('maps the mode to the exam key, and a Chinese or unknown exam to Chinese', () => {
    expect(examModeKey('exam', 'de')).toBe('exam:de')
    expect(examModeKey('exam', 'zh')).toBeNull()
    expect(examModeKey('exam', undefined)).toBeNull()
    expect(examModeKey('en', 'de')).toBeNull()

    expect(resolveContentLanguage('exam', 'en', 'hu')).toBe('exam:hu')
    expect(resolveContentLanguage('exam', 'en', 'zh')).toBe('zh')
    expect(resolveContentLanguage('exam', 'en')).toBe('zh')
    // Other modes unchanged.
    expect(resolveContentLanguage('source', 'mixed', 'de')).toBe('mixed')
    expect(resolveContentLanguage('en', 'zh', 'de')).toBe('en')
    expect(resolveContentLanguage(undefined, 'en', 'de')).toBe('zh')

    expect(quizLanguage('exam', 'en', 'de')).toBe('exam:de')
    expect(quizLanguage('exam', 'en')).toBe('zh_terms')
    expect(quizLanguage('source', 'mixed', 'de')).toBe('mixed')
    expect(quizLanguage('zh_terms', 'en', 'de')).toBe('zh_terms')

    expect(walkthroughLanguage('exam', 'en', 'de')).toBe('exam:de')
    expect(walkthroughLanguage('exam', 'en', 'zh')).toBe('zh_terms')
    expect(walkthroughLanguage('source', 'en', 'de')).toBe('en')

    const intl = { subject: 'medicine' as const, examStyle: 'international' as const }
    expect(oralLanguage(intl, 'zh_terms', 'zh')).toBe('en')
    expect(oralLanguage(intl, 'exam', 'zh', 'en')).toBe('exam:en')
  })

  it('caches the exam mode as a language of its own', () => {
    // Walkthroughs and lessons key their rows by language: other languages keep theirs.
    expect(walkthroughId('set1', 'exam:de')).toBe('set1:exam:de')
    expect(walkthroughId('set1', 'zh_terms')).toBe('set1:zh_terms')
    const lesson = (language: 'en' | 'exam:de') =>
      tutorLessonKeyString({ projectId: 'p', topicId: 't', language })
    expect(lesson('exam:de')).not.toBe(lesson('en'))
  })
})

describe('exam language detection', () => {
  it('tells languages apart by their function words', () => {
    expect(
      detectTextLanguage('Beschreiben Sie den Aufbau des Herzens und die Funktion der Klappen.'),
    ).toBe('de')
    expect(
      detectTextLanguage('Ismertesse a szív felépítését és hogy milyen az ingerületvezetés.'),
    ).toBe('hu')
    expect(
      detectTextLanguage('Describe the structure of the heart and the function of the valves.'),
    ).toBe('en')
    expect(detectTextLanguage('请描述心脏的结构和瓣膜的功能。')).toBe('zh')
    expect(detectTextLanguage('12 34')).toBeUndefined()
    expect(
      detectExamLanguage([
        { weight: 1, text: 'Describe the structure of the heart and the valves.' },
        { weight: 5, text: 'Beschreiben Sie den Aufbau des Herzens und die Klappen der Kammer.' },
      ]),
    ).toBe('de')
  })
})

describe('per-course language mode', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function course(name = 'Anatomie') {
    return new ProjectService(db).create({ name, subject: 'medicine' })
  }

  it('prefers the call, then the course, then the global preference', async () => {
    const project = await course()
    await new UserRepository(db).update({ questionLanguage: 'en' })
    expect((await loadCourseLanguage(project.id, { db })).mode).toBe('en')
    await setCourseLanguageMode(project.id, 'source', db)
    expect(await getCourseLanguageMode(project.id, db)).toBe('source')
    expect((await loadCourseLanguage(project.id, { db })).mode).toBe('source')
    expect((await loadCourseLanguage(project.id, { db, override: 'zh_terms' })).mode).toBe(
      'zh_terms',
    )
    await setCourseLanguageMode(project.id, null, db)
    expect(await getCourseLanguageMode(project.id, db)).toBeUndefined()
    expect((await loadCourseLanguage(project.id, { db })).mode).toBe('en')
  })

  it('detects the exam language from past papers before other material', async () => {
    const project = await course()
    const documents = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const add = async (materialType: 'textbook' | 'past_exam', text: string) => {
      const doc = await documents.create({
        projectId: project.id,
        type: 'text',
        name: `${materialType}.txt`,
        sizeBytes: text.length,
        materialType,
      })
      await documents.update(doc.id, { status: 'ready' })
      await chunks.addMany([
        {
          documentId: doc.id,
          projectId: project.id,
          contentType: 'paragraph',
          text,
          sourceReference: doc.name,
          order: 0,
        },
      ])
    }
    // A long English textbook, a short German exam: the exam decides.
    await add('textbook', 'The heart is a muscular organ. '.repeat(200))
    await add('past_exam', 'Beschreiben Sie den Aufbau des Herzens und die Funktion der Klappen.')
    await setCourseLanguageMode(project.id, 'exam', db)
    const resolved = await loadCourseLanguage(project.id, { db })
    expect(resolved).toEqual({ mode: 'exam', examLanguage: 'de', examKey: 'exam:de' })
  })
})
