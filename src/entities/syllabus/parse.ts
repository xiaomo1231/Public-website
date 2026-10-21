import type { ExamScope, ExamScopeKind, ExamTopic, SyllabusData } from './types'

/**
 * Local exam-topic parser for a syllabus / course handbook.
 *
 * Reads the processed chunks line by line. A scope opens at a heading about
 * exam topics ("TOPICS OF THE SEMIFINAL EXAMINATION", "Midterm topics",
 * "期末考试题目", or an exam heading such as "MIDTERM EXAMINATIONS") and holds
 * the list under it:
 *  - under a *topic* heading, numbered / bulleted lines and plain one-per-line
 *    entries are topics; short title-like lines become group labels;
 *  - under a plain *exam* heading (rules, dates, marking), only numbered or
 *    bulleted lines count, and lines that read like rules are dropped.
 * Wrapped lines (starting lower-case, or after an open parenthesis / comma)
 * are joined to the topic they continue, also across chunks. Every topic keeps
 * its exact text, the chunk it starts in and the page. Nothing is rewritten.
 */

export interface SyllabusChunk {
  id: string
  text: string
  pageNumber?: number
  contentType?: string
}

/** Headings that name a list of exam topics. */
const STRONG_KEYWORD =
  /\b(?:topics?|theses|thèmes|themen|prüfungsthemen|tételek|tételsor|question list|list of questions|exam questions)\b|题目|考点|考试范围|考试内容|考核内容|复习提纲|复习要点|复习范围|考试大纲/i
/** Headings about an exam in general (its topics may or may not follow). */
const WEAK_KEYWORD =
  /\b(?:exams?|examinations?|midterms?|mid-terms?|semi-?finals?|finals?|tests?|quiz(?:zes)?|vizsga|prüfung|klausur)\b|期中|期末|考试|测验|考查/i

const MIDTERM = /\b(?:mid-?terms?|test\s+i\b|interim)|期中|阶段/i
const FINAL =
  /\b(?:semi-?finals?|finals?|end[- ]of[- ](?:term|semester)|szigorlat|kollokvium)\b|期末|结业/i

/** A list marker: `1.`, `1)`, `(1)`, `a)`, `IV.`, `一、`, `（1）`, bullets. */
const MARKER =
  /^\s*(?:(?:\d{1,3}|[A-Za-z]|[IVXivx]{2,5})[.)]\s+|\(\d{1,3}\)\s*|（\d{1,3}）\s*|\d{1,3}[、．]\s*|[一二三四五六七八九十]{1,3}[、．.]\s*|[•·▪●○◦■□►▸*]\s*|[-–—]\s+)/

/** Wording of rules and announcements, never of an exam topic. */
const PROSE =
  /\b(?:students?|you|your|must|should|shall|please|obligatory|allowed|registration|attendance|deadline|will be|may (?:not|be|only|also|continue|view)|is to|are to)\b|请|必须|不得|允许|报名/i

const MAX_TOPIC_WORDS = 30
const MAX_TOPIC_CHARS = 260
const MAX_HEADING_WORDS = 10
const MAX_HEADING_CHARS = 90
/** A scope with fewer topics than this is a heading with no list. */
const MIN_SCOPE_TOPICS = 2
/** ≥ this many title-like lines in a row are a Title Case list, not labels. */
const TITLE_RUN_IS_LIST = 3

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function letters(text: string): string {
  return text.replace(/[^\p{L}]/gu, '')
}

function isMostlyUpper(text: string): boolean {
  const all = letters(text)
  if (all.length < 4) return false
  const upper = all.replace(/[^\p{Lu}]/gu, '').length
  return upper / all.length >= 0.8
}

export function scopeKindOf(label: string): ExamScopeKind {
  if (MIDTERM.test(label)) return 'midterm'
  if (FINAL.test(label)) return 'final'
  return 'other'
}

interface HeadingInfo {
  strong: boolean
}

/** A heading that opens a scope, or null. */
function examHeading(line: string, inHeadingChunk: boolean): HeadingInfo | null {
  const text = line.trim()
  if (!text || text.length > MAX_HEADING_CHARS || words(text).length > MAX_HEADING_WORDS)
    return null
  if (MARKER.test(text)) return null
  // "Topics: Gross anatomy of …" is a line of prose, not a heading.
  const colon = text.search(/[:：]/)
  if (colon >= 0 && colon < text.length - 1) return null
  if (/[.;,，。；]$/.test(text)) return null
  const strong = STRONG_KEYWORD.test(text)
  const weak = WEAK_KEYWORD.test(text)
  if (!strong && !weak) return null
  const prominent = inHeadingChunk || isMostlyUpper(text)
  if (strong && (prominent || words(text).length <= 6 || /[:：]$/.test(text))) return { strong }
  if (prominent) return { strong }
  return null
}

/** A short title-like line inside a topic list: "Musculoskeletal Anatomy". */
function titleLike(line: string): boolean {
  const ws = words(line)
  if (ws.length < 2 || ws.length > MAX_HEADING_WORDS) return false
  if (/[,;:()（），；：]/.test(line) || /\.$/.test(line.replace(/\b[IVX]+\.$/, ''))) return false
  return /^\p{Lu}/u.test(ws[0]!) && /^\p{Lu}/u.test(ws[1]!)
}

function isProse(text: string): boolean {
  return PROSE.test(text) || words(text).length > MAX_TOPIC_WORDS || text.length > MAX_TOPIC_CHARS
}

/** True when `line` continues the topic `previous` (a wrapped line). */
function continues(previous: string, line: string): boolean {
  if (/^[\p{Ll}]/u.test(line)) return true
  const open = (previous.match(/[(（[]/g) ?? []).length
  const close = (previous.match(/[)）\]]/g) ?? []).length
  if (open > close) return true
  return /[,;:&(（\-–]$/.test(previous) || /\b(?:and|or|of|the|with|to|in|for)$/i.test(previous)
}

function isNoise(line: string): boolean {
  // Page numbers, running footers such as "- 13 -", empty bullets.
  return !letters(line) || /^[-–\s]*\d{1,4}[-–\s]*$/.test(line)
}

interface Draft {
  text: string
  chunk: SyllabusChunk
  group?: string
  marked: boolean
}

interface ScopeDraft {
  label: string
  strong: boolean
  topics: Draft[]
  /** The scope has seen a numbered / bulleted item. */
  marked: boolean
  group?: string
  /** Title-like lines waiting to be read as labels (or as a Title Case list). */
  titles: Array<{ text: string; chunk: SyllabusChunk }>
  /** The topic a wrapped line may continue; cleared by anything else. */
  open: Draft | null
}

export interface ParseOptions {
  /** Id generator (tests pass a deterministic one). */
  newId?: () => string
}

export function parseSyllabusTopics(
  chunks: SyllabusChunk[],
  options: ParseOptions = {},
): ExamScope[] {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const scopes: ScopeDraft[] = []
  let current: ScopeDraft | null = null

  const flushTitles = (scope: ScopeDraft) => {
    if (scope.titles.length === 0) return
    if (scope.titles.length >= TITLE_RUN_IS_LIST) {
      // A list written in Title Case: these are topics.
      for (const title of scope.titles) {
        const draft: Draft = { text: title.text, chunk: title.chunk, marked: false }
        if (scope.group) draft.group = scope.group
        scope.topics.push(draft)
      }
    } else {
      // A course title then a group label: the last one names the group.
      scope.group = scope.titles[scope.titles.length - 1]!.text
    }
    scope.titles = []
  }

  const addTopic = (scope: ScopeDraft, text: string, chunk: SyllabusChunk, marked: boolean) => {
    flushTitles(scope)
    const draft: Draft = { text, chunk, marked }
    if (scope.group) draft.group = scope.group
    scope.topics.push(draft)
    scope.open = draft
  }

  const close = () => {
    if (current) flushTitles(current)
    current = null
  }

  for (const chunk of chunks) {
    const headingChunk = chunk.contentType === 'heading'
    for (const raw of chunk.text.split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, ' ').trim()
      if (!line || isNoise(line)) continue

      const heading = examHeading(line, headingChunk)
      if (heading) {
        // Inside an open topic list, a plain "Further topics …" line is a
        // group label of the same list, not a new scope.
        const scope = current as ScopeDraft | null
        if (scope?.strong && !headingChunk && !isMostlyUpper(line)) {
          flushTitles(scope)
          scope.group = line.replace(/[:：]$/, '')
          scope.open = null
          continue
        }
        close()
        current = {
          label: line.replace(/[:：]$/, ''),
          strong: heading.strong,
          topics: [],
          marked: false,
          titles: [],
          open: null,
        }
        scopes.push(current)
        continue
      }

      const scope = current as ScopeDraft | null
      if (!scope) continue

      const marker = line.match(MARKER)
      if (marker) {
        const text = line.slice(marker[0].length).trim()
        if (!text || isNoise(text)) continue
        if (!scope.marked && scope.strong) {
          // The plain line right before the first numbered item is its label.
          const last = scope.topics[scope.topics.length - 1]
          if (last && last === scope.open && !last.marked && words(last.text).length <= 8) {
            scope.topics.pop()
            scope.group = last.text
          }
        }
        scope.marked = true
        addTopic(scope, text, chunk, true)
        continue
      }

      // Another section starts: a heading chunk or an upper-case line.
      if (headingChunk || isMostlyUpper(line)) {
        if (!scope.strong || isMostlyUpper(line)) {
          close()
          continue
        }
        flushTitles(scope)
        scope.group = line
        scope.open = null
        continue
      }

      if (scope.open && continues(scope.open.text, line)) {
        scope.open.text = `${scope.open.text} ${line}`
        continue
      }
      if (!scope.strong) {
        // Prose under an exam heading: only listed items count.
        scope.open = null
        continue
      }
      // "Further topics with relevance to …" names the next part of the list.
      if (
        STRONG_KEYWORD.test(line) &&
        words(line).length <= MAX_HEADING_WORDS &&
        !/[.。]$/.test(line) &&
        !isProse(line)
      ) {
        flushTitles(scope)
        scope.group = line.replace(/[:：]$/, '')
        scope.open = null
        continue
      }
      if (titleLike(line)) {
        scope.titles.push({ text: line, chunk })
        scope.open = null
        continue
      }
      if (scope.marked) {
        // In a numbered list, an unnumbered short line labels what follows.
        if (words(line).length <= 8 && !/[.。]$/.test(line)) {
          flushTitles(scope)
          scope.group = line
        }
        scope.open = null
        continue
      }
      addTopic(scope, line, chunk, false)
    }
  }
  close()

  const out: ExamScope[] = []
  for (const draft of scopes) {
    const seen = new Set<string>()
    const topics: ExamTopic[] = []
    for (const item of draft.topics) {
      const text = item.text.replace(/\s+/g, ' ').trim()
      if (isProse(text) || seen.has(text)) continue
      seen.add(text)
      topics.push({
        id: newId(),
        text,
        order: topics.length,
        ...(item.group ? { group: item.group } : {}),
        sourceChunkId: item.chunk.id,
        ...(item.chunk.pageNumber !== undefined ? { page: item.chunk.pageNumber } : {}),
        source: 'local',
      })
    }
    if (topics.length < MIN_SCOPE_TOPICS) continue
    out.push({ id: newId(), label: draft.label, kind: scopeKindOf(draft.label), topics })
  }
  return out
}

/** File-name / first-page wording of a syllabus, handbook or exam-topic list. */
const SYLLABUS_HINT =
  /syllabus|handbook|course\s*guide|announcements?|topics\s+of\s+the\s+(?:\w+\s+)?exam(?:ination)?|exam(?:ination)?\s+topics|tematika|tantárgyi|vizsgatételek|tételsor|prüfungsthemen|modulhandbuch|考试大纲|教学大纲|课程大纲|考试范围|复习提纲/i

/** A lecture deck may open with "Announcements"; on a page it needs more context. */
const PAGE_ANNOUNCEMENT = /\bannouncements?\b(?!\s+concerning)/gi

/** Suggest the `syllabus` role from a file name and (optionally) its first page. */
export function looksLikeSyllabus(name: string, firstPageText = ''): boolean {
  if (SYLLABUS_HINT.test(name)) return true
  return SYLLABUS_HINT.test(firstPageText.slice(0, 3000).replace(PAGE_ANNOUNCEMENT, ''))
}

/** The stored form of a local parse (an empty `scopes` list when nothing was found). */
export function localSyllabus(
  chunks: SyllabusChunk[],
  now: number = Date.now(),
  options: ParseOptions = {},
): SyllabusData {
  return { scopes: parseSyllabusTopics(chunks, options), extractedAt: now, method: 'local' }
}
