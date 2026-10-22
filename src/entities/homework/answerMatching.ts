/**
 * Deterministic matching between a professor answer sheet and a homework's
 * questions.
 *
 * The rule is deliberately conservative: an answer is only auto-assigned when
 * it is a *unique one-to-one* match on the printed number. Duplicate numbers
 * (on either side), missing numbers, or any answer that is not uniquely tied to
 * a question are handed to the student for manual review. Nothing is ever
 * matched by position, and an unconfirmed answer is never used to generate.
 *
 * Pure functions — no storage, no AI — so the rules are directly testable.
 */

/** One answer entry parsed from the linked answer document. */
export interface AnswerEntry {
  /** Printed number, when one was recognised. */
  number?: string
  /** Verbatim answer text (may include working steps). */
  text: string
  /** Real chunk ids of the answer document this entry came from. */
  chunkIds: string[]
  /** Real page numbers this entry came from, in order (diagnostics + UI). */
  pageNumbers?: number[]
}

/**
 * A numbered entry is not necessarily a worked answer. Some answer sheets
 * deliberately leave a problem to the student. Treat these explicit deferrals
 * as unavailable answer evidence, even when the PDF text layer also contains
 * labels flattened from a nearby diagram.
 */
export function isDeferredProfessorAnswer(text: string): boolean {
  return professorAnswerDeferral(text) === 'full'
}

/**
 * How much of a professor answer is left to the student:
 *  - `none`: nothing is deferred;
 *  - `partial`: some sub-parts are left to the student ("I leave the first
 *    part to you", "the rest is left as an exercise") or the answer still
 *    carries worked content besides the deferral — the worked parts are
 *    usable, the others are written as our own explanation;
 *  - `full`: the whole problem is left to the student (only flattened diagram
 *    labels or a restated question may remain) — nothing to ground help in.
 */
export type ProfessorDeferral = 'none' | 'partial' | 'full'

const DEFERRAL_EN =
  /(?:left (?:to|for) you|leave\b[^.;!?\n]{0,40}?\b(?:to|for) you|(?:left|assigned) (?:as|for) (?:an |the )?exercises?|exercise (?:for|to) (?:the )?(?:reader|student)|homework for (?:the )?(?:reader|student)|try (?:it|this) (?:yourself|on your own)|solution (?:omitted|is omitted)|no (?:solution|answer) (?:provided|given))\b/
const DEFERRAL_ZH =
  /(?:留给(?:你|学生|读者)(?:自己)?(?:完成|解答|练习)|请(?:你|学生|读者)自行(?:完成|解答|求解)|答案略|解答略|解略|不提供(?:答案|解答))/
/** A deferral sentence that names only some of the problem. */
const PARTIAL_SCOPE =
  /\b(?:first|second|third|fourth|last|other|remaining|next)\s+(?:two\s+|three\s+)?(?:parts?|steps?|questions?|half)\b|\bthe rest\b|\bpart\s*[(（]?[a-z0-9][)）]?(?=[\s,.;:]|$)|(?:^|[\s,;:])[(（][a-z0-9][)）](?=[\s,.;:]|$)|其余|剩下|第[一二三四五六七八九十\d]+(?:问|小题|部分)|前[一二两三四\d]+(?:问|小题)/
/** Worked content: equations, implications, matrices written out. */
const WORKED_SYMBOL = /[=⇒⟹→≠≤≥]/g

export function professorAnswerDeferral(text: string): ProfessorDeferral {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
  const isDeferral = (sentence: string) => DEFERRAL_EN.test(sentence) || DEFERRAL_ZH.test(sentence)
  if (!isDeferral(normalized)) return 'none'
  // An answer sheet often restates the problem before "Solution:"; only the
  // professor's own part counts as worked content.
  const marker = /\b(?:solution|answer|proof|sol)\s*[:.]|解[:：]|解答[:：]|答[:：]/.exec(normalized)
  const own = marker ? normalized.slice(marker.index + marker[0].length) : normalized
  const sentences = own.split(/(?<=[.!?。！？;；])\s+|(?<=[。！？；])/)
  const deferring = sentences.filter(isDeferral)
  if (deferring.some((sentence) => PARTIAL_SCOPE.test(sentence))) return 'partial'
  const rest = sentences.filter((sentence) => !isDeferral(sentence)).join(' ')
  const worked = (rest.match(WORKED_SYMBOL) ?? []).length
  return worked >= 2 && rest.replace(/\s+/g, '').length >= 30 ? 'partial' : 'full'
}

/** Lines that are a running page header with its page number ("Problem Set 4 9"). */
const PAGE_HEADER_LINE =
  /^\s*(?:problem\s+set|homework|assignment|hw|exercise\s+sheet|exercises|solutions?|tutorial|worksheet|作业|习题|答案)\b[^\n]{0,40}?\s\d{1,3}\s*$|^\s*page\s+\d{1,3}(?:\s+of\s+\d{1,3})?\s*$|^\s*第\s*\d{1,3}\s*页(?:\s*[/／共]\s*\d{1,3}\s*页?)?\s*$/i

/**
 * Clean PDF-extraction artifacts from a professor answer before it is sent to
 * a model: running page headers inside a solution ("Problem Set 4 9"), the
 * combining vector arrow (U+20D7) detached from its letter (`,⃗ v₂`, `⃗v₂`)
 * and the blank lines left where bracket glyphs of a big matrix were dropped.
 * The stored answer is never changed (it stays the student-checked evidence).
 */
export function cleanProfessorAnswerText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => !PAGE_HEADER_LINE.test(line))
      .join('\n')
      // A detached arrow belongs to the letter after it; write every vector
      // as `vec(v)` so its subscript stays attached.
      .replace(
        /⃗[ \t]*([A-Za-z])([₀-₉]*)|([A-Za-z])⃗([₀-₉]*)/g,
        (
          _match,
          after: string | undefined,
          afterSub: string | undefined,
          before: string | undefined,
          beforeSub: string | undefined,
          offset: number,
          whole: string,
        ) => {
          const space = /[A-Za-z]/.test(whole[offset - 1] ?? '') ? ' ' : ''
          return `${space}vec(${after ?? before})${(after ? afterSub : beforeSub) ?? ''}`
        },
      )
      .replace(/⃗/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Minimal chunk shape the parser needs; extra fields are ignored. */
export interface AnswerSourceChunk {
  id: string
  text: string
  pageNumber?: number
}

/** One extracted line of the answer document, with its real provenance. */
export interface AnswerLine {
  text: string
  chunkId: string
  pageNumber?: number
}

export type AnswerAssignmentStatus = 'matched' | 'needs_review' | 'none'

export type AnswerMatchReason =
  | 'number-unique'
  | 'answer-number-duplicate'
  | 'question-number-duplicate'
  | 'question-number-missing'
  | 'answer-number-missing'
  | 'no-answers'

export interface AnswerAssignment {
  questionId: string
  /** Index into the parsed entries, when a candidate exists. */
  answerIndex?: number
  status: AnswerAssignmentStatus
  reason: AnswerMatchReason
}

export interface AnswerMatchResult {
  assignments: AnswerAssignment[]
  /** Entry indices not used by any auto-confirmed assignment. */
  unmatchedAnswers: number[]
}

/**
 * Numbering styles real answer sheets use.
 *
 *  - Explicit labels: `Problem 1`, `Solution 2:`, `Answer 3.`, `Question 4`,
 *    `Sol 5`, `Q6`, `Ex 7`, `Prob 8`, `Ans 9`.
 *  - Bare numbers: `1.`, `1)`, `1、`, `1:`, optionally `#1`.
 *
 * A full-word label must be followed by a separator (`: . 、 - – —`) or the end
 * of the line, so a prose line that merely starts with the word "Question 2 …"
 * is not torn into a new answer. Short abbreviations may be followed directly
 * by their body. A bare number is only a marker when it is followed by a real
 * separator — `.` must have whitespace (or end of line) after it, so decimals
 * such as `2.5` and section numbers such as `1.1` are never split.
 *
 * Labels are split into two families: answer-style (`Solution`/`Answer`) and
 * question-style (`Problem`/`Question`/`Exercise`/`Q`). When a sheet repeats
 * both (a `Problem N` heading followed by its `Solution N`), the answer family
 * wins, so the printed number is not counted twice. Explicit labels always win
 * over bare numbers, so numbered steps inside a labelled answer are not torn
 * out.
 */
/**
 * A printed problem number: `3`, or a dotted chapter number `2.1` / `2.1.4`
 * (end-of-chapter "Problem 2.1", "Advanced Problem 3.2").
 */
// Never a prefix of a longer number: "2.1" must not be read as "2" + ".1".
const NUMBER = String.raw`(\d{1,3}(?:\.\d{1,3}){0,2})(?!\.?\d)`
/** Qualifiers printed before a problem label: "Advanced Problem 2.1", "Practice Exercise 4". */
const LABEL_QUALIFIER = String.raw`(?:(?:advanced|practice|review|sample|additional|challenge|bonus|extra|homework|supplementary|end[- ]of[- ]chapter)\s+)?`
const ANSWER_LABEL = new RegExp(
  String.raw`^\s*${LABEL_QUALIFIER}(?:solution|answer)\b[\s.#:：-]*${NUMBER}\s*[)）]?\s*(?:[:：.、–—-]\s*(.*))?$`,
  'i',
)
const QUESTION_LABEL = new RegExp(
  String.raw`^\s*${LABEL_QUALIFIER}(?:problem|exercise|question)\b[\s.#:：-]*${NUMBER}\s*[)）]?\s*(?:[:：.、–—-]\s*(.*))?$`,
  'i',
)
const ANSWER_ABBREV = new RegExp(
  String.raw`^\s*(?:sol|ans)\.?\s*[#＃]?\s*${NUMBER}\s*[)）]?\s*(?:[\s:：.、–—-]\s*(.*))?$`,
  'i',
)
const QUESTION_ABBREV = new RegExp(
  String.raw`^\s*(?:q|ex|prob)\.?\s*[#＃]?\s*${NUMBER}\s*[)）]?\s*(?:[\s:：.、–—-]\s*(.*))?$`,
  'i',
)
const BARE_LABEL = /^\s*[#＃]?(\d{1,3}(?:\.\d{1,3}){0,2})(?:\s*[)、:：]|\s*[.](?=\s|$))\s*(.*)$/

/** A label word in front of a question / answer number (`Problem 2.1`, `Q3`, `Sol. 4`). */
const NUMBER_PREFIX = new RegExp(
  String.raw`^${LABEL_QUALIFIER}(?:problem|exercise|question|solution|answer|prob|sol|ans|ex|q)\.?\s*[#＃]?\s*(?=\d)`,
  'i',
)

/** The line ends inside an expression: an operator, an opening bracket or a comma. */
const OPEN_EXPRESSION_END = /[=+\-−×*/^([{,·÷]\s*$/

/**
 * A bare number at a line start that is really the tail of the previous line's
 * mathematics — a superscript `2` from `m/s²` pushed onto the next line
 * (`(0.90321 m/s` / `2)(20 s) = 18.064 m/s`) — and not an answer label.
 */
function continuesExpression(previous: string | undefined, line: string): boolean {
  if (previous !== undefined) {
    if (OPEN_EXPRESSION_END.test(previous)) return true
    const opened = (previous.match(/\(/g) ?? []).length
    const closed = (previous.match(/\)/g) ?? []).length
    if (opened > closed) return true
  }
  // `2)(20 s)`: a ")" label glued to an expression is a closing bracket.
  return /^\s*[#＃]?\d{1,3}(?:\.\d{1,3})*\s*[)）][(（=+\-−×*/^²³]/.test(line)
}

export type AnswerLabelFamily = 'answer' | 'question'

export interface AnswerMarker {
  number: string
  /** Text on the marker line after the number (may be empty). */
  rest: string
  family: AnswerLabelFamily
}

interface Marker {
  number: string
  /** Text on the marker line after the number (may be empty). */
  rest: string
}

/** Match a labelled answer start (`Problem 1`, `Q2`, `Sol 3`…) and its family. */
export function matchAnswerLabel(line: string): AnswerMarker | null {
  const answer = ANSWER_LABEL.exec(line) ?? ANSWER_ABBREV.exec(line)
  if (answer) {
    return { number: answer[1]!, rest: (answer[2] ?? '').trim(), family: 'answer' }
  }
  const question = QUESTION_LABEL.exec(line) ?? QUESTION_ABBREV.exec(line)
  if (question) {
    return { number: question[1]!, rest: (question[2] ?? '').trim(), family: 'question' }
  }
  return null
}

/** Match a bare numbered answer start (`1.`, `2)`, `3、`). */
export function matchBareAnswerLabel(line: string): Marker | null {
  const bare = BARE_LABEL.exec(line)
  if (!bare) return null
  const rest = (bare[2] ?? '').trim()
  return { number: bare[1]!, rest }
}

/** Canonical form of a printed number: digits lose leading zeros, text is lowercased. */
export function normalizeAnswerNumber(raw: string): string {
  let trimmed = raw
    .trim()
    .replace(/[.、)）:：\s]+$/, '')
    .replace(NUMBER_PREFIX, '')
  // 第3题 / 第 3 題 → 3
  const cjk = /^第\s*(\d{1,3})\s*[题題]$/.exec(trimmed)
  if (cjk) trimmed = cjk[1]!
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed))
  // Dotted numbers keep every part; only the leading part loses zeros (02.1 → 2.1).
  if (/^\d+(?:\.\d+)+$/.test(trimmed)) {
    const [head, ...rest] = trimmed.split('.')
    return [String(Number(head)), ...rest].join('.')
  }
  return trimmed.toLowerCase()
}

function uniqueInOrder(values: Array<string | number | undefined>): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const value of values) {
    if (typeof value !== 'number' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * Flatten the answer document's real chunks into source lines, preserving the
 * chunk id (and page) each line came from. Used both by the parser and by the
 * manual-division editor, which needs per-line provenance.
 */
export function buildAnswerLines(chunks: ReadonlyArray<AnswerSourceChunk>): AnswerLine[] {
  const lines: AnswerLine[] = []
  for (const chunk of chunks) {
    const raw = (chunk.text ?? '').replace(/\r\n?/g, '\n').split('\n')
    for (const line of raw) {
      const text = line.trim()
      if (!text) continue
      lines.push({
        text,
        chunkId: chunk.id,
        ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
      })
    }
  }
  return lines
}

/**
 * Build one entry from a run of source lines. When `marker` is given, the
 * marker line's label is replaced by its body text (so the printed label is
 * not duplicated); otherwise every line is body.
 */
function entryFromLines(
  lines: readonly AnswerLine[],
  marker: Marker | undefined,
): AnswerEntry | null {
  if (lines.length === 0) return null
  const body = marker
    ? [marker.rest, ...lines.slice(1).map((line) => line.text)].filter(Boolean)
    : lines.map((line) => line.text)
  const text = body.join('\n').trim()
  if (!text) return null
  return {
    ...(marker ? { number: normalizeAnswerNumber(marker.number) } : {}),
    text,
    chunkIds: [...new Set(lines.map((line) => line.chunkId))],
    pageNumbers: uniqueInOrder(lines.map((line) => line.pageNumber)),
  }
}

/**
 * Parse answer entries from the answer document's real chunks, in order.
 *
 * A marker line starts a new entry; the following lines belong to it. All the
 * entries come from real chunks, so provenance is never invented. When the
 * document has no recognisable numbering at all, the whole text becomes a
 * single unnumbered entry so the student can still assign or divide it
 * manually — the caller can detect that with `isSingleUnnumberedEntry`.
 */
export function parseAnswerEntries(chunks: ReadonlyArray<AnswerSourceChunk>): AnswerEntry[] {
  const lines = buildAnswerLines(chunks)
  if (lines.length === 0) return []
  const header = runningHeaderLines(lines)
  // "Problem 2 (continued)": more of an answer that started earlier.
  const continuations = new Map<number, string>()

  const answerFamily: number[] = []
  const questionFamily: number[] = []
  const bare: number[] = []
  const usedBare = new Set<string>()
  let latestBare: string | undefined
  const lastLabel: Record<AnswerLabelFamily, string | undefined> = {
    answer: undefined,
    question: undefined,
  }
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text
    // A running page header ("Problem 2" printed on top of every page) is no label.
    if (header.has(i)) continue
    const continued = matchContinuationLabel(text)
    if (continued) {
      continuations.set(i, normalizeAnswerNumber(continued.number))
      continue
    }
    const label = matchAnswerLabel(text)
    if (label) {
      const number = normalizeAnswerNumber(label.number)
      // "Problem 3 … Problem 3 (cont.)": a repeat of the same label continues it.
      if (lastLabel[label.family] === number) continue
      lastLabel[label.family] = number
      if (label.family === 'answer') answerFamily.push(i)
      else questionFamily.push(i)
      continue
    }
    const bareLabel = matchBareAnswerLabel(text)
    if (!bareLabel) continue
    // A bare number that continues the previous line's maths, or that repeats
    // a number already used (out of sequence), is body text, not a label.
    if (continuesExpression(lines[i - 1]?.text, text)) continue
    const number = normalizeAnswerNumber(bareLabel.number)
    // A repeat of the latest label is kept (a real duplicate the student must
    // review); a repeat of an earlier one, out of sequence, is not a label.
    if (usedBare.has(number) && number !== latestBare) continue
    usedBare.add(number)
    latestBare = number
    bare.push(i)
  }
  // Answer labels win over question labels (a `Problem N` heading followed by
  // its `Solution N` must not double-count), and explicit labels win over bare
  // numbers (numbered steps inside a labelled answer must not be torn out).
  const usingAnswerFamily = answerFamily.length > 0
  const familyMarkers = usingAnswerFamily
    ? answerFamily
    : questionFamily.length > 0
      ? questionFamily
      : bare
  const markers = [...familyMarkers, ...continuations.keys()].sort((a, b) => a - b)
  const questionMarkers = new Set(questionFamily)

  if (markers.length === 0) {
    const entry = entryFromLines(lines, undefined)
    return entry ? [entry] : []
  }

  const entries: AnswerEntry[] = []
  // Lines before the first marker are kept as one unnumbered entry rather than
  // silently dropped.
  if (markers[0]! > 0) {
    const preface = entryFromLines(lines.slice(0, markers[0]!), undefined)
    if (preface) entries.push(preface)
  }
  for (let m = 0; m < markers.length; m++) {
    const start = markers[m]!
    let end = m + 1 < markers.length ? markers[m + 1]! : lines.length
    // When solutions are labelled but each is preceded by its own `Problem N`
    // heading, trim that trailing problem statement off the answer it follows.
    if (usingAnswerFamily) {
      for (let q = start + 1; q < end; q++) {
        if (questionMarkers.has(q)) {
          end = q
          break
        }
      }
    }
    const text = lines[start]!.text
    const continuedNumber = continuations.get(start)
    if (continuedNumber !== undefined) {
      const continued = matchContinuationLabel(text)!
      const more = entryFromLines(lines.slice(start, end), continued)
      const earlier = entries.find((entry) => entry.number === continuedNumber)
      if (more && earlier) {
        earlier.text = `${earlier.text}
${more.text}`.trim()
        earlier.chunkIds = [...new Set([...earlier.chunkIds, ...more.chunkIds])]
        earlier.pageNumbers = uniqueInOrder([
          ...(earlier.pageNumbers ?? []),
          ...(more.pageNumbers ?? []),
        ])
      } else if (more) entries.push(more)
      continue
    }
    const marker = matchAnswerLabel(text) ?? matchBareAnswerLabel(text)
    const entry = entryFromLines(lines.slice(start, end), marker ?? undefined)
    if (entry) entries.push(entry)
  }
  return entries
}

const CONTINUATION_LABEL = new RegExp(
  String.raw`^\s*${LABEL_QUALIFIER}(?:problem|exercise|question|solution|answer|prob|sol|ans|q)\.?\s*[#＃]?\s*${NUMBER}\s*[(（[]?\s*(?:cont(?:inued|['’]d|\.)?(?![a-z])|continuation|ctd\.?|续(?:上页)?)\s*[)）\]]?\s*[:：.、–—-]?\s*(.*)$`,
  'i',
)

/** `Problem 2 (continued)`, `Solution 3 cont'd:`, `Q4（续）` → the number it continues. */
export function matchContinuationLabel(line: string): Marker | null {
  const match = CONTINUATION_LABEL.exec(line)
  return match ? { number: match[1]!, rest: (match[2] ?? '').trim() } : null
}

/**
 * Label lines that are a running page header: the same text as the first or
 * last line of at least two different pages (e.g. "Problem 2" printed on top
 * of every page of a long answer). Such a line is never an answer start.
 */
function runningHeaderLines(lines: readonly AnswerLine[]): Set<number> {
  const edges = new Map<string, { pages: Set<number>; indices: number[] }>()
  lines.forEach((line, index) => {
    if (line.pageNumber === undefined) return
    const first = index === 0 || lines[index - 1]!.pageNumber !== line.pageNumber
    const last = index === lines.length - 1 || lines[index + 1]!.pageNumber !== line.pageNumber
    if (!first && !last) return
    if (!matchAnswerLabel(line.text) && !matchBareAnswerLabel(line.text)) return
    const key = line.text.replace(/\s+/g, ' ').trim().toLowerCase()
    const slot = edges.get(key) ?? { pages: new Set<number>(), indices: [] }
    slot.pages.add(line.pageNumber)
    slot.indices.push(index)
    edges.set(key, slot)
  })
  const out = new Set<number>()
  for (const slot of edges.values()) {
    if (slot.pages.size < 2) continue
    // Keep the first one: it is where that answer starts.
    for (const index of slot.indices.slice(1)) out.add(index)
  }
  return out
}

/** True when parsing produced a single, unnumbered fragment (the hard case). */
export function isSingleUnnumberedEntry(entries: readonly AnswerEntry[]): boolean {
  return entries.length === 1 && entries[0]!.number === undefined
}

/**
 * Build entries from a student-defined division of the extracted lines.
 *
 * `starts` is the sorted, unique list of line indices that begin an answer;
 * the first must be `0`. Each entry keeps only the real chunks/pages its lines
 * came from, so a manual split can never fabricate provenance. `numbers` maps a
 * start index to the number the student typed for it (optional).
 */
export function segmentsToAnswerEntries(
  lines: readonly AnswerLine[],
  starts: readonly number[],
  numbers: Readonly<Record<number, string>> = {},
): AnswerEntry[] {
  const sorted = [...new Set(starts)]
    .filter((i) => i >= 0 && i < lines.length)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const entries: AnswerEntry[] = []
  for (let s = 0; s < sorted.length; s++) {
    const start = sorted[s]!
    const end = s + 1 < sorted.length ? sorted[s + 1]! : lines.length
    const slice = lines.slice(start, end)
    const text = slice
      .map((line) => line.text)
      .join('\n')
      .trim()
    if (!text) continue
    const rawNumber = (numbers[start] ?? '').trim()
    entries.push({
      ...(rawNumber ? { number: normalizeAnswerNumber(rawNumber) } : {}),
      text,
      chunkIds: [...new Set(slice.map((line) => line.chunkId))],
      pageNumbers: uniqueInOrder(slice.map((line) => line.pageNumber)),
    })
  }
  return entries
}

/** Shape-only diagnostics for one parse result — never includes answer text. */
export interface AnswerParseSummary {
  total: number
  numbered: number
  unnumbered: number
  /** True when the file collapsed to one unnumbered fragment. */
  unsplit: boolean
}

export function summarizeAnswerEntries(entries: readonly AnswerEntry[]): AnswerParseSummary {
  const numbered = entries.filter((entry) => entry.number !== undefined).length
  return {
    total: entries.length,
    numbered,
    unnumbered: entries.length - numbered,
    unsplit: isSingleUnnumberedEntry(entries),
  }
}

/** Upper bound on the total text a manual division may store. */
export const MAX_STORED_ANSWER_CHARS = 20000

/**
 * Re-validate student-defined entries against the answer document's real
 * chunks. Chunk ids that no longer exist are dropped, page numbers are
 * recomputed from the chunks (never trusted from storage), and empty entries
 * are discarded. Returns `null` when nothing usable remains.
 */
export function revalidateStoredEntries(
  entries: readonly AnswerEntry[] | undefined,
  chunks: ReadonlyArray<AnswerSourceChunk>,
): AnswerEntry[] | null {
  if (!entries || entries.length === 0) return null
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const valid: AnswerEntry[] = []
  for (const entry of entries) {
    const text = (entry.text ?? '').trim()
    if (!text) continue
    const realChunks = [...new Set(entry.chunkIds ?? [])]
      .map((id) => byId.get(id))
      .filter((chunk): chunk is AnswerSourceChunk => Boolean(chunk))
    if (realChunks.length === 0) continue
    const rawNumber = (entry.number ?? '').trim()
    valid.push({
      ...(rawNumber ? { number: normalizeAnswerNumber(rawNumber) } : {}),
      text,
      chunkIds: realChunks.map((chunk) => chunk.id),
      pageNumbers: uniqueInOrder(realChunks.map((chunk) => chunk.pageNumber)),
    })
  }
  return valid.length > 0 ? valid : null
}

/**
 * Match questions to answer entries.
 *
 * Only a unique number on both sides yields `matched`. Everything else is
 * `needs_review` (a candidate exists but must be confirmed) or `none` (no
 * candidate at all). No positional or fuzzy matching is performed.
 */
export function matchAnswersToQuestions(
  questions: ReadonlyArray<{ id: string; number?: string }>,
  entries: readonly AnswerEntry[],
): AnswerMatchResult {
  const assignments: AnswerAssignment[] = []

  if (entries.length === 0) {
    return {
      assignments: questions.map((question) => ({
        questionId: question.id,
        status: 'none',
        reason: 'no-answers',
      })),
      unmatchedAnswers: [],
    }
  }

  const answersByNumber = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    if (!entry.number) return
    const list = answersByNumber.get(entry.number) ?? []
    list.push(index)
    answersByNumber.set(entry.number, list)
  })

  const questionsByNumber = new Map<string, string[]>()
  for (const question of questions) {
    if (!question.number) continue
    const key = normalizeAnswerNumber(question.number)
    const list = questionsByNumber.get(key) ?? []
    list.push(question.id)
    questionsByNumber.set(key, list)
  }

  const used = new Set<number>()
  for (const question of questions) {
    if (!question.number) {
      assignments.push({
        questionId: question.id,
        status: 'needs_review',
        reason: 'question-number-missing',
      })
      continue
    }
    const key = normalizeAnswerNumber(question.number)
    const answerIndices = answersByNumber.get(key) ?? []
    const questionIds = questionsByNumber.get(key) ?? []

    if (answerIndices.length === 0) {
      assignments.push({ questionId: question.id, status: 'none', reason: 'answer-number-missing' })
    } else if (answerIndices.length > 1) {
      assignments.push({
        questionId: question.id,
        status: 'needs_review',
        reason: 'answer-number-duplicate',
      })
    } else if (questionIds.length > 1) {
      assignments.push({
        questionId: question.id,
        status: 'needs_review',
        reason: 'question-number-duplicate',
      })
    } else {
      const answerIndex = answerIndices[0]!
      used.add(answerIndex)
      assignments.push({
        questionId: question.id,
        answerIndex,
        status: 'matched',
        reason: 'number-unique',
      })
    }
  }

  const unmatchedAnswers = entries.map((_, index) => index).filter((index) => !used.has(index))
  return { assignments, unmatchedAnswers }
}
