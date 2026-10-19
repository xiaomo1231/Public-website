// Builds the offline word data in public/vocab/ from ECDICT (MIT,
// https://github.com/skywind3000/ECDICT). Run with `node scripts/build-vocab.mjs`;
// the source files are downloaded into .cache/ecdict/ on first use.
//
//   dictionary.json  every word carrying an exam tag (zk gk cet4 cet6 ky toefl
//                    ielts gre): word, phonetic, Chinese meanings, tag bitmask,
//                    frequency rank, word forms
//   common.json      the most frequent words and their forms, so course
//                    vocabulary can skip words every student already knows
//   roots.json       roots and affixes with their meaning and a few examples

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'ecdict')
const OUT = join(ROOT, 'public', 'vocab')
const SOURCE = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/'

/** Exam tags in bit order — `TAG_ORDER` in src/entities/vocab/types.ts must match. */
const TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']
/** Words at or above this frequency rank count as common. */
const COMMON_RANK = 6000
const MAX_MEANINGS = 3
const MAX_MEANING_CHARS = 60

async function fetchOnce(name) {
  const file = join(CACHE, name)
  if (!existsSync(file)) {
    mkdirSync(CACHE, { recursive: true })
    console.log(`downloading ${name}…`)
    const response = await fetch(SOURCE + name)
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
  }
  return readFileSync(file, 'utf8')
}

/** RFC 4180 CSV (quoted fields may contain commas, quotes and newlines). */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

/** ECDICT stores line breaks inside a field as the two characters `\n`. */
function meanings(translation) {
  return translation
    .split(/\\r\\n|\\n|\r?\n/)
    .map((line) => line.trim())
    // Web-sourced and computing-only senses distract from the core meaning.
    // ECDICT writes them both as "[计] …" and "art. [计] …".
    .filter((line) => line && !/^([a-z]+\.\s*)*\[(网络|计)\]/i.test(line))
    .slice(0, MAX_MEANINGS)
    .map((line) => (line.length > MAX_MEANING_CHARS ? `${line.slice(0, MAX_MEANING_CHARS)}…` : line))
}

const csv = parseCsv(await fetchOnce('ecdict.csv'))
const header = csv[0]
const col = (name) => header.indexOf(name)
const [W, PH, TR, TAG, FRQ, EX] = ['word', 'phonetic', 'translation', 'tag', 'frq', 'exchange'].map(col)

const words = []
const common = new Set()
for (const row of csv.slice(1)) {
  const word = row[W]
  if (!word || !/^[a-z][a-z' -]*$/i.test(word)) continue
  const rank = Number(row[FRQ]) || 0
  const forms = (row[EX] || '')
    .split('/')
    .map((part) => part.split(':')[1])
    .filter(Boolean)
  if (rank > 0 && rank <= COMMON_RANK) {
    common.add(word.toLowerCase())
    for (const form of forms) common.add(form.toLowerCase())
  }
  const tags = (row[TAG] || '').split(/\s+/).filter((t) => TAGS.includes(t))
  if (tags.length === 0) continue
  const lines = meanings(row[TR] || '')
  if (lines.length === 0) continue
  const mask = tags.reduce((bits, tag) => bits | (1 << TAGS.indexOf(tag)), 0)
  words.push([word, row[PH] || '', lines, mask, rank, row[EX] || ''])
}
// Frequent words first inside every book; unranked words last.
words.sort((a, b) => (a[4] || 1e9) - (b[4] || 1e9) || a[0].localeCompare(b[0]))

const roots = []
for (const [key, entry] of Object.entries(JSON.parse(await fetchOnce('wordroot.txt')))) {
  if (!entry?.meaning || key.length < 2) continue
  roots.push([key, entry.class ?? '', String(entry.meaning).slice(0, 80), (entry.example ?? []).slice(0, 3)])
}

mkdirSync(OUT, { recursive: true })
const stamp = { source: 'ECDICT (MIT) https://github.com/skywind3000/ECDICT', tags: TAGS }
writeFileSync(join(OUT, 'dictionary.json'), JSON.stringify({ ...stamp, words }))
writeFileSync(join(OUT, 'common.json'), JSON.stringify({ ...stamp, words: [...common].sort() }))
writeFileSync(join(OUT, 'roots.json'), JSON.stringify({ ...stamp, roots }))
writeFileSync(join(OUT, 'LICENSE-ECDICT.txt'), await fetchOnce('LICENSE'))
console.log(`dictionary: ${words.length} words, common: ${common.size}, roots: ${roots.length}`)
