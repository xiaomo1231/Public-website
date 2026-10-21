import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  compareTargetText,
  isEnglish,
  primaryLanguage,
  stripDiacritics,
  targetHintKey,
  targetLanguageOf,
  type TargetComparison,
} from '@/shared/lib/language'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { checkBlanksWithAi } from '@/services/fillBlankChecker'
import { hasVoiceFor, speak, voiceFor } from '@/shared/lib/speech'
import { languageSymbolGroup, symbolGroupsFor } from '@/shared/lib/mathInput'
import type { Question } from '@/entities/question/types'
import type { AIService } from '@/services/aiService'
import { StudySession } from '@/widgets/vocab/StudySession'
import type { SessionItem } from '@/entities/vocab/types'
import type { VocabService } from '@/services/vocabService'

describe('language codes', () => {
  it('reads the primary subtag', () => {
    expect(primaryLanguage('de-AT')).toBe('de')
    expect(primaryLanguage('HU')).toBe('hu')
    expect(primaryLanguage('')).toBeUndefined()
    expect(primaryLanguage('12')).toBeUndefined()
    expect(isEnglish(undefined)).toBe(true)
    expect(isEnglish('en-GB')).toBe(true)
    expect(isEnglish('de')).toBe(false)
  })

  it('reads a project target language only for language courses', () => {
    expect(targetLanguageOf({ subject: 'language', targetLanguage: 'de-DE' })).toBe('de')
    expect(targetLanguageOf({ subject: 'medicine', targetLanguage: 'de' })).toBeUndefined()
    expect(targetLanguageOf({ subject: 'language' })).toBeUndefined()
    expect(targetLanguageOf({ targetLanguage: 'hu' })).toBe('hu')
    expect(targetLanguageOf(undefined)).toBeUndefined()
  })
})

describe('compareTargetText', () => {
  it('removes diacritics but keeps ß', () => {
    expect(stripDiacritics('fájdalom ő ű Ärztin')).toBe('fajdalom o u Arztin')
    expect(stripDiacritics('Straße')).toBe('Straße')
  })

  const table: Array<[string, string, string, TargetComparison]> = [
    ['fájdalom', 'fájdalom', 'hu', 'exact'],
    ['fájdalom', ' fájdalom. ', 'hu', 'exact'],
    ['fájdalom', 'fajdalom', 'hu', 'accent'],
    ['szőr', 'szor', 'hu', 'accent'],
    ['szőr', 'ször', 'hu', 'accent'],
    ['Arzt', 'arzt', 'de', 'case'],
    ['Ärztin', 'Arztin', 'de', 'accent'],
    ['Ärztin', 'Aerztin', 'de', 'variant'],
    ['Straße', 'Strasse', 'de', 'variant'],
    ['Übelkeit', 'uebelkeit', 'de', 'variant'],
    ['Straße', 'Strasse', 'hu', 'wrong'],
    ['Arzt', 'Hund', 'de', 'wrong'],
    ['Arzt', '', 'de', 'wrong'],
  ]
  it.each(table)('%s vs %s (%s) → %s', (expected, answer, lang, outcome) => {
    expect(compareTargetText(expected, answer, lang)).toBe(outcome)
  })

  it('names the hint for each outcome', () => {
    expect(targetHintKey('accent')).toBe('language.hint.accent')
    expect(targetHintKey('case')).toBe('language.hint.case')
    expect(targetHintKey('variant', 'Straße', 'Strasse')).toBe('language.hint.eszett')
    expect(targetHintKey('variant', 'Übelkeit', 'Uebelkeit')).toBe('language.hint.umlaut')
    expect(targetHintKey('exact')).toBeNull()
    expect(targetHintKey('wrong')).toBeNull()
  })
})

describe('fill-blank in a course taught in German or Hungarian', () => {
  const q: Question = {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'K',
    type: 'fill_blank',
    difficulty: 'basic',
    prompt: 'Der ____ untersucht die ____.',
    correctAnswer: 'Arzt | Patientin',
    blanks: [['Arzt', 'Doktor'], ['Patientin']],
    hints: [],
    sourceRefs: [],
    promptVersion: 'v6',
    createdAt: 1,
  }

  it('accepts only the exact spelling; accents and capitals earn half a blank', () => {
    const exact = evaluateDeterministic(q, 'Arzt\nPatientin', { targetLanguage: 'de' })
    expect(exact).toMatchObject({ isCorrect: true, score: { earned: 2, total: 2 } })

    const lowerCase = evaluateDeterministic(q, 'arzt\nPatientin', { targetLanguage: 'de' })
    expect(lowerCase).toMatchObject({ isCorrect: false, score: { earned: 1.5, total: 2 } })
    expect(lowerCase.blanks![0]).toMatchObject({
      correct: false,
      spelling: 'case',
      expectedForm: 'Arzt',
    })

    const hu: Question = { ...q, prompt: 'A ____ erős.', blanks: [['fájdalom']] }
    const accent = evaluateDeterministic(hu, 'fajdalom', { targetLanguage: 'hu' })
    expect(accent).toMatchObject({ isCorrect: false, score: { earned: 0.5, total: 1 } })
    expect(accent.blanks![0]).toMatchObject({ spelling: 'accent', expectedForm: 'fájdalom' })
  })

  it('stays lenient about case without a target language (as before)', () => {
    expect(evaluateDeterministic(q, 'arzt\npatientin')).toMatchObject({
      isCorrect: true,
      score: { earned: 2, total: 2 },
    })
  })

  it('does not ask the AI to excuse a misspelling', async () => {
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        blanks: [
          { index: 1, equivalent: true },
          { index: 2, equivalent: true },
        ],
      },
    })
    const ai = { chatJSON } as unknown as AIService
    // Only spelling slips: nothing to ask.
    const slips = evaluateDeterministic(q, 'arzt\npatientin', { targetLanguage: 'de' })
    expect(await checkBlanksWithAi(ai, q, slips)).toBe(slips)
    expect(chatJSON).not.toHaveBeenCalled()

    // A slip and a different word: only the different word is asked about.
    const mixed = evaluateDeterministic(q, 'arzt\nKranke', { targetLanguage: 'de' })
    const checked = await checkBlanksWithAi(ai, q, mixed)
    expect(chatJSON).toHaveBeenCalledTimes(1)
    const prompt = chatJSON.mock.calls[0]![0][1].content as string
    expect(prompt).toContain('Kranke')
    expect(prompt).not.toContain('arzt')
    expect(checked.blanks![0]).toMatchObject({ correct: false, spelling: 'case' })
    expect(checked.blanks![1]).toMatchObject({ correct: true, byAi: true })
    expect(checked).toMatchObject({ isCorrect: false, score: { earned: 1.5, total: 2 } })
  })
})

describe('speech voices', () => {
  const original = { synth: window.speechSynthesis, utterance: globalThis.SpeechSynthesisUtterance }
  afterEach(() => {
    Object.defineProperty(window, 'speechSynthesis', { value: original.synth, configurable: true })
    globalThis.SpeechSynthesisUtterance = original.utterance
  })

  function mockVoices(list: Array<{ lang: string; name: string; default?: boolean }>) {
    const spoken: Array<{ text: string; lang: string; voice?: { name: string } }> = []
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => list.map((voice) => ({ default: false, ...voice })),
        cancel: vi.fn(),
        speak: (utterance: { text: string; lang: string; voice?: { name: string } }) =>
          spoken.push(utterance),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    globalThis.SpeechSynthesisUtterance = class {
      text: string
      lang = ''
      rate = 1
      voice?: unknown
      constructor(text: string) {
        this.text = text
      }
    } as unknown as typeof SpeechSynthesisUtterance
    return spoken
  }

  it('picks a voice of the language, preferring the exact region', () => {
    const spoken = mockVoices([
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'de-AT', name: 'Austria' },
      { lang: 'de-DE', name: 'Anna' },
    ])
    expect(voiceFor('de')?.name).toBe('Austria')
    expect(voiceFor('de-DE')?.name).toBe('Anna')
    expect(hasVoiceFor('de')).toBe(true)
    expect(hasVoiceFor('hu')).toBe(false)
    speak('Übelkeit', 'de')
    expect(spoken[0]).toMatchObject({ text: 'Übelkeit', lang: 'de-AT', voice: { name: 'Austria' } })
    speak('fájdalom', 'hu')
    expect(spoken[1]).toMatchObject({ lang: 'hu' })
    expect(spoken[1]!.voice).toBeUndefined()
  })

  it('falls back from dictation to spelling and says so when no voice is installed', async () => {
    mockVoices([{ lang: 'en-US', name: 'Samantha' }])
    const service = {
      grade: vi.fn(async () => ({})),
      previewIntervals: vi.fn(async () => ({ 1: 1, 2: 2, 3: 3, 4: 4 })),
      details: vi.fn(async () => ({ view: {}, roots: [] })),
    } as unknown as VocabService
    const items: SessionItem[] = [
      {
        view: { word: 'fájdalom', phonetic: '', meanings: ['pain'], tags: [] },
        kind: 'review',
        mode: 'dictation',
        language: 'hu',
      },
    ]
    render(<StudySession items={items} bookId="b1" service={service} onExit={() => undefined} />)
    expect(screen.getByText('Spelling')).toBeInTheDocument()
    expect(screen.getByText(/This device has no Hungarian voice/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Listen again' })).toBeNull()
  })
})

describe('vocabulary grading in German and Hungarian', () => {
  const service = () => {
    const grade = vi.fn(async () => ({}))
    return {
      grade,
      service: {
        grade,
        previewIntervals: vi.fn(async () => ({ 1: 1, 2: 2, 3: 3, 4: 4 })),
        details: vi.fn(async () => ({ view: {}, roots: [] })),
      } as unknown as VocabService,
    }
  }
  const spell = (word: string, language: string): SessionItem => ({
    view: { word, phonetic: '', meanings: ['meaning'], tags: [] },
    kind: 'review',
    mode: 'spell',
    language,
  })

  it.each([
    ['Arzt', 'de', 'arzt', 'Mind the capitalisation: Arzt'],
    ['fájdalom', 'hu', 'fajdalom', 'Mind the accents: fájdalom'],
    ['Straße', 'de', 'Strasse', 'ß written as ss: Straße'],
  ])('%s (%s) typed as %s is "hard" with a hint', async (word, language, typed, hint) => {
    const { service: fake, grade } = service()
    render(
      <StudySession
        items={[spell(word, language)]}
        bookId="b1"
        service={fake}
        onExit={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('Type the word'), { target: { value: typed } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText(hint)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() =>
      expect(grade).toHaveBeenCalledWith(word, 2, 'spell', {
        correct: false,
        bookId: 'b1',
        language,
      }),
    )
  })

  it('offers the language letters under the spelling field', () => {
    const { service: fake } = service()
    render(
      <StudySession
        items={[spell('Übelkeit', 'de')]}
        bookId="b1"
        service={fake}
        onExit={() => undefined}
      />,
    )
    const input = screen.getByLabelText('Type the word') as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Insert Ü' }))
    expect(input.value).toBe('Ü')
  })

  it('keeps English spelling unchanged (case-insensitive, one-letter near miss)', async () => {
    const { service: fake, grade } = service()
    const items: SessionItem[] = [
      {
        view: { word: 'tendon', phonetic: '', meanings: ['肌腱'], tags: [] },
        kind: 'review',
        mode: 'spell',
      },
    ]
    render(<StudySession items={items} bookId={null} service={fake} onExit={() => undefined} />)
    expect(screen.queryByRole('group', { name: 'German letters' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Type the English word'), {
      target: { value: 'Tendon' },
    })
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(grade).toHaveBeenCalledWith('tendon', 3, 'spell', { correct: true }))
  })
})

describe('symbol keyboard letters', () => {
  it('puts the course language letters first in text fields', () => {
    expect(symbolGroupsFor('text', 'medicine', 'de')[0]!.id).toBe('de')
    expect(symbolGroupsFor('text', 'medicine', 'hu-HU')[0]!.items.map((i) => i.glyph)).toEqual([
      ...'áéíóöőúüűÁÉÍÓÖŐÚÜŰ',
    ])
    expect(symbolGroupsFor('text', 'medicine')[0]!.id).toBe('medicine')
    expect(symbolGroupsFor('text', 'medicine', 'fr')[0]!.id).toBe('medicine')
    expect(symbolGroupsFor('expression', 'calculus', 'de').some((g) => g.id === 'de')).toBe(false)
    expect(languageSymbolGroup('de')!.items.map((i) => i.glyph)).toEqual([...'äöüßÄÖÜ', '„', '“'])
    expect(languageSymbolGroup('en')).toBeNull()
  })
})

describe('vocab-gloss v2', () => {
  it('is v1 word for word for English and names the course language otherwise', async () => {
    const v1 = await import('@/infrastructure/ai/prompts/vocab-gloss/v1')
    const v2 = await import('@/infrastructure/ai/prompts/vocab-gloss/v2')
    const input = { subject: 'medicine', terms: [{ word: 'bursa', sentence: 'The bursa…' }] }
    expect(v2.buildSystemPrompt()).toBe(v1.buildSystemPrompt())
    expect(v2.buildUserPrompt(input)).toBe(v1.buildUserPrompt(input))
    expect(v2.buildUserPrompt({ ...input, targetLanguage: 'en' })).toBe(v1.buildUserPrompt(input))
    expect(v2.buildSystemPrompt({ targetLanguage: 'hu' })).toContain('Hungarian')
    const glosses = v2.readGlosses({ terms: [{ word: 'arzt', meaning: '医生' }] }, ['Arzt'])
    expect(glosses.get('Arzt')).toEqual({ meaning: '医生' })
  })
})
