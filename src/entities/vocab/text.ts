import type { DictEntry, ExportFormat, WordContext } from './types'

/**
 * Pure text helpers for vocabulary: word forms, picking course terms out of
 * the material, spelling checks, importing and exporting word lists, and
 * root / affix hints. No storage, no AI.
 */

const WORD = /^[a-z][a-z'-]*[a-z]$|^[a-z]$/
/** Byte-order mark: Excel needs it to read UTF-8 CSV; imports may start with it. */
const BOM = String.fromCharCode(0xfeff)
const BOM_AT_START = new RegExp(`^${BOM}`)

export function normalizeWord(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/[’‘`]/g, "'")
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

/**
 * Words of the course material a student is likely not to know yet: not
 * common, not a stopword, at least four letters, merged over their forms.
 * Each keeps the first sentence it appears in. Most frequent first.
 */
export function extractCourseTerms(
  sources: TermSource[],
  options: {
    isCommon: (word: string) => boolean
    lemma: (token: string) => string
    limit: number
  },
): TermCandidate[] {
  const found = new Map<string, TermCandidate & { order: number }>()
  let order = 0
  for (const source of sources) {
    for (const sentence of splitSentences(source.text)) {
      for (const raw of sentence.match(/[A-Za-z][A-Za-z'-]*[A-Za-z]/g) ?? []) {
        if (raw.length < 4 || /^[A-Z]{2,}$/.test(raw)) continue
        const token = normalizeWord(raw).replace(/'s$/, '')
        if (!WORD.test(token) || STOPWORDS.has(token)) continue
        const word = options.lemma(token)
        if (
          word.length < 4 ||
          STOPWORDS.has(word) ||
          options.isCommon(word) ||
          options.isCommon(token)
        )
          continue
        const existing = found.get(word)
        if (existing) {
          existing.occurrences++
          continue
        }
        found.set(word, {
          word,
          occurrences: 1,
          order: order++,
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
  // A plural that never appears in its singular form still collapses onto it
  // when the singular appears too (bursae / bursa excepted: irregular).
  for (const [word, candidate] of found) {
    if (word.endsWith('s') && !word.endsWith('ss') && found.has(word.slice(0, -1))) {
      found.get(word.slice(0, -1))!.occurrences += candidate.occurrences
      found.delete(word)
    }
  }
  return [...found.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.order - b.order)
    .slice(0, options.limit)
    .map(({ order: _order, ...candidate }) => candidate)
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

/** A typed spelling: right, or wrong but off by one letter (a slip worth pointing out). */
export function checkSpelling(
  input: string,
  word: string,
): { correct: boolean; nearMiss: boolean } {
  const given = normalizeWord(input)
  const target = normalizeWord(word)
  if (given === target) return { correct: true, nearMiss: false }
  return { correct: false, nearMiss: given.length > 0 && editDistance(given, target) === 1 }
}

/**
 * The example sentence with the word blanked out, and the form that was
 * blanked (the sentence may use a plural or a past tense). Null when the word
 * does not appear in the sentence.
 */
export function clozeOf(
  sentence: string,
  word: string,
  forms: string[] = [],
): { text: string; answer: string } | null {
  const regular = [
    `${word}s`,
    `${word}es`,
    `${word}d`,
    `${word}ed`,
    `${word}ing`,
    ...(word.endsWith('e') ? [`${word.slice(0, -1)}ing`] : []),
    ...(word.endsWith('y') ? [`${word.slice(0, -1)}ies`, `${word.slice(0, -1)}ied`] : []),
  ]
  const variants = [...new Set([word, ...forms, ...regular].filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  for (const variant of variants) {
    const pattern = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const found = pattern.exec(sentence)
    if (found) return { text: sentence.replace(pattern, '_____'), answer: found[0] }
  }
  return null
}

/**
 * Parse a pasted or uploaded word list: one word per line, optionally followed
 * by its meaning after a tab, a comma, a colon or a space before non-Latin
 * text. A header line ("word,…") is skipped.
 */
export function parseWordList(text: string): {
  words: Array<{ word: string; meaning?: string }>
  skipped: number
} {
  const words: Array<{ word: string; meaning?: string }> = []
  const seen = new Set<string>()
  let skipped = 0
  const body = text.replace(BOM_AT_START, '')

  /** Add one entry; false when the word part is not a word. */
  const accept = (rawWord: string, rawMeaning?: string): boolean => {
    const trimmed = rawWord.trim()
    if (!/^([A-Za-z][A-Za-z' -]*[A-Za-z]|[A-Za-z])$/.test(trimmed)) return false
    const word = normalizeWord(trimmed)
    if (word === 'word' || seen.has(word)) return true
    seen.add(word)
    const meaning = rawMeaning?.trim()
    words.push({ word, ...(meaning ? { meaning } : {}) })
    return true
  }

  /** One free-form line: word, then optionally tab / comma / colon / space + meaning. */
  const acceptLine = (rawLine: string) => {
    const line = rawLine.trim()
    if (!line) return
    const match =
      /^([A-Za-z][A-Za-z' -]*?[A-Za-z]|[A-Za-z])\s*(?:[\t,:：]\s*|\s+(?=[^\x20-\x7e]))(.*)$/.exec(
        line,
      ) ?? /^([A-Za-z][A-Za-z' -]*[A-Za-z]|[A-Za-z])$/.exec(line)
    if (!match) {
      skipped++
      return
    }
    accept(match[1]!, match[2]?.replace(/^["']|["']$/g, ''))
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
