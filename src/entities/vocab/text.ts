import type { DictEntry, ExportFormat, WordContext } from './types'
import {
  compareTargetText,
  isEnglish,
  isNearTarget,
  primaryLanguage,
  type TargetComparison,
} from '@/shared/lib/language'

/**
 * Pure text helpers for vocabulary: word forms, picking course terms out of
 * the material, spelling checks, importing and exporting word lists, and
 * root / affix hints. No storage, no AI.
 */

/**
 * Letters of the alphabetic scripts word lists are written in (Latin with
 * every accent, Greek, Cyrillic). Chinese and Japanese are meanings, not words.
 */
const L = String.raw`\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}`
/** A single word: letters (with their combining marks), inner ' and -. */
const WORD = new RegExp(String.raw`^[${L}][${L}\p{M}'-]*[${L}\p{M}]$|^[${L}]$`, 'u')
/** Words in running text. */
const WORD_IN_TEXT = new RegExp(String.raw`[${L}][${L}\p{M}'’-]*[${L}\p{M}]|[${L}]`, 'gu')
/** One entry of a word list: a word or a short phrase ("die Ärztin"). */
const ENTRY = String.raw`[${L}](?:[${L}\p{M}' -]*[${L}\p{M}])?`
/** The same, as short as possible (before a separator and a meaning). */
const ENTRY_LAZY = String.raw`[${L}](?:[${L}\p{M}' -]*?[${L}\p{M}])??`
/** Byte-order mark: Excel needs it to read UTF-8 CSV; imports may start with it. */
const BOM = String.fromCharCode(0xfeff)
const BOM_AT_START = new RegExp(`^${BOM}`)

export function normalizeWord(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/[’‘`]/g, "'")
}

/**
 * The key a word is stored and scheduled under. English words are
 * lower-cased (as always); other languages keep their case, since German
 * nouns are capitalised (`Arzt`, not `arzt`).
 */
export function wordKey(text: string, language?: string): string {
  if (isEnglish(language)) return normalizeWord(text)
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[’‘`]/g, "'")
}

/** Every inflected form → its headword, from the dictionary's word forms. */
export function buildLemmaIndex(
  entries: Iterable<Pick<DictEntry, 'word' | 'forms'>>,
): Map<string, string> {
  const index = new Map<string, string>()
  for (const entry of entries) {
    const lemma = normalizeWord(entry.word)
    for (const form of entry.forms) {
      const key = normalizeWord(form)
      if (key && key !== lemma && !index.has(key)) index.set(key, lemma)
    }
  }
  return index
}

/**
 * Headword of a token: the dictionary's own form table first, then the
 * regular English endings, accepted only when they lead to a known word.
 */
export function lemmaOf(
  token: string,
  index: Map<string, string>,
  known: (word: string) => boolean,
): string {
  const word = normalizeWord(token)
  if (known(word)) return word
  const listed = index.get(word)
  if (listed) return listed
  const tries: string[] = []
  if (word.endsWith('ies')) tries.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('es')) tries.push(word.slice(0, -2))
  if (word.endsWith('s') && !word.endsWith('ss')) tries.push(word.slice(0, -1))
  if (word.endsWith('ied')) tries.push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed')) tries.push(word.slice(0, -2), word.slice(0, -1), word.slice(0, -3))
  if (word.endsWith('ing'))
    tries.push(word.slice(0, -3), `${word.slice(0, -3)}e`, word.slice(0, -4))
  return tries.find((candidate) => candidate.length > 2 && known(candidate)) ?? word
}

/** Sentences of a passage (kept short enough to show as an example). */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？;；])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

const STOPWORDS = new Set(
  'about above after again against also although among another because before being below between both cannot could does doing during each either else enough every first from further have having here hers herself himself however into itself just least less many might more most much must myself neither never often only other ought ours ourselves over rather same several shall should since some such than that their theirs them themselves then there these they this those through thus together under until upon very what when where whether which while whom whose will with within without would your yours yourself yourselves'.split(
    ' ',
  ),
)

/** Function words of the other course languages (added to the English list). */
const STOPWORDS_BY_LANGUAGE: Record<string, Set<string>> = {
  de: new Set(
    'aber alle allem allen aller alles also auch auf aus bei beim bin bist bitte dann darf darum dass dein deine deinem deinen deiner dem den denn der des dich die dies diese diesem diesen dieser dir doch dort durch eine einem einen einer eines euch euer eure für gegen haben habe hast hat hatte hatten heute hier ihm ihn ihnen ihr ihre ihrem ihren ihrer immer jetzt kann kein keine keinem keinen keiner können machen mein meine meinem meinen meiner mich mir mit muss nach nein nicht noch nur oder ohne schon sehr sein seine seinem seinen seiner seit sich sie sind über und uns unser unsere unter viel vom von vor wann warum was weil welche welcher welches wenn werde werden wer wie wieder wird wir woher wohin zum zur zwei'.split(
      ' ',
    ),
  ),
  hu: new Set(
    'akkor amely amelyek amikor annak arra azok azon azonban azt aztán azért csak egyik egyes elég ennek erre ezek ezen ezért hogy hogyan igen ilyen itt kell kérem lesz mert miért mikor milyen minden mint mivel most nagyon nekem neki nekünk nem nincs olyan pedig szerint tehát talán vagy vagyok vagyunk valami van vannak vele volt voltak'.split(
      ' ',
    ),
  ),
}

export interface TermSource {
  text: string
  page?: number
  documentName?: string
  chunkId?: string
}

export interface TermCandidate {
  word: string
  occurrences: number
  context: WordContext
}

/** A line reduced for comparison across pages: case, spacing and numbers ignored. */
function lineKey(line: string): string {
  return line.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').toLowerCase()
}

/**
 * The material without its running headers and footers: lines (numbers
 * aside) found on at least half of a document's pages, when it has four
 * pages or more. A university name in every page header would otherwise be
 * among the most frequent "terms" of the course.
 */
export function dropRunningLines(sources: TermSource[]): TermSource[] {
  const pagesByDocument = new Map<string, Map<string, Set<string>>>()
  sources.forEach((source, i) => {
    const document = source.documentName ?? ''
    const page = source.page !== undefined ? String(source.page) : `#${i}`
    const pages = pagesByDocument.get(document) ?? new Map<string, Set<string>>()
    const lines = pages.get(page) ?? new Set<string>()
    for (const line of source.text.split(/\r?\n/)) {
      const key = lineKey(line)
      if (/\p{L}.*\p{L}/u.test(key)) lines.add(key)
    }
    pages.set(page, lines)
    pagesByDocument.set(document, pages)
  })
  const running = new Map<string, Set<string>>()
  for (const [document, pages] of pagesByDocument) {
    if (pages.size < 4) continue
    const counts = new Map<string, number>()
    for (const lines of pages.values())
      for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
    const threshold = Math.max(3, Math.ceil(pages.size / 2))
    const repeated = new Set([...counts].filter(([, n]) => n >= threshold).map(([line]) => line))
    if (repeated.size) running.set(document, repeated)
  }
  if (running.size === 0) return sources
  return sources.map((source) => {
    const repeated = running.get(source.documentName ?? '')
    if (!repeated) return source
    const text = source.text
      .split(/\r?\n/)
      .filter((line) => !repeated.has(lineKey(line)))
      .join('\n')
    return { ...source, text }
  })
}

interface FoundTerm extends TermCandidate {
  order: number
  /** Written forms seen: how often, and how often not at a sentence start. */
  forms: Map<string, { count: number; inner: number }>
}

/**
 * Words of the course material a student is likely not to know yet: not
 * common, not a stopword, at least four letters, merged over their forms.
 * Each keeps the first sentence it appears in. Most frequent first. Running
 * headers and footers are left out.
 *
 * English words are lower-cased and merged onto their headword. Words of
 * another `language` (German, Hungarian, …) keep their written case — the
 * form seen inside sentences wins over a capital at a sentence start — and
 * are not lemmatised.
 */
export function extractCourseTerms(
  sources: TermSource[],
  options: {
    /** `initial`: the word opens its sentence (only passed for non-English material). */
    isCommon: (word: string, initial?: boolean) => boolean
    lemma: (token: string) => string
    limit: number
    /** BCP-47 language of the material; English when absent. */
    language?: string
  },
): TermCandidate[] {
  const english = isEnglish(options.language)
  const extra = STOPWORDS_BY_LANGUAGE[primaryLanguage(options.language) ?? ''] ?? new Set()
  const isStopword = (word: string) => STOPWORDS.has(word) || extra.has(word)
  const found = new Map<string, FoundTerm>()
  let order = 0
  for (const source of dropRunningLines(sources)) {
    for (const sentence of splitSentences(source.text)) {
      let index = 0
      for (const raw of sentence.match(WORD_IN_TEXT) ?? []) {
        const initial = index++ === 0
        if ([...raw].length < 4 || /^\p{Lu}{2,}$/u.test(raw)) continue
        let word: string
        let surface: string
        if (english) {
          const token = normalizeWord(raw).replace(/'s$/, '')
          if (!WORD.test(token) || isStopword(token)) continue
          word = options.lemma(token)
          if (
            [...word].length < 4 ||
            isStopword(word) ||
            options.isCommon(word) ||
            options.isCommon(token)
          )
            continue
          surface = word
        } else {
          surface = wordKey(raw, options.language)
          word = surface.toLowerCase()
          if (!WORD.test(surface) || isStopword(word) || options.isCommon(surface, initial))
            continue
        }
        const existing = found.get(word)
        if (existing) {
          existing.occurrences++
          const form = existing.forms.get(surface) ?? { count: 0, inner: 0 }
          form.count++
          if (!initial) form.inner++
          existing.forms.set(surface, form)
          continue
        }
        found.set(word, {
          word,
          occurrences: 1,
          order: order++,
          forms: new Map([[surface, { count: 1, inner: initial ? 0 : 1 }]]),
          context: {
            text: sentence.length > 240 ? `${sentence.slice(0, 240)}…` : sentence,
            ...(source.page !== undefined ? { page: source.page } : {}),
            ...(source.documentName ? { documentName: source.documentName } : {}),
            ...(source.chunkId ? { chunkId: source.chunkId } : {}),
          },
        })
      }
    }
  }
  if (english) {
    // A plural that never appears in its singular form still collapses onto it
    // when the singular appears too (bursae / bursa excepted: irregular).
    for (const [word, candidate] of found) {
      if (word.endsWith('s') && !word.endsWith('ss') && found.has(word.slice(0, -1))) {
        found.get(word.slice(0, -1))!.occurrences += candidate.occurrences
        found.delete(word)
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.order - b.order)
    .slice(0, options.limit)
    .map(({ order: _order, forms, ...candidate }) => ({
      ...candidate,
      word: english ? candidate.word : writtenForm(forms),
    }))
}

/**
 * The written form of a non-English word: the one seen most often inside a
 * sentence (a capital at a sentence start says nothing), else the most
 * frequent; the first seen on a tie.
 */
function writtenForm(forms: Map<string, { count: number; inner: number }>): string {
  const list = [...forms]
  const inner = list.filter(([, form]) => form.inner > 0)
  const pool = inner.length ? inner : list
  const score = (form: { count: number; inner: number }) => (inner.length ? form.inner : form.count)
  return pool.reduce((best, item) => (score(item[1]) > score(best[1]) ? item : best))[0]
}

/** Distance of two short strings (insertions, deletions, substitutions). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/** A typed spelling checked against the word. */
export interface SpellingResult {
  correct: boolean
  /**
   * Close but not right: one letter off, or (other languages) right apart
   * from accents, capitalisation or a spelling variant. Rated "hard".
   */
  nearMiss: boolean
  /** Other languages: how the spelling differs (`exact` when correct). */
  outcome?: TargetComparison
}

/**
 * A typed spelling: right, or wrong but off by one letter (a slip worth
 * pointing out). English ignores case, as always. Other languages are strict:
 * a missing accent (fájdalom), a lower-case German noun (Arzt) or ss for ß
 * is a near miss, not a correct answer.
 */
export function checkSpelling(input: string, word: string, language?: string): SpellingResult {
  if (isEnglish(language)) {
    const given = normalizeWord(input)
    const target = normalizeWord(word)
    if (given === target) return { correct: true, nearMiss: false }
    return { correct: false, nearMiss: given.length > 0 && editDistance(given, target) === 1 }
  }
  const outcome = compareTargetText(word, input, language)
  if (outcome === 'exact') return { correct: true, nearMiss: false, outcome }
  if (isNearTarget(outcome)) return { correct: false, nearMiss: true, outcome }
  const given = wordKey(input, language)
  const target = wordKey(word, language)
  return {
    correct: false,
    nearMiss: given.length > 0 && editDistance(given, target) === 1,
    outcome,
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The example sentence with the word blanked out, and the form that was
 * blanked (the sentence may use a plural or a past tense). Null when the word
 * does not appear in the sentence. Words of another language are matched as
 * written (plus any listed forms), without English endings.
 */
export function clozeOf(
  sentence: string,
  word: string,
  forms: string[] = [],
  language?: string,
): { text: string; answer: string } | null {
  const regular = isEnglish(language)
    ? [
        `${word}s`,
        `${word}es`,
        `${word}d`,
        `${word}ed`,
        `${word}ing`,
        ...(word.endsWith('e') ? [`${word.slice(0, -1)}ing`] : []),
        ...(word.endsWith('y') ? [`${word.slice(0, -1)}ies`, `${word.slice(0, -1)}ied`] : []),
      ]
    : []
  const variants = [...new Set([word, ...forms, ...regular].filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  const text = sentence.normalize('NFC')
  for (const variant of variants) {
    // Letters of any script count as part of a word (`\b` only knows ASCII).
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}])${escapeRegExp(variant.normalize('NFC'))}(?![\\p{L}\\p{M}])`,
      'iu',
    )
    const found = pattern.exec(text)
    if (found) return { text: text.replace(pattern, '_____'), answer: found[0] }
  }
  return null
}

/** Articles written before a noun in a word list ("der Arzt", "a fej"). */
const ARTICLES: Record<string, Set<string>> = {
  de: new Set(['der', 'die', 'das', 'ein', 'eine']),
  hu: new Set(['a', 'az', 'egy']),
}

/**
 * Parse a pasted or uploaded word list: one word per line, optionally followed
 * by its meaning after a tab, a comma, a colon, an equals sign, a spaced dash
 * ("die Ärztin – female doctor") or a space before non-Latin text. A header
 * line ("word,…") is skipped.
 *
 * In a list of another `language`, words keep their case and a plain English
 * meaning may follow after a space ("fájdalom pain"); a leading article stays
 * with its noun ("der Arzt physician").
 */
export function parseWordList(
  text: string,
  options: { language?: string } = {},
): {
  words: Array<{ word: string; meaning?: string }>
  skipped: number
} {
  const { language } = options
  const english = isEnglish(language)
  const articles = ARTICLES[primaryLanguage(language) ?? ''] ?? new Set<string>()
  const words: Array<{ word: string; meaning?: string }> = []
  const seen = new Set<string>()
  let skipped = 0
  const body = text.replace(BOM_AT_START, '')
  const entryOnly = new RegExp(`^${ENTRY}$`, 'u')

  /** Add one entry; false when the word part is not a word. */
  const accept = (rawWord: string, rawMeaning?: string): boolean => {
    const trimmed = rawWord.normalize('NFC').trim()
    if (!entryOnly.test(trimmed)) return false
    const word = wordKey(trimmed, language)
    if (word.toLowerCase() === 'word' || seen.has(word)) return true
    seen.add(word)
    const meaning = rawMeaning?.trim()
    words.push({ word, ...(meaning ? { meaning } : {}) })
    return true
  }

  const separated = new RegExp(
    String.raw`^(${ENTRY_LAZY})\s*(?:[\t,:：=]\s*|\s[–—-]\s+|\s+(?=[^\x00-\x7f\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]))(.*)$`,
    'u',
  )

  /** Other languages: "fájdalom pain", "der Arzt physician" (an English meaning after a space). */
  const spaced = (line: string): [string, string] | null => {
    const tokens = line.split(/\s+/)
    const take = articles.has(tokens[0]!.toLowerCase()) ? 2 : 1
    if (tokens.length <= take) return null
    const meaning = tokens.slice(take).join(' ')
    // Only a plain (ASCII) gloss that does not go on in the same language:
    // "fáj a fejem" is one phrase, not "fáj" + "a fejem".
    if (/[^\x20-\x7e]/.test(meaning) || articles.has(tokens[take]!.toLowerCase())) return null
    return [tokens.slice(0, take).join(' '), meaning]
  }

  /** One free-form line: word, then optionally a separator + meaning. */
  const acceptLine = (rawLine: string) => {
    const line = rawLine.normalize('NFC').trim()
    if (!line) return
    const match = separated.exec(line)
    if (match) {
      accept(match[1]!, match[2]?.replace(/^["']|["']$/g, ''))
      return
    }
    if (entryOnly.test(line) && (english || !spaced(line))) {
      accept(line)
      return
    }
    const pair = english ? null : spaced(line)
    if (pair && accept(pair[0], pair[1])) return
    skipped++
  }

  const lines = body.split(/\r?\n/)
  const firstLine = lines.find((line) => line.trim())?.trim() ?? ''

  // Anki text export (ours writes `#separator:tab`, `#html:true`, `#tags column:3`).
  if (/^#(separator|html|tags column|notetype|deck|columns|guid)\b/i.test(firstLine)) {
    const headers = lines.filter((line) => line.startsWith('#'))
    const separator = ankiSeparator(headers)
    const html = !headers.some((line) => /^#html:\s*false/i.test(line))
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue
      const fields = line.split(separator)
      const front = html ? htmlToText(fields[0] ?? '') : (fields[0] ?? '')
      const back = fields[1] !== undefined ? ankiBackMeaning(fields[1], html) : undefined
      if (!accept(front, back)) skipped++
    }
    return { words, skipped }
  }

  // CSV with a header row (e.g. our own `word,phonetic,meaning,example,source`)
  // or with quoted fields: parse it as CSV so quotes and extra columns are
  // honoured. Records with a single field fall back to the free-form reader.
  const header = parseCsv(firstLine)[0]?.map((cell) => cell.trim().toLowerCase()) ?? []
  const wordColumn = header.findIndex((cell) => WORD_HEADERS.has(cell))
  const hasHeader = header.length >= 2 && wordColumn >= 0
  const quotedCsv = firstLine.includes(',') && /"/.test(body)
  if (hasHeader || quotedCsv) {
    const meaningColumn = hasHeader ? header.findIndex((cell) => MEANING_HEADERS.has(cell)) : 1
    const records = parseCsv(body)
    for (const [index, record] of records.entries()) {
      if (index === 0 && hasHeader) continue
      if (record.every((cell) => !cell.trim())) continue
      if (record.length < 2) {
        acceptLine(record[0] ?? '')
        continue
      }
      const rawWord = record[hasHeader ? wordColumn : 0] ?? ''
      const meaning = meaningColumn >= 0 ? record[meaningColumn] : undefined
      if (!accept(rawWord, meaning)) skipped++
    }
    return { words, skipped }
  }

  for (const rawLine of lines) acceptLine(rawLine)
  return { words, skipped }
}

const WORD_HEADERS = new Set(['word', 'words', 'term', 'headword', '单词', '词'])
const MEANING_HEADERS = new Set([
  'meaning',
  'meanings',
  'definition',
  'translation',
  'gloss',
  '释义',
  '意思',
  '词义',
])

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && !field.trim()) {
      quoted = true
      field = ''
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field || record.length) {
    record.push(field)
    records.push(record)
  }
  return records
}

function ankiSeparator(headers: string[]): string | RegExp {
  const line = headers.find((header) => /^#separator:/i.test(header))
  const value =
    line
      ?.replace(/^#separator:/i, '')
      .trim()
      .toLowerCase() ?? 'tab'
  const named: Record<string, string> = {
    tab: '\t',
    comma: ',',
    semicolon: ';',
    pipe: '|',
    colon: ':',
  }
  if (value === 'space') return / +/
  return named[value] ?? (value.length === 1 ? value : '\t')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).trim()
}

/** The meaning from an Anki back field: no example (`<i>…</i>`), no `/phonetic/`, no HTML. */
function ankiBackMeaning(back: string, html: boolean): string {
  if (!html) return back.trim()
  return back
    .replace(/<i>[\s\S]*?<\/i>/gi, '')
    .split(/<br\s*\/?>/i)
    .map(htmlToText)
    .filter((part) => part && !/^\/[^/]+\/$/.test(part))
    .join('；')
}

export interface ExportRow {
  word: string
  phonetic: string
  meanings: string[]
  context?: WordContext
  tags: string[]
}

const csvField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
const ankiField = (value: string) => value.replace(/[\t\r\n]+/g, ' ')
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A word list in a format other apps import:
 *  - `anki`: tab-separated notes (front, back, tags) with Anki's file headers
 *  - `csv`: UTF-8 with BOM so Excel opens it correctly
 *  - `txt`: one word per line (Qwerty Learner, TypeWords and most apps)
 */
export function formatExport(rows: ExportRow[], format: ExportFormat): string {
  if (format === 'txt') return `${rows.map((row) => row.word).join('\n')}\n`
  if (format === 'csv') {
    const lines = [['word', 'phonetic', 'meaning', 'example', 'source'].join(',')]
    for (const row of rows) {
      const source = row.context
        ? [row.context.documentName, row.context.page !== undefined ? `p${row.context.page}` : '']
            .filter(Boolean)
            .join(' ')
        : ''
      lines.push(
        [row.word, row.phonetic, row.meanings.join('；'), row.context?.text ?? '', source]
          .map(csvField)
          .join(','),
      )
    }
    return `${BOM}${lines.join('\r\n')}\r\n`
  }
  const lines = ['#separator:tab', '#html:true', '#tags column:3']
  for (const row of rows) {
    const back = [
      row.phonetic ? `/${escapeHtml(row.phonetic)}/` : '',
      ...row.meanings.map(escapeHtml),
      row.context ? `<i>${escapeHtml(row.context.text)}</i>` : '',
    ]
      .filter(Boolean)
      .join('<br>')
    lines.push([row.word, back, row.tags.join(' ')].map(ankiField).join('\t'))
  }
  return `${lines.join('\n')}\n`
}

export type RootEntry = [key: string, kind: string, meaning: string, examples: string[]]

/** Roots and affixes the word may contain (a hint, not an etymology). */
export function rootHints(word: string, roots: RootEntry[]): RootEntry[] {
  const target = normalizeWord(word)
  const clean = (key: string) => key.toLowerCase().replace(/\d+$/, '')
  const prefixes: RootEntry[] = []
  const suffixes: RootEntry[] = []
  const inner: RootEntry[] = []
  for (const entry of roots) {
    const key = clean(entry[0])
    const core = key.replace(/^-|-$/g, '')
    // Leave a stem of at least three letters, so "state" is not st + -ate.
    if (core.length < 2 || target.length - core.length < 3) continue
    if (key.endsWith('-') && !key.startsWith('-')) {
      if (target.startsWith(core)) prefixes.push(entry)
    } else if (key.startsWith('-') && !key.endsWith('-')) {
      if (target.endsWith(core)) suffixes.push(entry)
    } else if (!key.includes('-') && core.length >= 4 && target.includes(core)) {
      inner.push(entry)
    }
  }
  const longest = (list: RootEntry[]) =>
    [...list].sort((a, b) => clean(b[0]).length - clean(a[0]).length)[0]
  return [longest(prefixes), longest(inner), longest(suffixes)].filter(
    (entry): entry is RootEntry => Boolean(entry),
  )
}
