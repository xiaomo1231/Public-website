import { fnv1a } from '@/shared/lib/hash'
import { normalizeEvidenceText } from '@/entities/questionHabits/types'
import { cleanProfessorAnswerText, professorAnswerDeferral } from './answerMatching'
import { answerSubparts } from './splitQuestion'
import type { HomeworkQuestion } from './types'
import type { ProfessorMapPromptEntry } from '@/infrastructure/ai/prompts/professor-answer-map/v1'

/**
 * 小题 ⇄ 教授答案对应 (sub-part ↔ professor-excerpt map): a general
 * alignment of one problem's answer-key text with the question's sub-parts.
 *
 * Answer keys do not follow the question's headings reliably: a solution is
 * written under another sub-part's heading, one block answers several
 * sub-parts ("(a) and (b): …", "(c)–(e)"), sub-parts come out of order, the
 * key numbers what the question letters ("1. 2." / "i) ii)" / "Part A" / ①
 * / 第(1)问 for (a)(b)), a part says "same as part (x)" (sometimes naming a
 * part that does not exist), a part is left to the student, the key gives
 * final answers only, or one unlabelled solution follows a restated
 * question. Prompt rules alone ("map by meaning") were not enough for real
 * models, so the mapping is explicit and checkable:
 *
 *  1. `segmentProfessorAnswer` (local, generic and conservative) only cuts
 *     the cleaned key into candidate segments and records what the text
 *     itself says: the labels a segment carries (translated to the
 *     question's labels by value, or by position when the key uses another
 *     numbering), the heading it sits under, explicit "Method 2" markers,
 *     references to other parts, deferrals, restated question lines.
 *  2. `localProfessorMap` is the deterministic fallback: a sub-part with
 *     worked segments carrying its label is `direct`, one the key defers is
 *     `none`; everything else stays unsure (never an asserted `none`).
 *  3. One small AI request (`professor-answer-map/v1`) decides by content:
 *     `direct` / `indirect` / `none` with verbatim excerpts.
 *     `validateProfessorMap` keeps only excerpts that occur in the key and
 *     labels of the question, sets `direct` / `indirect` from where the
 *     excerpts actually are, restores a labelled solution the reply called
 *     `none`, and gives every sub-part a confidence with reasons; low ones
 *     are shown as 「请确认」.
 *  4. The student's choice per sub-part (`ProfessorMapEdits`) always wins.
 *
 * Everything is cached on the question by (answer hash, question hash, prompt
 * version) — optional fields, no Dexie bump.
 */

export type ProfessorCoverage = 'direct' | 'indirect' | 'none'

export const PROFESSOR_COVERAGES: readonly ProfessorCoverage[] = ['direct', 'indirect', 'none']

/** Why a sub-part's mapping is worth a look (shown in the dialog). */
export type MapFlag =
  /** Written under another sub-part's heading. */
  | 'misplaced'
  /** One block answers this and other sub-parts. */
  | 'shared'
  /** Established by content written for another sub-part. */
  | 'indirect'
  /** Says "same as part (x)" / "similar to …" instead of working it out. */
  | 'reference'
  /** Refers to a part the question does not have (likely a typo). */
  | 'bad-reference'
  /** Left to the student / not graded / see textbook. */
  | 'deferred'
  /** The AI's coverage was changed by the local check. */
  | 'corrected'
  /** Some AI excerpts were not found in the key and dropped. */
  | 'quotes-dropped'
  /** No checked excerpt / no own segment — nobody has located it. */
  | 'unlocated'
  /** The AI and the key's own labels disagree. */
  | 'conflict'
  /** Solved more than once (several ways). */
  | 'several-ways'

/** One candidate piece of the key, cut at the key's own labels. */
export interface ProfessorSegment {
  /** `s1`, `s2`, … in order. */
  id: string
  /** The question sub-parts it is labelled for (empty = unlabelled / general). */
  labels: string[]
  /** The key's own label text, when it differs from the question's (`1.`, `ii)`, `Part A`). */
  keyLabel?: string
  /** A label of the key that is no sub-part of the question (`(f)` for (a)–(e)). */
  extraLabel?: string
  /** Written under another sub-part's heading (a misplaced solution). */
  nestedUnder?: string
  /** An explicitly named way ("Method 2:", 方法二). */
  method?: number
  /** Sub-parts it refers to ("same as part (c)"). */
  refersTo?: string[]
  /** Referred labels that are no sub-part of the question ("same as part (f)"). */
  badRefs?: string[]
  /** Sub-parts this segment leaves to the student. */
  defers?: string[]
  /** Verbatim lines of the cleaned key (restated question lines at the start left out). */
  text: string
  /** Only the restated question, no worked content. */
  restatedOnly?: boolean
}

/** Where an excerpt sits in the key. */
export interface ProfessorMapSource {
  /** The labels of that segment (empty: general solution). */
  labels: string[]
  nestedUnder?: string
  method?: number
}

export interface ProfessorMapEntry {
  /** A sub-part label of the question (`a`, `l`, `1`). */
  label: string
  coverage: ProfessorCoverage
  /** Verbatim excerpts of the cleaned key (` … ` joins pieces in order). */
  quotes: string[]
  /** Where the first excerpt is (「写在 (b) 的解答下面」 / 「来自 (b)」). */
  from?: ProfessorMapSource
  note?: string
  /** `low` ⇒ 「请确认」 in the dialog. Absent on old rows: treated as high. */
  confidence?: 'high' | 'low'
  flags?: MapFlag[]
}

/** The AI map, cached on the question. */
export interface ProfessorAnswerMap {
  answerHash: string
  questionHash: string
  /** `professor-answer-map/v1`. */
  promptVersion: string
  entries: ProfessorMapEntry[]
  createdAt: number
}

/** The student's change to (or confirmation of) one sub-part's mapping. */
export interface ProfessorMapEdit {
  label: string
  coverage: ProfessorCoverage
  quotes: string[]
  updatedAt: number
}

export interface ProfessorMapEdits {
  answerHash: string
  questionHash: string
  entries: ProfessorMapEdit[]
}

export function mapAnswerHash(answer: string): string {
  // Same as `professorAnswerHash` (professorCompare.ts).
  return fnv1a(answer.trim())
}

export function mapQuestionHash(prompt: string): string {
  return fnv1a(prompt.trim())
}

/** The question's sub-parts a map is made for (≥2, else none). */
export function mapSubparts(prompt: string): Array<{ label: string; text: string }> {
  return answerSubparts(prompt)
}

/**
 * The matched professor answer a map can be made for: matched, not empty, not
 * entirely left to the student, and a question with sub-parts.
 */
export function mappableAnswer(question: HomeworkQuestion): string | undefined {
  if (question.answerStatus !== 'matched') return undefined
  const answer = question.answerText ?? ''
  if (!answer.trim() || professorAnswerDeferral(answer) === 'full') return undefined
  return mapSubparts(question.prompt).length >= 2 ? answer : undefined
}

// --- Quotes -------------------------------------------------------------------

const ELLIPSIS = /\s*(?:…|\.\.\.)\s*/

/** Shortest quote (normalised) that counts as evidence. */
const MIN_QUOTE = 8

/**
 * True when `quote` occurs in `source` after normalisation (NFKC, case,
 * quotes / dashes, whitespace). ` … ` may join pieces that occur in order.
 */
export function quoteInAnswer(quote: string, source: string): boolean {
  const pieces = quote
    .split(ELLIPSIS)
    .map(normalizeEvidenceText)
    .filter((piece) => piece.length > 0)
  if (pieces.length === 0 || pieces.join(' ').length < MIN_QUOTE) return false
  const haystack = normalizeEvidenceText(source)
  let from = 0
  for (const piece of pieces) {
    if (piece.length < 3) continue
    const at = haystack.indexOf(piece, from)
    if (at < 0) return false
    from = at + piece.length
  }
  return true
}

/** A long excerpt as `start … end` (both verbatim), for prompts and display. */
export function clipQuote(text: string, max = 400): string {
  const flat = text.trim()
  if (flat.length <= max) return flat
  const head = flat.slice(0, Math.floor(max * 0.55)).replace(/\s+\S*$/, '')
  const tail = flat.slice(flat.length - Math.floor(max * 0.35)).replace(/^\S*\s+/, '')
  return `${head} … ${tail}`
}

// --- Labels -------------------------------------------------------------------

type LabelSystem = 'letter' | 'roman' | 'number' | 'upper'

interface LabelToken {
  system: LabelSystem
  /** `a`, `ii`, `3`, `A`. */
  value: string
  /** 1-based position in its system. */
  ordinal: number
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const ZH_NUMERAL = '一二三四五六七八九十'

function token(raw: string, romanKey: boolean): LabelToken | null {
  const text = raw.normalize('NFKC').trim()
  if (/^\d{1,2}$/.test(text)) return { system: 'number', value: text, ordinal: Number(text) }
  const circled = CIRCLED.indexOf(text)
  if (circled >= 0) return { system: 'number', value: String(circled + 1), ordinal: circled + 1 }
  const zh = ZH_NUMERAL.indexOf(text)
  if (zh >= 0) return { system: 'number', value: String(zh + 1), ordinal: zh + 1 }
  if (/^[ivx]{1,4}$/.test(text) && (romanKey || text.length > 1) && ROMAN.includes(text))
    return { system: 'roman', value: text, ordinal: ROMAN.indexOf(text) + 1 }
  if (/^[a-z]$/.test(text))
    return { system: 'letter', value: text, ordinal: text.charCodeAt(0) - 96 }
  if (/^[A-Z]$/.test(text))
    return { system: 'upper', value: text, ordinal: text.charCodeAt(0) - 64 }
  return null
}

const LABEL_CORE = String.raw`(?:[a-z]|[ivx]{2,4}|[A-Z]|\d{1,2}|[①-⑳])`
/** A label at the start of a line, in the usual forms. */
const LEADING_LABEL = new RegExp(
  String.raw`^\s*(?:` +
    // Part A / Part (a) / Part 1 / part ii
    String.raw`part\s*[(（]?\s*(${LABEL_CORE})\s*[)）]?(?=[\s.:：)]|$)[.:：]?` +
    // 第(1)问 / 第1小题 / 第一问
    String.raw`|第\s*[(（]?\s*(\d{1,2}|[一二三四五六七八九十])\s*[)）]?\s*(?:问|小题|题|部分)[:：.]?` +
    // (a) （a） (ii) (1) (A)
    String.raw`|[(（]\s*(${LABEL_CORE})\s*[)）]` +
    // a) ii) 1) 1. a. A.  (followed by a space or the end)
    String.raw`|(${LABEL_CORE})\s*[).．、](?=\s|$)` +
    // ①
    String.raw`|([①-⑳])` +
    String.raw`)[ \t]*`,
  'i',
)

/** Further labels later in the same line ("(a) 3 (b) 5", "(a) and (b):"). */
const INLINE_LABEL = new RegExp(
  String.raw`(?<=^|[\s,;，；、–—~～-])(?:[(（]\s*(${LABEL_CORE})\s*[)）]|([①-⑳]))`,
  'g',
)

/** Text that ends by pointing at a label ("same as part", "see", "in", 同, 见). */
const REFERRING_TAIL =
  /(?:\b(?:part|parts|see|cf\.?|as|in|from|of|to|by|with|using|like|than|problem|question|exercise)|[同见与由和及]|参见)\s*$/i

/** Text between two labels that joins them into one heading. */
const JOINER = /^\s*(?:and|&|,|，|、|和|及|与|or|plus)\s*$/i
const RANGE = /^\s*(?:to|through|thru|[-–—~～]|至|到)\s*$/i

/** "same as part (c)", "similar to (b)", "see (a)", "同 (a)", "与第(1)问相同". */
const REFERENCE =
  /\b(?:same\s+as|similar(?:ly)?\s+to|as\s+in|analogous(?:ly)?\s+to|identical\s+to|follows\s+from|see|cf\.?|like)\s+(?:in\s+)?(?:part\s*|problem\s+\d+\s*)?[(（]\s*([a-z]|\d{1,2}|[ivx]{2,4})\s*[)）]|\b(?:same\s+as|similar(?:ly)?\s+to|as\s+in|see)\s+part\s+([a-z]|\d{1,2})\b|(?:同|与|见|参见|类似于?)\s*(?:第\s*)?[(（]\s*([a-z]|\d{1,2})\s*[)）]/gi

/** The key leaves something to the student. */
const DEFERRAL =
  /left\s+(?:to|for)\s+(?:you|the\s+(?:reader|student))|leave\b[^.;!?\n]{0,40}?\b(?:to|for)\s+(?:you|the\s+(?:reader|student))|(?:left|assigned)\s+(?:as|for)\s+(?:an?\s+|the\s+)?exercises?|(?:is|as)\s+an\s+exercise|exercise\s+(?:for|to)\s+(?:the\s+)?(?:reader|student)|try\s+(?:it|this)\s+(?:yourself|on\s+your\s+own)|(?:solution|answer|proof)\s+(?:is\s+)?omitted|no\s+(?:solution|answer)\s+(?:is\s+)?(?:provided|given)|see\s+(?:the\s+)?(?:textbook|lecture\s+notes|book)\b|(?:will\s+)?not\s+(?:be\s+)?graded|留给(?:你|学生|同学|读者)|请?(?:你|学生|同学|读者)?自行(?:完成|解答|求解|证明)|(?:答案|解答|解|证明|过程)略|不(?:计分|评分|提供(?:答案|解答))|见(?:教材|课本|讲义)/i

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
}

// --- Segmentation -------------------------------------------------------------

/** A line that starts an explicitly named way ("Method 2:", "Second way.", 方法二). */
const METHOD_MARKER =
  /^\s*(?:\*\*)?(?:(?:method|approach|way|proof)\s*(\d|one|two|three|iii|ii|i)\b|(first|second|third|alternative)\s+(?:method|way|approach|proof|solution)\b|(?:方法|证法|解法)\s*([一二三1-3]))/i

const METHOD_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  i: 1,
  ii: 2,
  iii: 3,
  first: 1,
  second: 2,
  third: 3,
  alternative: 2,
  一: 1,
  二: 2,
  三: 3,
}

function methodNumber(line: string): number | undefined {
  const match = METHOD_MARKER.exec(line)
  if (!match) return undefined
  const raw = (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase()
  return METHOD_NUMBER[raw] ?? (Number(raw) || undefined)
}

interface Draft {
  labels: string[]
  keyLabel?: string
  extraLabel?: string
  nestedUnder?: string
  method?: number
  lines: string[]
  /** Index of the first worked line; -1 while only restated lines were seen. */
  contentFrom: number
}

interface ParsedLabel {
  tokens: LabelToken[]
  /** How the tokens join: one heading for all, or separate pieces on one line. */
  joined: boolean
  /** Text after each token (pieces) / after the last one (joined). */
  rests: string[]
  /** Verbatim piece of the line per token (pieces) / the whole line (joined). */
  pieces: string[]
  raw: string
}

/**
 * The sub-part labels of a key line, translated to the question's labels.
 * The key's numbering is the question's when it uses the same kind (letters
 * for letters, numbers for numbers: by value); another kind (numbers, roman
 * numerals, capitals for a lettered question) is read by position, but only
 * when the key never uses the question's own kind and its labels run from
 * the first in order — so a numbered list of steps inside a solution is not
 * taken for sub-parts.
 */
function makeLabelReader(questionLabels: readonly string[], cleanedKey: string) {
  const questionSystem: LabelSystem =
    questionLabels.length > 0 && /^\d+$/.test(questionLabels[0]!) ? 'number' : 'letter'
  const romanKey = /(?:^|[\s(（])(?:ii|iii|iv)\s*[).．、）]/im.test(cleanedKey)
  const parse = (line: string): ParsedLabel | null => {
    const match = LEADING_LABEL.exec(line)
    if (!match) return null
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    if (!raw) return null
    // `a.` / `A.` at a line start is far more often a sentence ("A. Smith",
    // "a. The …") than a label unless the key uses that kind elsewhere too.
    const first = token(raw, romanKey)
    if (!first) return null
    const rest = line.slice(match[0].length)
    const tokens = [first]
    const rests: string[] = []
    let joined = false
    let cursor = 0
    let lastEnd = 0
    const starts = [0]
    INLINE_LABEL.lastIndex = 0
    for (const inline of rest.matchAll(INLINE_LABEL)) {
      const next = token(inline[1] ?? inline[2] ?? '', romanKey)
      const previous = tokens[tokens.length - 1]!
      if (!next || next.system !== previous.system || next.ordinal <= previous.ordinal) continue
      const between = rest.slice(lastEnd, inline.index)
      const isRange = RANGE.test(between)
      if (JOINER.test(between) || isRange) {
        if (isRange)
          for (let ordinal = previous.ordinal + 1; ordinal < next.ordinal; ordinal++)
            tokens.push(byOrdinal(next.system, ordinal))
        tokens.push(next)
        joined = true
        lastEnd = inline.index! + inline[0].length
        cursor = lastEnd
        continue
      }
      // A further label after some text: final answers on one line — only
      // the very next label, and never one the text refers to ("same as
      // part (f)", "see (b)", "from (a)").
      if (joined || between.trim().length === 0) break
      if (next.ordinal !== previous.ordinal + 1 || REFERRING_TAIL.test(between)) continue
      rests.push(rest.slice(cursor, inline.index).trim())
      starts.push(match[0].length + inline.index!)
      tokens.push(next)
      lastEnd = inline.index! + inline[0].length
      cursor = lastEnd
    }
    rests.push(rest.slice(cursor).trim())
    const pieces = joined
      ? [line]
      : starts.map((start, index) => line.slice(start, starts[index + 1] ?? line.length).trim())
    return { tokens, joined, rests, pieces, raw: match[0].trim() }
  }

  // Which kind of key label maps to the question, and how.
  const counts = new Map<LabelSystem, number[]>()
  for (const line of cleanedKey.split('\n')) {
    const parsed = parse(line)
    if (!parsed) continue
    for (const item of parsed.tokens) {
      const list = counts.get(item.system) ?? []
      list.push(item.ordinal)
      counts.set(item.system, list)
    }
  }
  const own = counts.get(questionSystem) ?? []
  let byPosition: LabelSystem | null = null
  if (own.length === 0) {
    for (const system of ['number', 'roman', 'upper', 'letter'] as const) {
      if (system === questionSystem) continue
      const list = counts.get(system) ?? []
      if (list.length >= 2 && list[0] === 1 && list.includes(2)) {
        byPosition = system
        break
      }
    }
  }

  // A key label just past the question's last one ("(f)" for (a)–(e)).
  const lastOrdinal = Math.max(
    0,
    ...questionLabels.map((label) =>
      /^\d+$/.test(label) ? Number(label) : label.charCodeAt(0) - 96,
    ),
  )
  const toQuestion = (item: LabelToken): { label?: string; extra?: string } => {
    if (item.system === questionSystem) {
      if (questionLabels.includes(item.value)) return { label: item.value }
      return item.ordinal <= lastOrdinal + 3 ? { extra: item.value } : {}
    }
    if (item.system === byPosition) {
      const label = questionLabels[item.ordinal - 1]
      return label ? { label } : { extra: item.value }
    }
    return {}
  }
  return { parse, toQuestion, questionSystem, byPosition }
}

function byOrdinal(system: LabelSystem, ordinal: number): LabelToken {
  const value =
    system === 'number'
      ? String(ordinal)
      : system === 'roman'
        ? (ROMAN[ordinal - 1] ?? String(ordinal))
        : system === 'upper'
          ? String.fromCharCode(64 + ordinal)
          : String.fromCharCode(96 + ordinal)
  return { system, value, ordinal }
}

/**
 * Cut the cleaned answer key into candidate segments at its own labels. Only
 * what the text itself says is recorded; nothing is decided about content.
 *
 *  - A label line that restates the question, or a label further on than
 *    the current heading, opens a heading. When the key restates the
 *    question as its headings, a label line that does not restate it and is
 *    not further on (`(a) This is true …` under the heading (b)) is that
 *    sub-part's solution written under the current heading (`nestedUnder`);
 *    in a key without restated headings it is simply an answer out of order.
 *  - "(a) and (b):" / "(c)–(e)" open one segment for several sub-parts;
 *    "(a) 3  (b) 5" on one line is one segment per sub-part.
 *  - "Method 2:" / 方法二 lines open a further way of the same sub-parts.
 *  - References ("same as part (c)") and deferrals ("left to you", "see the
 *    textbook", "not graded", 略) are noted on the segment.
 *  - A key that restates every sub-part and then gives one solution: that
 *    solution is a general segment (no labels).
 */
export function segmentProfessorAnswer(answer: string, question: string): ProfessorSegment[] {
  const labels = mapSubparts(question).map((part) => part.label)
  const cleaned = cleanProfessorAnswerText(answer)
  const reader = makeLabelReader(labels, cleaned)
  const questionNorm = normalizeEvidenceText(cleanProfessorAnswerText(question))
  const isQuestionLine = (line: string): boolean => {
    const norm = normalizeEvidenceText(line)
    return norm.length >= 8 && questionNorm.includes(norm)
  }
  // Before any worked line, a short line ("where", "and") the question also has is question text.
  const isQuestionText = (line: string): boolean => {
    const norm = normalizeEvidenceText(line)
    return norm.length > 0 && questionNorm.includes(norm)
  }

  const drafts: Draft[] = []
  let current: Draft = { labels: [], lines: [], contentFrom: -1 }
  let heading: string | null = null
  let restatingKey = false
  const open = (next: Draft): void => {
    if (current.lines.some((line) => line.trim())) drafts.push(current)
    current = next
  }
  const push = (line: string, worked: boolean): void => {
    if (worked && current.contentFrom < 0) current.contentFrom = current.lines.length
    current.lines.push(line)
  }
  const order = (label: string): number => labels.indexOf(label)

  for (const line of cleaned.split('\n')) {
    const parsed = reader.parse(line)
    const mapped = parsed?.tokens.map(reader.toQuestion) ?? []
    const known = mapped.flatMap((item) => (item.label ? [item.label] : []))
    const extra = mapped.find((item) => item.extra)?.extra
    if (parsed && (known.length > 0 || extra)) {
      const restated = isQuestionLine(line)
      if (restated) restatingKey = true
      const keyLabel = parsed.tokens[0]!.system !== reader.questionSystem ? parsed.raw : undefined
      if (!parsed.joined && parsed.tokens.length > 1) {
        // Final answers on one line: a segment per sub-part.
        mapped.forEach((item, index) => {
          if (!item.label) return
          open({
            labels: [item.label],
            ...(keyLabel ? { keyLabel } : {}),
            lines: [],
            contentFrom: -1,
          })
          heading = item.label
          push(parsed.pieces[index] ?? line, (parsed.rests[index] ?? '').length > 0)
        })
        continue
      }
      const lead = known[0]
      const further = lead !== undefined && (heading === null || order(lead) > order(heading))
      const worked = !restated && (parsed.rests[parsed.rests.length - 1] ?? '').length > 0
      if (restated || further || !restatingKey || lead === undefined) {
        if (lead !== undefined) heading = known[known.length - 1]!
        open({
          labels: known,
          ...(keyLabel ? { keyLabel } : {}),
          ...(extra && known.length === 0 ? { extraLabel: extra } : {}),
          lines: [],
          contentFrom: -1,
        })
      } else {
        open({
          labels: known,
          ...(keyLabel ? { keyLabel } : {}),
          ...(heading !== null && !known.includes(heading) ? { nestedUnder: heading } : {}),
          lines: [],
          contentFrom: -1,
        })
      }
      push(line, worked)
      continue
    }
    const method = current.labels.length > 0 ? methodNumber(line) : undefined
    if (method !== undefined) {
      if (current.contentFrom >= 0) {
        // Text already worked before "Method 2:" is the first way.
        if (current.method === undefined && method > 1) current.method = 1
        open({
          labels: current.labels,
          ...(current.keyLabel ? { keyLabel: current.keyLabel } : {}),
          ...(current.nestedUnder ? { nestedUnder: current.nestedUnder } : {}),
          method,
          lines: [],
          contentFrom: -1,
        })
      } else {
        // "Method 1:" right after the (restated) heading: the same segment.
        current.method = method
      }
      push(line, true)
      continue
    }
    push(line, line.trim().length > 0 && !(current.contentFrom < 0 && isQuestionText(line)))
  }
  open({ labels: [], lines: [], contentFrom: -1 })

  // A key that restates every sub-part and then gives one solution.
  const headings = drafts.filter(
    (draft) => draft.labels.length > 0 && !draft.nestedUnder && draft.method === undefined,
  )
  const firstWorked = drafts.findIndex((draft) => draft.contentFrom >= 0)
  const last = headings[headings.length - 1]
  if (
    labels.length >= 2 &&
    last &&
    last.labels.includes(labels[labels.length - 1]!) &&
    drafts[firstWorked] === last &&
    last.contentFrom > 0 &&
    headings.length >= 2
  ) {
    const index = drafts.indexOf(last)
    drafts.splice(
      index,
      1,
      { ...last, lines: last.lines.slice(0, last.contentFrom), contentFrom: -1 },
      { labels: [], lines: last.lines.slice(last.contentFrom), contentFrom: 0 },
    )
  }

  return drafts.map((draft, index) => {
    const worked = draft.contentFrom >= 0
    const lines = worked ? draft.lines.slice(draft.contentFrom) : draft.lines
    const text = lines.join('\n').trim()
    const notes = worked ? readNotes(text, draft.labels, labels, reader) : {}
    return {
      id: `s${index + 1}`,
      labels: draft.labels,
      ...(draft.keyLabel ? { keyLabel: draft.keyLabel } : {}),
      ...(draft.extraLabel ? { extraLabel: draft.extraLabel } : {}),
      ...(draft.nestedUnder ? { nestedUnder: draft.nestedUnder } : {}),
      ...(draft.method !== undefined ? { method: draft.method } : {}),
      ...notes,
      text,
      ...(worked ? {} : { restatedOnly: true }),
    }
  })
}

/** Worked content besides a deferral sentence: equations / implications. */
const WORKED = /[=⇒⟹≠≤≥]/g

/** References and deferrals a segment's own words state. */
function readNotes(
  text: string,
  own: readonly string[],
  labels: readonly string[],
  reader: ReturnType<typeof makeLabelReader>,
): Pick<ProfessorSegment, 'refersTo' | 'badRefs' | 'defers'> {
  const refersTo: string[] = []
  const badRefs: string[] = []
  for (const match of text.matchAll(REFERENCE)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    const item = token(raw, false)
    if (!item) continue
    const mapped = reader.toQuestion(item)
    if (mapped.label && !own.includes(mapped.label)) {
      if (!refersTo.includes(mapped.label)) refersTo.push(mapped.label)
    } else if (!mapped.label && item.system === reader.questionSystem) {
      if (!badRefs.includes(item.value)) badRefs.push(item.value)
    }
  }
  const defers: string[] = []
  const sentences = text.split(/(?<=[.!?。！？;；])\s+|\n/)
  const deferring = sentences.filter((sentence) => DEFERRAL.test(sentence))
  if (deferring.length > 0) {
    for (const sentence of deferring) {
      const named = namedParts(sentence, labels, reader)
      if (named.length > 0) {
        for (const label of named) if (!defers.includes(label)) defers.push(label)
      } else {
        // The whole segment is deferred only when nothing else is worked out.
        const rest = sentences.filter((other) => !DEFERRAL.test(other)).join(' ')
        const worked = (rest.match(WORKED) ?? []).length
        if (worked < 2) for (const label of own) if (!defers.includes(label)) defers.push(label)
      }
    }
  }
  return {
    ...(refersTo.length > 0 ? { refersTo } : {}),
    ...(badRefs.length > 0 ? { badRefs } : {}),
    ...(defers.length > 0 ? { defers } : {}),
  }
}

/** Sub-parts a sentence names: "(b)", "part 2", "the first part", 第(1)问. */
function namedParts(
  sentence: string,
  labels: readonly string[],
  reader: ReturnType<typeof makeLabelReader>,
): string[] {
  const out: string[] = []
  const add = (label: string | undefined) => {
    if (label && labels.includes(label) && !out.includes(label)) out.push(label)
  }
  for (const match of sentence.matchAll(
    /[(（]\s*([a-z]|\d{1,2}|[ivx]{2,4})\s*[)）]|\bpart\s+([a-z]|\d{1,2})\b|第\s*[(（]?(\d{1,2}|[一二三四五六七八九十])[)）]?\s*(?:问|小题|部分)/gi,
  )) {
    const item = token(match[1] ?? match[2] ?? match[3] ?? '', false)
    if (item) add(reader.toQuestion(item).label)
  }
  const COUNT: Record<string, number> = { two: 2, three: 3, four: 4, 两: 2, 二: 2, 三: 3, 四: 4 }
  for (const match of sentence.matchAll(
    /\b(first|last)\s+(two|three|four|2|3|4)\s+(?:parts|questions|sub-?parts)\b|前\s*([两二三四234])\s*(?:问|小题|部分)/gi,
  )) {
    const raw = (match[2] ?? match[3] ?? '').toLowerCase()
    const count = COUNT[raw] ?? Number(raw)
    const picked =
      match[1]?.toLowerCase() === 'last' ? labels.slice(-count) : labels.slice(0, count)
    for (const label of picked) add(label)
  }
  for (const match of sentence.matchAll(
    /\b(first|second|third|fourth|fifth|sixth|last)\s+(?:part|question|sub-?part)\b/gi,
  )) {
    const word = match[1]!.toLowerCase()
    add(word === 'last' ? labels[labels.length - 1] : labels[(ORDINAL_WORDS[word] ?? 0) - 1])
  }
  return out
}

/** The segment an excerpt is in (its first piece), worked segments first. */
export function segmentOfQuote(
  quote: string,
  segments: readonly ProfessorSegment[],
): ProfessorSegment | undefined {
  const first = quote.split(ELLIPSIS).find((piece) => piece.trim()) ?? quote
  const ordered = [
    ...segments.filter((segment) => !segment.restatedOnly),
    ...segments.filter((segment) => segment.restatedOnly),
  ]
  return ordered.find((segment) => quoteInAnswer(first, segment.text))
}

function sourceOf(segment: ProfessorSegment): ProfessorMapSource {
  return {
    labels: segment.labels,
    ...(segment.nestedUnder ? { nestedUnder: segment.nestedUnder } : {}),
    ...(segment.method !== undefined ? { method: segment.method } : {}),
  }
}

/** A segment that works a sub-part out (not just restating or deferring it). */
function solves(segment: ProfessorSegment, label: string): boolean {
  return (
    segment.labels.includes(label) &&
    !segment.restatedOnly &&
    !(segment.defers?.includes(label) ?? false)
  )
}

function deferredAnywhere(segments: readonly ProfessorSegment[], label: string): boolean {
  return segments.some((segment) => segment.defers?.includes(label))
}

/** Flags the key's own text gives a sub-part's segments. */
function segmentFlags(own: readonly ProfessorSegment[]): MapFlag[] {
  const flags = new Set<MapFlag>()
  for (const segment of own) {
    if (segment.nestedUnder) flags.add('misplaced')
    if (segment.labels.length > 1) flags.add('shared')
    if (segment.refersTo?.length) flags.add('reference')
    if (segment.badRefs?.length) flags.add('bad-reference')
  }
  if (own.some((segment) => segment.method !== undefined)) flags.add('several-ways')
  return [...flags]
}

/** Flags that need the student's eye (the others are only informative). */
const LOW_FLAGS: ReadonlySet<MapFlag> = new Set<MapFlag>([
  'indirect',
  'bad-reference',
  'corrected',
  'quotes-dropped',
  'unlocated',
  'conflict',
])

function withConfidence(entry: ProfessorMapEntry, flags: MapFlag[]): ProfessorMapEntry {
  const unique = [...new Set(flags)]
  return {
    ...entry,
    confidence: unique.some((flag) => LOW_FLAGS.has(flag)) ? 'low' : 'high',
    ...(unique.length > 0 ? { flags: unique } : {}),
  }
}

/**
 * The deterministic fallback: a sub-part with worked segments carrying its
 * label (under its own heading, misplaced under another, or shared with
 * other sub-parts) is `direct`; one the key leaves to the student is `none`
 * (flag `deferred`); everything else is an unsure `none` (`unlocated`, low
 * confidence — never sent to a writer as "not in the professor answer").
 */
export function localProfessorMap(answer: string, question: string): ProfessorMapEntry[] {
  const segments = segmentProfessorAnswer(answer, question)
  return mapSubparts(question).map(({ label }): ProfessorMapEntry => {
    const own = segments.filter((segment) => solves(segment, label))
    if (own.length === 0) {
      return deferredAnywhere(segments, label)
        ? withConfidence({ label, coverage: 'none', quotes: [] }, ['deferred'])
        : withConfidence({ label, coverage: 'none', quotes: [] }, ['unlocated'])
    }
    const first = own.find((segment) => segment.nestedUnder) ?? own[0]!
    return withConfidence(
      {
        label,
        coverage: 'direct',
        quotes: own.map((segment) => segment.text),
        ...(first.nestedUnder || first.labels.length > 1 ? { from: sourceOf(first) } : {}),
      },
      segmentFlags(own),
    )
  })
}

/** Whether a local entry is only "nobody located it" (not an asserted `none`). */
export function isUnlocated(entry: Pick<ProfessorMapEntry, 'coverage' | 'flags'>): boolean {
  return entry.coverage === 'none' && (entry.flags?.includes('unlocated') ?? false)
}

// --- Validating the AI reply --------------------------------------------------

export interface RawMapEntry {
  label: string
  coverage: string
  quotes: string[]
  note?: string
}

/** `(a)`, `a`, `2(a)`, `（a）`, `part a`, `1`, `1.`, `part 1` → the question label, else null. */
export function normalizeMapLabel(raw: string, labels: readonly string[]): string | null {
  const text = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^(?:part|sub-?part|小题|第)\s*/, '')
  const bracketed = /\(([a-z]|\d{1,2})\)\s*$/.exec(text)
  const bare = /^(?:\d+\s*)?([a-z])[).]?$/.exec(text) ?? /^(\d{1,2})[.)]?$/.exec(text)
  const label = bracketed?.[1] ?? bare?.[1]
  return label && labels.includes(label) ? label : null
}

export interface ValidatedProfessorMap {
  entries: ProfessorMapEntry[]
  /** Entries for a label that is no sub-part of the question. */
  droppedLabels: number
  /** Excerpts that do not occur in the professor answer. */
  droppedQuotes: number
  /** `direct` / `indirect` entries left without any checked excerpt. */
  unverified: number
  /** Coverage changed by the local check (excerpt location, own solution found). */
  corrected: number
}

const MAX_QUOTES = 4
const MAX_QUOTE_CHARS = 1_200

/**
 * Keep what can be trusted, and say how sure it is.
 *  - Labels must be the question's sub-parts (one entry each, in question
 *    order); excerpts must occur in the key; a covered sub-part without any
 *    surviving excerpt falls back to the local pass.
 *  - Coverage follows where the excerpts are: all in segments carrying the
 *    sub-part's label (own heading, misplaced, shared) ⇒ `direct`; all in
 *    segments of other sub-parts ⇒ `indirect`.
 *  - `none` for a sub-part with a labelled worked segment that the reply
 *    gave to no other sub-part ⇒ that segment, `direct` (flag `corrected`);
 *    `none` where the key defers the sub-part ⇒ `deferred` (high).
 *  - A sub-part the reply leaves out keeps the local entry.
 * Null when the reply has no usable entry.
 */
export function validateProfessorMap(
  raw: readonly RawMapEntry[],
  context: { question: string; answer: string },
): ValidatedProfessorMap | null {
  const labels = mapSubparts(context.question).map((part) => part.label)
  const cleaned = cleanProfessorAnswerText(context.answer)
  const segments = segmentProfessorAnswer(context.answer, context.question)
  const local = new Map(
    localProfessorMap(context.answer, context.question).map((entry) => [entry.label, entry]),
  )
  let droppedLabels = 0
  let droppedQuotes = 0
  let unverified = 0
  let corrected = 0

  // Pass 1: labels, coverage and checked quotes.
  const accepted: Array<{
    label: string
    coverage: ProfessorCoverage
    quotes: string[]
    dropped: number
    located: ProfessorSegment[]
    note?: string
  }> = []
  for (const item of raw) {
    const label = normalizeMapLabel(item.label, labels)
    if (label === null) {
      droppedLabels += 1
      continue
    }
    if (accepted.some((entry) => entry.label === label)) continue
    if (!PROFESSOR_COVERAGES.includes(item.coverage as ProfessorCoverage)) continue
    const coverage = item.coverage as ProfessorCoverage
    const note = item.note?.trim().slice(0, 300)
    const quotes: string[] = []
    let dropped = 0
    if (coverage !== 'none') {
      for (const quote of item.quotes) {
        const text = quote.trim().slice(0, MAX_QUOTE_CHARS)
        if (quotes.length >= MAX_QUOTES) break
        if (quoteInAnswer(text, cleaned) || quoteInAnswer(text, context.answer)) quotes.push(text)
        else dropped += 1
      }
      droppedQuotes += dropped
      if (quotes.length === 0) {
        unverified += 1
        continue
      }
    }
    const located = quotes
      .map((quote) => segmentOfQuote(quote, segments))
      .filter((segment): segment is ProfessorSegment => Boolean(segment))
    accepted.push({ label, coverage, quotes, dropped, located, ...(note ? { note } : {}) })
  }
  if (accepted.length === 0) return null
  // Segments the reply gave to some sub-part (by excerpt).
  const claimedBy = new Map<string, Set<string>>()
  for (const entry of accepted)
    for (const segment of entry.located) {
      const set = claimedBy.get(segment.id) ?? new Set<string>()
      set.add(entry.label)
      claimedBy.set(segment.id, set)
    }

  // Pass 2: coverage from where the excerpts are.
  const byLabel = new Map<string, ProfessorMapEntry>()
  for (const entry of accepted) {
    const { label, located, quotes, note } = entry
    const localEntry = local.get(label)
    if (entry.coverage === 'none') {
      // The key itself labels a worked solution for this sub-part (also when
      // the reply read it as part of another sub-part): the label wins, and
      // the student is asked to confirm.
      const own = segments.filter((segment) => solves(segment, label))
      if (own.length > 0) {
        const disputed = own.some((segment) =>
          [...(claimedBy.get(segment.id) ?? [])].some((claim) => claim !== label),
        )
        const first = own.find((segment) => segment.nestedUnder) ?? own[0]!
        byLabel.set(
          label,
          withConfidence(
            {
              label,
              coverage: 'direct',
              quotes: own.map((segment) => segment.text),
              ...(first.nestedUnder || first.labels.length > 1 ? { from: sourceOf(first) } : {}),
            },
            [...segmentFlags(own), 'corrected', ...(disputed ? (['conflict'] as const) : [])],
          ),
        )
        corrected += 1
      } else {
        const deferred = deferredAnywhere(segments, label)
        const unlabelledWork = segments.some(
          (segment) => segment.labels.length === 0 && !segment.extraLabel && !segment.restatedOnly,
        )
        byLabel.set(
          label,
          withConfidence(
            { label, coverage: 'none', quotes: [], ...(note ? { note } : {}) },
            deferred ? ['deferred'] : unlabelledWork ? ['conflict'] : [],
          ),
        )
      }
      continue
    }
    let coverage = entry.coverage
    const flags: MapFlag[] = []
    const inOwn = located.length > 0 && located.every((segment) => segment.labels.includes(label))
    const outside =
      located.length > 0 &&
      located.every((segment) => !segment.labels.includes(label) && segment.labels.length > 0)
    if (coverage === 'direct' && outside) {
      coverage = 'indirect'
      flags.push('corrected')
      corrected += 1
    } else if (coverage === 'indirect' && inOwn) {
      coverage = 'direct'
      flags.push('corrected')
      corrected += 1
    }
    if (coverage === 'indirect') flags.push('indirect')
    if (entry.dropped > 0) flags.push('quotes-dropped')
    // The key labels a solution for this sub-part that the reply gave elsewhere.
    if (localEntry?.coverage === 'direct' && !located.some((segment) => solves(segment, label)))
      flags.push('conflict')
    if (deferredAnywhere(segments, label)) flags.push('conflict')
    // An excerpt the key labels for another sub-part (and not this one).
    if (
      coverage === 'direct' &&
      located.some(
        (segment) =>
          segment.labels.length > 0 &&
          !segment.labels.includes(label) &&
          segment.labels.every((other) => labels.includes(other)),
      )
    )
      flags.push('conflict')
    const ownLocated = located.filter(
      (segment, index) =>
        segment.labels.includes(label) &&
        located.findIndex((other) => other.id === segment.id) === index,
    )
    flags.push(...segmentFlags(ownLocated))
    const first = ownLocated[0] ?? located[0]
    byLabel.set(
      label,
      withConfidence(
        {
          label,
          coverage,
          quotes,
          ...(first ? { from: sourceOf(first) } : {}),
          ...(note ? { note } : {}),
        },
        flags,
      ),
    )
  }
  const entries = labels.flatMap((label) => {
    const entry = byLabel.get(label) ?? local.get(label)
    return entry ? [entry] : []
  })
  return { entries, droppedLabels, droppedQuotes, unverified, corrected }
}

// --- The map in effect --------------------------------------------------------

/** The cached AI map, when it was made for this answer and this question. */
export function currentProfessorMap(question: HomeworkQuestion): ProfessorAnswerMap | undefined {
  const map = question.professorMap
  const answer = question.answerText ?? ''
  if (!map || !answer.trim()) return undefined
  return map.answerHash === mapAnswerHash(answer) &&
    map.questionHash === mapQuestionHash(question.prompt)
    ? map
    : undefined
}

/** The student's edits, when they were made for this answer and this question. */
export function currentProfessorMapEdits(question: HomeworkQuestion): ProfessorMapEdit[] {
  const edits = question.professorMapEdits
  const answer = question.answerText ?? ''
  if (!edits || !answer.trim()) return []
  return edits.answerHash === mapAnswerHash(answer) &&
    edits.questionHash === mapQuestionHash(question.prompt)
    ? edits.entries
    : []
}

export interface ProfessorMapViewEntry extends ProfessorMapEntry {
  /** `ai`: checked AI map; `local`: the local pass; `edit`: the student's choice. */
  source: 'ai' | 'local' | 'edit'
}

export interface ProfessorMapView {
  /** Whether a checked AI map exists (else only the local pass). */
  origin: 'ai' | 'local'
  entries: ProfessorMapViewEntry[]
  segments: ProfessorSegment[]
  edited: boolean
  /** Sub-parts whose mapping the student should confirm (「请确认」). */
  toConfirm: string[]
}

/**
 * The map in effect for a question with a matched answer and sub-parts: the
 * student's edits over the AI map (or, without one, over the local pass).
 * Undefined when no map applies.
 */
export function professorMapView(question: HomeworkQuestion): ProfessorMapView | undefined {
  const answer = mappableAnswer(question)
  if (!answer) return undefined
  const segments = segmentProfessorAnswer(answer, question.prompt)
  const ai = currentProfessorMap(question)
  const edits = new Map(currentProfessorMapEdits(question).map((edit) => [edit.label, edit]))
  const base = new Map(
    (ai?.entries ?? localProfessorMap(answer, question.prompt)).map((entry) => [
      entry.label,
      entry,
    ]),
  )
  const entries = mapSubparts(question.prompt).flatMap(({ label }): ProfessorMapViewEntry[] => {
    const edit = edits.get(label)
    if (edit) {
      const located = edit.quotes
        .map((quote) => segmentOfQuote(quote, segments))
        .filter((segment): segment is ProfessorSegment => Boolean(segment))
      const first = located.find((segment) => segment.labels.includes(label)) ?? located[0]
      return [
        {
          label,
          coverage: edit.coverage,
          quotes: edit.quotes,
          ...(first ? { from: sourceOf(first) } : {}),
          confidence: 'high',
          source: 'edit',
        },
      ]
    }
    const entry = base.get(label)
    return entry ? [{ ...entry, source: ai ? 'ai' : 'local' }] : []
  })
  return {
    origin: ai ? 'ai' : 'local',
    entries,
    segments,
    edited: edits.size > 0,
    toConfirm: entries
      .filter((entry) => entry.source !== 'edit' && entry.confidence === 'low')
      .map((entry) => entry.label),
  }
}

/** One sub-part of the map as a prompt shows it (`from` in words). */
export type PromptMapEntry = ProfessorMapPromptEntry

function labelText(label: string): string {
  return /^\d+$/.test(label) ? `part ${label}` : `(${label})`
}

/** Where an excerpt is, in the words a prompt uses. */
export function describeSource(source: ProfessorMapSource): string {
  if (source.labels.length === 0) return "the professor's unlabelled / general solution"
  const own = source.labels.map(labelText).join(' and ')
  const where = source.nestedUnder
    ? `the professor's ${own}, written under the heading of ${labelText(source.nestedUnder)}`
    : source.labels.length > 1
      ? `the professor's joint answer to ${own}`
      : own
  return source.method !== undefined ? `${where}, method ${source.method}` : where
}

/** Whether `from` adds anything for this entry (not just "its own heading"). */
function sourceWorthNaming(entry: ProfessorMapEntry): boolean {
  const from = entry.from
  if (!from) return false
  return (
    from.labels.length !== 1 ||
    from.labels[0] !== entry.label ||
    Boolean(from.nestedUnder) ||
    from.method !== undefined
  )
}

/**
 * The map a writing prompt receives, or undefined (then the prompt is the one
 * without a map). The local pass alone is not sent (its `direct` the writer
 * sees anyway); with student edits it is sent with the edited sub-parts and
 * the local `direct` / deferred ones. An unlocated sub-part is never sent as
 * `none`: only a checked reply, the key's own deferral or the student says
 * the professor answer does not cover it.
 */
export function professorMapPromptEntries(
  question: HomeworkQuestion,
): PromptMapEntry[] | undefined {
  const view = professorMapView(question)
  if (!view) return undefined
  if (view.origin === 'local' && !view.edited) return undefined
  const entries = view.entries
    .filter((entry) => entry.source === 'edit' || !isUnlocated(entry))
    .map((entry): PromptMapEntry => ({
      label: entry.label,
      coverage: entry.coverage,
      quotes: entry.quotes.map((quote) => clipQuote(quote)),
      ...(entry.from && sourceWorthNaming(entry) ? { from: describeSource(entry.from) } : {}),
      ...(entry.note ? { note: entry.note } : {}),
    }))
  return entries.length > 0 ? entries : undefined
}

/** The labels the map says the professor answer does not cover. */
export function uncoveredLabels(entries: readonly PromptMapEntry[] | undefined): string[] {
  return (entries ?? []).filter((entry) => entry.coverage === 'none').map((entry) => entry.label)
}

/**
 * Fingerprint of the student's edits (for the walkthrough section hash), or
 * undefined without edits — so a question nobody edited keeps its hash.
 */
export function professorMapEditDigest(question: HomeworkQuestion): string | undefined {
  const edits = currentProfessorMapEdits(question)
  if (edits.length === 0) return undefined
  return fnv1a(
    JSON.stringify(
      [...edits]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((edit) => [edit.label, edit.coverage, edit.quotes]),
    ),
  )
}

/** Apply (or with `null` remove) the student's choice for one sub-part. */
export function withProfessorMapEdit(
  question: HomeworkQuestion,
  label: string,
  edit: { coverage: ProfessorCoverage; quotes: string[] } | null,
  now = Date.now(),
): ProfessorMapEdits | undefined {
  const answer = question.answerText ?? ''
  const kept = currentProfessorMapEdits(question).filter((entry) => entry.label !== label)
  const entries = edit
    ? [
        ...kept,
        {
          label,
          coverage: edit.coverage,
          quotes: edit.coverage === 'none' ? [] : edit.quotes,
          updatedAt: now,
        },
      ]
    : kept
  if (entries.length === 0) return undefined
  return {
    answerHash: mapAnswerHash(answer),
    questionHash: mapQuestionHash(question.prompt),
    entries,
  }
}

/** The segment hints the mapping prompt shows (labels, place, notes, first words). */
export function segmentHints(segments: readonly ProfessorSegment[]): Array<{
  id: string
  where: string
  start: string
  restatedOnly?: boolean
}> {
  return segments.map((segment) => {
    const notes = [
      segment.keyLabel ? `the key labels it "${segment.keyLabel}"` : '',
      segment.extraLabel
        ? `labelled (${segment.extraLabel}), which the question does not have`
        : '',
      segment.refersTo?.length ? `refers to ${segment.refersTo.map(labelText).join(', ')}` : '',
      segment.badRefs?.length
        ? `refers to (${segment.badRefs.join('), (')}), which the question does not have`
        : '',
      segment.defers?.length
        ? `leaves ${segment.defers.map(labelText).join(', ')} to the student`
        : '',
    ].filter(Boolean)
    return {
      id: segment.id,
      where: `${describeSource(sourceOf(segment))}${notes.length ? ` (${notes.join('; ')})` : ''}`,
      start: segment.text.replace(/\s+/g, ' ').slice(0, 70),
      ...(segment.restatedOnly ? { restatedOnly: true } : {}),
    }
  })
}
