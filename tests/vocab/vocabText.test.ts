import { describe, expect, it } from 'vitest'
import {
  buildLemmaIndex,
  checkSpelling,
  clozeOf,
  extractCourseTerms,
  formatExport,
  lemmaOf,
  parseWordList,
  rootHints,
  type RootEntry,
} from '@/entities/vocab/text'
import { newVocabCard, previewVocabIntervals, rateVocabCard } from '@/entities/vocab/schedule'

describe('word forms', () => {
  const index = buildLemmaIndex([
    { word: 'perceive', forms: ['perceived', 'perceives', 'perceiving'] },
    { word: 'go', forms: ['went', 'gone'] },
  ])
  const known = (word: string) => ['perceive', 'go', 'muscle', 'study', 'ligament'].includes(word)

  it('finds the headword from listed and regular forms', () => {
    expect(lemmaOf('Went', index, known)).toBe('go')
    expect(lemmaOf('perceiving', index, known)).toBe('perceive')
    expect(lemmaOf('muscles', index, known)).toBe('muscle')
    expect(lemmaOf('studies', index, known)).toBe('study')
    expect(lemmaOf('glenohumeral', index, known)).toBe('glenohumeral')
  })
})

describe('course terms', () => {
  const sources = [
    {
      text: 'The glenoid labrum deepens the glenoid cavity. The labrum is fibrocartilage.',
      page: 3,
      documentName: 'atlas.pdf',
      chunkId: 'c1',
    },
    {
      text: 'Subacromial bursae reduce friction. The subacromial bursa lies under the acromion.',
      page: 4,
      documentName: 'atlas.pdf',
      chunkId: 'c2',
    },
  ]
  const common = new Set([
    'deepens',
    'deepen',
    'cavity',
    'reduce',
    'friction',
    'lies',
    'under',
    'the',
  ])
  const terms = extractCourseTerms(sources, {
    isCommon: (word) => common.has(word),
    lemma: (token) => token,
    limit: 10,
  })

  it('keeps uncommon words, most frequent first, with their first sentence and page', () => {
    const words = terms.map((term) => term.word)
    expect(words.slice(0, 3)).toEqual(['glenoid', 'labrum', 'subacromial'])
    expect(words).not.toContain('friction')
    expect(words).not.toContain('there')
    const labrum = terms.find((term) => term.word === 'labrum')!
    expect(labrum.occurrences).toBe(2)
    expect(labrum.context).toEqual({
      text: 'The glenoid labrum deepens the glenoid cavity.',
      page: 3,
      documentName: 'atlas.pdf',
      chunkId: 'c1',
    })
  })

  it('merges a plural with its singular', () => {
    // An irregular plural stays a word of its own.
    expect(terms.find((term) => term.word === 'bursa')?.occurrences).toBe(1)
    expect(terms.find((term) => term.word === 'bursae')?.occurrences).toBe(1)
    const plural = extractCourseTerms([{ text: 'Tendons pull. A tendon attaches.' }], {
      isCommon: () => false,
      lemma: (t) => t,
      limit: 5,
    })
    expect(plural.find((term) => term.word === 'tendon')?.occurrences).toBe(2)
  })
})

describe('answers', () => {
  it('checks spelling, pointing out a one-letter slip', () => {
    expect(checkSpelling(' Ligament ', 'ligament')).toEqual({ correct: true, nearMiss: false })
    expect(checkSpelling('ligamant', 'ligament')).toEqual({ correct: false, nearMiss: true })
    expect(checkSpelling('tendon', 'ligament')).toEqual({ correct: false, nearMiss: false })
  })

  it('blanks the word or the form the sentence uses', () => {
    expect(clozeOf('The bursa reduces friction.', 'bursa')).toEqual({
      text: 'The _____ reduces friction.',
      answer: 'bursa',
    })
    expect(clozeOf('Tendons attach muscle to bone.', 'tendon')).toEqual({
      text: '_____ attach muscle to bone.',
      answer: 'Tendons',
    })
    expect(clozeOf('It was perceived late.', 'perceive', ['perceived'])?.answer).toBe('perceived')
    expect(clozeOf('Nothing here.', 'tendon')).toBeNull()
  })
})

describe('import and export', () => {
  it('reads plain, tab, comma, colon and Chinese-after-space lists', () => {
    const { words, skipped } = parseWordList(
      '﻿word,meaning\nabandon\nphysiology\tn. 生理学\nglenoid, 关节盂\nlabrum: 唇\nbursa 滑膜囊\n123\nabandon',
    )
    expect(words).toEqual([
      { word: 'abandon' },
      { word: 'physiology', meaning: 'n. 生理学' },
      { word: 'glenoid', meaning: '关节盂' },
      { word: 'labrum', meaning: '唇' },
      { word: 'bursa', meaning: '滑膜囊' },
    ])
    expect(skipped).toBe(1)
  })

  const rows = [
    {
      word: 'bursa',
      phonetic: 'bɜːsə',
      meanings: ['n. 滑膜囊', '囊'],
      context: {
        text: 'The "subacromial" bursa, under the acromion.',
        page: 4,
        documentName: 'atlas.pdf',
      },
      tags: ['course', 'cet6'],
    },
    { word: 'tendon', phonetic: '', meanings: ['n. 肌腱'], tags: ['course'] },
  ]

  it('writes an Anki file with headers, HTML back and tags', () => {
    const lines = formatExport(rows, 'anki').trim().split('\n')
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3'])
    expect(lines[3]).toBe(
      'bursa\t/bɜːsə/<br>n. 滑膜囊<br>囊<br><i>The "subacromial" bursa, under the acromion.</i>\tcourse cet6',
    )
    expect(lines[4]).toBe('tendon\tn. 肌腱\tcourse')
  })

  it('writes Excel-friendly CSV with a BOM and quoted fields', () => {
    const csv = formatExport(rows, 'csv')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe('word,phonetic,meaning,example,source')
    expect(lines[1]).toBe(
      'bursa,bɜːsə,n. 滑膜囊；囊,"The ""subacromial"" bursa, under the acromion.",atlas.pdf p4',
    )
  })

  it('writes one word per line', () => {
    expect(formatExport(rows, 'txt')).toBe('bursa\ntendon\n')
  })

  it('re-imports its own CSV export: meaning column only, quoted fields honoured', () => {
    const { words, skipped } = parseWordList(formatExport(rows, 'csv'))
    expect(words).toEqual([
      { word: 'bursa', meaning: 'n. 滑膜囊；囊' },
      { word: 'tendon', meaning: 'n. 肌腱' },
    ])
    expect(skipped).toBe(0)
  })

  it('reads CSV with quoted commas, line breaks and a reordered header', () => {
    const csv =
      'source,Meaning,Word\r\n"a.pdf, p1","v. 放弃, 抛弃\n离弃",abandon\r\nx,"n. ""肌腱""",tendon\r\n'
    expect(parseWordList(csv).words).toEqual([
      { word: 'abandon', meaning: 'v. 放弃, 抛弃\n离弃' },
      { word: 'tendon', meaning: 'n. "肌腱"' },
    ])
  })

  it('re-imports its own Anki export: back field without phonetic, example, HTML or tags', () => {
    const { words, skipped } = parseWordList(
      formatExport(
        [...rows, { word: 'ligand', phonetic: 'ˈlɪɡənd', meanings: ['n. 配体 <A&B>'], tags: [] }],
        'anki',
      ),
    )
    expect(words).toEqual([
      { word: 'bursa', meaning: 'n. 滑膜囊；囊' },
      { word: 'tendon', meaning: 'n. 肌腱' },
      { word: 'ligand', meaning: 'n. 配体 <A&B>' },
    ])
    expect(skipped).toBe(0)
  })
})

describe('root hints', () => {
  const roots: RootEntry[] = [
    ['sub-', 'prefix', 'under', ['subway']],
    ['-al1', 'adjective suffix', 'relating to', ['natural']],
    ['acro', 'root', 'top, height', ['acrobat']],
    ['xyzw', 'root', 'unrelated', []],
  ]
  it('finds a prefix, a root and a suffix', () => {
    expect(rootHints('subacromial', roots).map((entry) => entry[0])).toEqual([
      'sub-',
      'acro',
      '-al1',
    ])
    // Too little left over: no hint.
    expect(rootHints('state', [['-ate1', 'verb suffix', 'to make', []]])).toEqual([])
  })
})

describe('FSRS scheduling', () => {
  const now = Date.UTC(2026, 9, 18)
  it('starts in learning, comes back sooner when forgotten and later when easy', () => {
    const card = newVocabCard('bursa', 'exam:cet4', now)
    expect(card).toMatchObject({
      word: 'bursa',
      state: 0,
      reps: 0,
      mistakes: 0,
      bookId: 'exam:cet4',
    })
    const preview = previewVocabIntervals(card, now)
    expect(preview[1]).toBeLessThan(preview[3])
    expect(preview[3]).toBeLessThan(preview[4])
    const good = rateVocabCard(card, 3, now)
    expect(good.reps).toBe(1)
    expect(good.last_review).toBe(now)
    // Graduated, then forgotten: a lapse.
    const graduated = rateVocabCard(rateVocabCard(good, 3, good.due), 3, now + 86400000 * 3)
    const forgotten = rateVocabCard(graduated, 1, graduated.due)
    expect(forgotten.lapses).toBe(1)
    expect(forgotten.due - graduated.due).toBeLessThan(86400000)
  })
})
