import { matchTokens } from '@/entities/syllabus/match'
import { dayKey } from './calendar'

/**
 * 粘贴识别: read exam dates from pasted text (a syllabus line, an email, a
 * course outline or a table) without AI. Deterministic and local:
 *
 * - dates in English and Chinese forms ("Tuesday, Oct 27, 2026", "27 Oct",
 *   "10/27", "27.10.", "2026/10/27", "2026年10月27日", "10月27号"), with the
 *   year inferred as the next occurrence from today when it is missing (a
 *   weekday that names the date settles the year);
 * - times in 12 / 24 h and Chinese forms ("7:00–8:30 pm", "9am", "14:00",
 *   "上午9:00", "下午3点半"); a range gives the start and the duration;
 * - the exam kind (midterm / final / quiz / test / exam, 期中 / 期末 / 测验…)
 *   as the name, kept in the student's own wording ("Midterm 1");
 * - the course, by course code ("ECON 110") or name, matched to the
 *   student's courses.
 *
 * What it cannot read for sure is flagged (`uncertain`) so the caller can ask
 * the AI instead; nothing is ever saved from here — the results are drafts.
 */

export interface PasteCourse {
  id: string
  name: string
}

export type PasteDoubt =
  /** No exam word on the line (only a date and a course). */
  | 'no-kind'
  /** "10/11": month / day order not certain. */
  | 'ambiguous-date'
  /** The weekday written does not fall on the date. */
  | 'weekday-mismatch'

export interface PastedExam {
  name: string
  /** `YYYY-MM-DD` (local). */
  date: string
  /** `HH:MM`, `''` when no time was written. */
  time: string
  durationMinutes?: number
  location?: string
  /** The course as written (a code or a name), when one was found. */
  courseText?: string
  /** The student's course it matched, when the match is clear. */
  projectId?: string
  /** The text the exam was read from (verbatim from the paste). */
  sourceText: string
  uncertain: PasteDoubt[]
  origin: 'local' | 'ai'
}

export interface PasteParseResult {
  exams: PastedExam[]
  /** Every exam was read without doubt (else the caller may ask the AI). */
  confident: boolean
}

export interface PasteParseOptions {
  now?: number
  courses?: readonly PasteCourse[]
  /** The only course possible (the course page's plan): used when none is named. */
  defaultProjectId?: string
}

// ── dates ───────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}
const MONTH_NAME =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const EN_WEEKDAYS: Array<[RegExp, number]> = [
  [/\bsun(?:day)?\b/i, 0],
  [/\bmon(?:day)?\b/i, 1],
  [/\btue(?:s|sday)?\b/i, 2],
  [/\bwed(?:nesday)?\b/i, 3],
  [/\bthu(?:r|rs|rsday)?\b/i, 4],
  [/\bfri(?:day)?\b/i, 5],
  [/\bsat(?:urday)?\b/i, 6],
]
const ZH_WEEKDAY = /(?:星期|周|礼拜)([一二三四五六日天])/
const ZH_WEEKDAY_NUM: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
}

interface DateHit {
  year?: number
  month: number
  day: number
  start: number
  end: number
  ambiguous?: boolean
}

function monthOf(name: string): number {
  return MONTHS[name.toLowerCase().slice(0, name.toLowerCase().startsWith('sept') ? 4 : 3)] ?? 0
}

function fullYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return raw.length <= 2 ? 2000 + n : n
}

function findDate(text: string): DateHit | null {
  let m: RegExpExecArray | null
  // 2026-10-27 · 2026/10/27 · 2026.10.27 · 2026年10月27日
  m = /(?<!\d)(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?!\d)\s*[日号]?/.exec(text)
  if (m)
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    }
  // 10月27日 · 10月27号
  m = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text)
  if (m)
    return { month: Number(m[1]), day: Number(m[2]), start: m.index, end: m.index + m[0].length }
  // Oct 27 · October 27th, 2026 · Oct. 27
  m = new RegExp(
    `\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`,
    'i',
  ).exec(text)
  if (m)
    return {
      month: monthOf(m[1]!),
      day: Number(m[2]),
      year: fullYear(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    }
  // 27 Oct · 27th October 2026
  m = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAME})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`,
    'i',
  ).exec(text)
  if (m)
    return {
      month: monthOf(m[2]!),
      day: Number(m[1]),
      year: fullYear(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    }
  // 27.10. · 27.10.2026 (day first, the European form)
  m = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?![\d])/.exec(text)
  if (m)
    return {
      day: Number(m[1]),
      month: Number(m[2]),
      year: fullYear(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    }
  // 10/27 · 27/10/2026 · 10/11 (ambiguous)
  m = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/.exec(text)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const dayFirst = a > 12 && b <= 12
    return {
      month: dayFirst ? b : a,
      day: dayFirst ? a : b,
      year: fullYear(m[3]),
      start: m.index,
      end: m.index + m[0].length,
      ...(a <= 12 && b <= 12 && a !== b ? { ambiguous: true } : {}),
    }
  }
  return null
}

function weekdayOf(text: string): number | undefined {
  const zh = ZH_WEEKDAY.exec(text)
  if (zh) return ZH_WEEKDAY_NUM[zh[1]!]
  for (const [pattern, day] of EN_WEEKDAYS) if (pattern.test(text)) return day
  return undefined
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

function keyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True when `YYYY-MM-DD` names a real calendar day. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))
}

/**
 * The year of a date written without one: the next occurrence from today
 * (today counts). A weekday that falls on the date in only one of the two
 * candidate years picks that year.
 */
export function inferYear(month: number, day: number, now: number, weekday?: number): number {
  const today = dayKey(now)
  const year = new Date(now).getFullYear()
  const candidates = [year, year + 1].filter((y) => validDate(y, month, day))
  if (weekday !== undefined) {
    const matching = [year - 1, year, year + 1].filter(
      (y) => validDate(y, month, day) && new Date(y, month - 1, day).getDay() === weekday,
    )
    const upcoming = matching.filter((y) => keyOf(y, month, day) >= today)
    if (upcoming.length >= 1) return upcoming[0]!
  }
  return candidates.find((y) => keyOf(y, month, day) >= today) ?? candidates[0] ?? year
}

// ── times ───────────────────────────────────────────────────────────────

interface TimeHit {
  hour: number
  minute: number
  meridiem?: 'am' | 'pm'
  start: number
  end: number
}

const ZH_MERIDIEM: Record<string, 'am' | 'pm' | 'noon'> = {
  上午: 'am',
  早上: 'am',
  早晨: 'am',
  凌晨: 'am',
  中午: 'noon',
  下午: 'pm',
  晚上: 'pm',
  傍晚: 'pm',
}

function findTimes(text: string, skip: { start: number; end: number } | null): TimeHit[] {
  const hits: TimeHit[] = []
  const overlaps = (start: number, end: number) =>
    (skip && start < skip.end && end > skip.start) ||
    hits.some((hit) => start < hit.end && end > hit.start)
  const zh =
    /(上午|早上|早晨|凌晨|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*(?:[:：](\d{2})|点\s*(?:(半)|(\d{1,2})\s*分?)?)/g
  for (let m = zh.exec(text); m; m = zh.exec(text)) {
    if (!m[1] && !m[3] && !text.slice(m.index, m.index + m[0].length).includes('点')) continue
    // A bare "9:00" is read by the English pattern below (it knows am / pm after it).
    if (!m[1] && m[3]) continue
    const start = m.index
    const end = m.index + m[0].length
    if (overlaps(start, end)) continue
    let hour = Number(m[2])
    const minute = m[4] ? 30 : Number(m[3] ?? m[5] ?? 0)
    const tag = m[1] ? ZH_MERIDIEM[m[1]] : undefined
    if (tag === 'pm' && hour < 12) hour += 12
    if (tag === 'am' && hour === 12) hour = 0
    if (tag === 'noon' && hour < 6) hour += 12
    if (hour > 23 || minute > 59) continue
    hits.push({ hour, minute, start, end, ...(tag ? { meridiem: hour >= 12 ? 'pm' : 'am' } : {}) })
  }
  const en =
    /(?<![\d:：])(\d{1,2})(?:[:：](\d{2}))?(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z]))?(?![\d])/gi
  for (let m = en.exec(text); m; m = en.exec(text)) {
    const hasMinutes = m[2] !== undefined
    const meridiemRaw = m[3]?.toLowerCase().replace(/[.\s]/g, '')
    if (!hasMinutes && !meridiemRaw) continue
    const start = m.index
    const end = m.index + m[0].length
    if (overlaps(start, end)) continue
    let hour = Number(m[1])
    const minute = Number(m[2] ?? 0)
    if (minute > 59) continue
    if (meridiemRaw) {
      if (hour < 1 || hour > 12) continue
      if (meridiemRaw === 'pm' && hour < 12) hour += 12
      if (meridiemRaw === 'am' && hour === 12) hour = 0
    } else if (hour > 23) continue
    hits.push({
      hour,
      minute,
      start,
      end,
      ...(meridiemRaw ? { meridiem: meridiemRaw === 'pm' ? 'pm' : 'am' } : {}),
    })
  }
  if (/\bnoon\b|正午/i.test(text)) {
    const m = /\bnoon\b|正午/i.exec(text)!
    if (!overlaps(m.index, m.index + m[0].length))
      hits.push({ hour: 12, minute: 0, start: m.index, end: m.index + m[0].length })
  }
  return hits.sort((a, b) => a.start - b.start)
}

const RANGE_GAP = /^\s*(?:-|–|—|~|～|to|until|till|至|到)\s*$/i

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Start time and (for a range) the duration. */
function readTime(
  text: string,
  skip: { start: number; end: number } | null,
): { time: string; durationMinutes?: number } {
  const hits = findTimes(text, skip)
  const first = hits[0]
  if (!first) return { time: '' }
  const second = hits[1]
  if (second && RANGE_GAP.test(text.slice(first.end, second.start))) {
    let startHour = first.hour
    // "7:00–8:30 pm": the meridiem written once belongs to both, unless it
    // would put the start after the end ("11:00–1:00 pm" starts at 11 am).
    if (!first.meridiem && second.meridiem === 'pm' && startHour < 12) {
      const candidate = startHour + 12
      if (candidate * 60 + first.minute <= second.hour * 60 + second.minute) startHour = candidate
    }
    const minutes = second.hour * 60 + second.minute - (startHour * 60 + first.minute)
    return {
      time: hhmm(startHour, first.minute),
      ...(minutes > 0 && minutes <= 12 * 60 ? { durationMinutes: minutes } : {}),
    }
  }
  return { time: hhmm(first.hour, first.minute) }
}

function readDuration(text: string): number | undefined {
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b|小时)/i.exec(text)
  const minutes = /(\d{1,3})\s*(?:minutes?|mins?\b|分钟)/i.exec(text)
  let total = 0
  if (hours) total += Number(hours[1]) * 60
  if (minutes) total += Number(minutes[1])
  return total > 0 && total <= 12 * 60 ? Math.round(total) : undefined
}

// ── exam kind, location, course ─────────────────────────────────────────

// The exam's number ("Midterm 2"), never the start of a date ("Midterm 10/30").
const KIND_NUMBER = String.raw`(?: ?(?:#\s*)?(?:\d{1,2}|[IVX]{1,3})\b(?![/.:\-]\d))?`
const KIND_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:mid-?\s?term)(?:\s+exam(?:ination)?)?` + KIND_NUMBER, 'i'),
  new RegExp(String.raw`\bfinal(?:s|\s+exam(?:ination)?)?\b` + KIND_NUMBER, 'i'),
  /\b(?:oral|written|practical|lab)\s+exam(?:ination)?\b/i,
  new RegExp(String.raw`\b(?:exam(?:ination)?|test|quiz)\b` + KIND_NUMBER, 'i'),
  /(?:期中|期末|月考|随堂测验?|小测验?|测验|口试|笔试|实验考试|考查|考试)(?:考试)?(?:\s*[（(]\s*[一二三四五六七八九十\d]{1,2}\s*[）)]|[一二三四五六七八九十])?/,
]

function findKind(text: string): string | undefined {
  for (const pattern of KIND_PATTERNS) {
    const m = pattern.exec(text)
    if (m) return m[0].trim().replace(/\s+/g, ' ')
  }
  return undefined
}

function tidyName(raw: string): string {
  const name = raw.trim()
  if (/^[a-z]/.test(name)) return name.charAt(0).toUpperCase() + name.slice(1)
  return name
}

function readLocation(text: string): string | undefined {
  const labeled =
    /(?:地点|教室|考场|location|venue|where|room)\s*[:：]\s*([^,;|\n，；]{1,40})/i.exec(text)
  if (labeled) return labeled[1]!.trim()
  const room = /\b(?:room|rm\.?)\s*[A-Za-z]?\d{1,4}[A-Za-z]?\b/i.exec(text)
  if (room) return room[0].trim()
  const hall =
    /\b(?:in|at)\s+((?:[A-Z][\w.'-]*\s+){0,3}(?:Hall|Building|Auditorium|Center|Centre|Gym|Theatre|Theater)(?:\s+\d+)?)\b/.exec(
      text,
    )
  if (hall) return hall[1]!.trim()
  return undefined
}

const COURSE_CODE = /\b([A-Z]{2,6})\s?-?(\d{2,4}[A-Z]?)\b/g

function compact(text: string): string {
  return text.toLowerCase().replace(/[\s\-_.]/g, '')
}

/** The course a line names: by code in the course name, by the name itself, by shared words. */
export function matchCourse(
  text: string,
  courses: readonly PasteCourse[],
): { projectId?: string; courseText?: string } {
  const codes = [...text.matchAll(COURSE_CODE)].map((m) => `${m[1]} ${m[2]}`)
  const lineTokens = new Set(matchTokens(text))
  const compactText = compact(text)
  const scored = courses
    .map((course) => {
      const name = compact(course.name)
      let score = 0
      let courseText: string | undefined
      for (const code of codes) {
        if (name.includes(compact(code))) {
          score = 1
          courseText = code
        }
      }
      if (score < 1 && name.length >= 2 && compactText.includes(name)) {
        score = 1
        courseText = course.name
      }
      if (score < 1) {
        // The words of the name without its code ("MATH 101 Calculus I" → calculus).
        const tokens = matchTokens(course.name.replace(COURSE_CODE, ' '))
        if (tokens.length > 0) {
          const shared = tokens.filter((token) => lineTokens.has(token)).length / tokens.length
          if (shared >= 0.6 && shared > score) {
            score = shared
            courseText = course.name
          }
        }
      }
      return { course, score, courseText }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const tied = best && scored[1] && scored[1].score === best.score
  if (best && !tied) return { projectId: best.course.id, courseText: best.courseText ?? '' }
  return codes[0] ? { courseText: codes[0] } : {}
}

// ── the parse ───────────────────────────────────────────────────────────

/** A kind or a course read on a line of its own, applied to the next line(s). */
interface Carried {
  kind?: string
  course?: { projectId?: string; courseText?: string }
  text: string
  ttl: number
}

/** Pieces of the paste that may each hold one exam (lines, then `;`-separated parts). */
function segments(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line) => line.split(/[;；]/))
    .map((piece) => piece.replace(/\s+$/g, ''))
    .filter((piece) => piece.trim().length > 0)
}

export function parseExamPaste(text: string, options: PasteParseOptions = {}): PasteParseResult {
  const now = options.now ?? Date.now()
  const courses = options.courses ?? []
  const exams: PastedExam[] = []
  // A kind or a course on a line of its own applies to the next line(s).
  let carried = null as Carried | null
  const pieces = segments(text)
  for (const piece of pieces) {
    const date = findDate(piece)
    const kind = findKind(piece)
    const course = matchCourse(piece, courses)
    if (!date) {
      const prev: Carried | null = carried
      if (kind || course.projectId || course.courseText)
        carried = {
          ...(kind ? { kind } : prev?.kind ? { kind: prev.kind } : {}),
          course: course.projectId || course.courseText ? course : (prev?.course ?? {}),
          text: piece.trim(),
          ttl: 2,
        }
      else if (prev && --prev.ttl <= 0) carried = null
      continue
    }
    const uncertain: PasteDoubt[] = []
    const name = kind ?? carried?.kind
    const theCourse = course.projectId || course.courseText ? course : (carried?.course ?? {})
    if (!name) {
      // A date with neither an exam word nor a course is a class, a deadline…
      // unless it is all that was pasted, or the course is already known.
      const alone = pieces.length === 1 || !!options.defaultProjectId
      if (!theCourse.projectId && !theCourse.courseText && !alone) continue
      uncertain.push('no-kind')
    }
    const weekday = weekdayOf(piece)
    let year = date.year
    if (year === undefined) year = inferYear(date.month, date.day, now, weekday)
    if (!validDate(year, date.month, date.day)) continue
    if (date.ambiguous) uncertain.push('ambiguous-date')
    if (weekday !== undefined && new Date(year, date.month - 1, date.day).getDay() !== weekday)
      uncertain.push('weekday-mismatch')
    const { time, durationMinutes } = readTime(piece, date)
    const duration = durationMinutes ?? readDuration(piece.slice(date.end))
    const location = readLocation(piece)
    const projectId = theCourse.projectId ?? options.defaultProjectId
    const source =
      carried && !kind && carried.kind ? `${carried.text}\n${piece.trim()}` : piece.trim()
    exams.push({
      name: tidyName(name ?? ''),
      date: keyOf(year, date.month, date.day),
      time,
      ...(duration ? { durationMinutes: duration } : {}),
      ...(location ? { location } : {}),
      ...(theCourse.courseText ? { courseText: theCourse.courseText } : {}),
      ...(projectId ? { projectId } : {}),
      sourceText: source,
      uncertain,
      origin: 'local',
    })
    carried = null
  }
  // The same exam written twice (a heading and a table row) is kept once.
  const unique = exams.filter(
    (exam, i) =>
      exams.findIndex(
        (other) =>
          other.date === exam.date &&
          other.time === exam.time &&
          other.name.toLowerCase() === exam.name.toLowerCase() &&
          other.projectId === exam.projectId,
      ) === i,
  )
  return {
    exams: unique,
    confident: unique.length > 0 && unique.every((exam) => exam.uncertain.length === 0),
  }
}

// ── duplicates of saved exams ───────────────────────────────────────────

export interface ExistingExam {
  id: string
  projectId: string
  name: string
  at: number
}

function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.:：()（）]/g, '')
  return norm(a) === norm(b)
}

/**
 * The saved exam a draft repeats: same course and day, and the same name or
 * the same start time. Undefined when there is none.
 */
export function findDuplicate(
  draft: { projectId?: string; name: string; date: string; time: string },
  exams: readonly ExistingExam[],
): ExistingExam | undefined {
  if (!draft.projectId || !draft.date) return undefined
  return exams.find((exam) => {
    if (exam.projectId !== draft.projectId || dayKey(exam.at) !== draft.date) return false
    const d = new Date(exam.at)
    const time = hhmm(d.getHours(), d.getMinutes())
    return sameName(exam.name, draft.name) || (!!draft.time && draft.time === time)
  })
}

/** Whitespace-insensitive "is this quote in the paste" (NFKC, case kept). */
export function appearsVerbatim(quote: string, text: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const q = norm(quote)
  return q.length >= 4 && norm(text).includes(q)
}

// ── checking an AI reply ────────────────────────────────────────────────

export interface ExtractCheckOptions {
  now?: number
  courses?: readonly PasteCourse[]
  defaultProjectId?: string
  /** The pasted text (`sourceText` must appear in it). Absent for an image. */
  text?: string
}

/**
 * Keep the exams of an `exam-schedule-extract` reply that can be trusted:
 * - `sourceText` appears verbatim in the pasted text (an image has no text
 *   to check against), and where the local parser can read a date from
 *   `sourceText` it is the same month and day;
 * - `date` is a real calendar day (a `MM-DD` date gets the next occurrence);
 * - `time` is `HH:MM` (else no time); the course is matched locally.
 * Returns the kept exams and how many were dropped.
 */
export function checkExtractedExams(
  raw: unknown,
  options: ExtractCheckOptions,
): { exams: PastedExam[]; dropped: number } {
  const now = options.now ?? Date.now()
  const list = (raw as { exams?: unknown } | null)?.exams
  const rows = Array.isArray(list) ? list.slice(0, 40) : []
  const exams: PastedExam[] = []
  let dropped = 0
  for (const item of rows) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const sourceText = typeof row.sourceText === 'string' ? row.sourceText.trim() : ''
    let date = typeof row.date === 'string' ? row.date.trim() : ''
    const short = /^(\d{1,2})-(\d{1,2})$/.exec(date)
    if (short) {
      const month = Number(short[1])
      const day = Number(short[2])
      date = keyOf(inferYear(month, day, now), month, day)
    }
    const verified =
      (options.text ? appearsVerbatim(sourceText, options.text) : sourceText.length >= 4) &&
      agreesWithSource(sourceText, date)
    if (!verified || !isRealDate(date)) {
      dropped += 1
      continue
    }
    const rawTime = typeof row.time === 'string' ? row.time.trim() : ''
    const tm = /^(\d{1,2}):(\d{2})$/.exec(rawTime)
    const time =
      tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? hhmm(Number(tm[1]), Number(tm[2])) : ''
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, 80) : ''
    const courseText = typeof row.course === 'string' ? row.course.trim().slice(0, 80) : ''
    const matched = matchCourse(`${courseText} ${sourceText}`, options.courses ?? [])
    const projectId = matched.projectId ?? options.defaultProjectId
    const duration = Number(row.durationMinutes)
    const location = typeof row.location === 'string' ? row.location.trim().slice(0, 60) : ''
    exams.push({
      name: name || findKind(sourceText) || '',
      date,
      time,
      ...(Number.isFinite(duration) && duration > 0 && duration <= 720
        ? { durationMinutes: Math.round(duration) }
        : {}),
      ...(location ? { location } : {}),
      ...(courseText || matched.courseText
        ? { courseText: courseText || matched.courseText! }
        : {}),
      ...(projectId ? { projectId } : {}),
      sourceText,
      uncertain: name ? [] : ['no-kind'],
      origin: 'ai',
    })
  }
  return { exams, dropped }
}

/** An image reply: where the source text names a date the parser can read, it must agree. */
function agreesWithSource(sourceText: string, date: string): boolean {
  const hit = findDate(sourceText)
  if (!hit) return true
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const month = Number(m[1])
  const day = Number(m[2])
  return (
    (hit.month === month && hit.day === day) ||
    (!!hit.ambiguous && hit.month === day && hit.day === month)
  )
}
