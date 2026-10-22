import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { VocabRepository } from '@/entities/vocab/repository'
import { UserRepository } from '@/entities/user/repository'
import {
  DEFAULT_VOCAB_SETTINGS,
  EXAM_LABEL_KEYS,
  TAG_ORDER,
  courseEntryPriority,
  examBookId,
  examTagOf,
  grammarLine,
  type DictEntry,
  type ExamTag,
  type ExportFormat,
  type SessionItem,
  type VocabBook,
  type VocabCard,
  type VocabEntry,
  type VocabMode,
  type VocabRating,
  type VocabSettings,
  type WordView,
} from '@/entities/vocab/types'
import {
  dueForExamWeek,
  isLearning,
  isMature,
  newVocabCard,
  previewVocabIntervals,
  scheduleVocabCard,
  type ScheduleContext,
} from '@/entities/vocab/schedule'
import {
  buildLemmaIndex,
  clozeOf,
  formatExport,
  lemmaOf,
  normalizeWord,
  parseWordList,
  rootHints,
  wordKey,
  type ExportRow,
  type RootEntry,
} from '@/entities/vocab/text'
import { isEnglish, primaryLanguage } from '@/shared/lib/language'
import { loadDictionary, loadRoots } from '@/infrastructure/vocab/wordData'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { t, type TranslationKey } from '@/i18n'

const DAY_MS = 24 * 60 * 60 * 1000
/** Reviews offered in one session at most (the rest stay due). */
const MAX_SESSION_REVIEWS = 200
export const MAX_DAILY_NEW = 200

export interface BookSummary {
  id: string
  kind: 'exam' | 'course' | 'custom'
  /** Exam books are named by a translation key; stored books by their name. */
  name: string
  nameKey?: TranslationKey
  projectId?: string
  /** Stored books in another language than English. */
  language?: string
  wordCount: number
  learned: number
}

export interface VocabStats {
  /** Reviews due in the current book (all books when none is chosen). */
  due: number
  /** Reviews due across every book, the current one included. */
  dueAllBooks: number
  newToday: number
  dailyNew: number
  reviewsToday: number
  learned: number
  mature: number
  /** 顽固词 (words forgotten again and again). */
  leeches: number
  /** Consecutive days with at least one review, up to today (or yesterday). */
  streak: number
  /** Words falling due on each of the next seven days (today first). */
  forecast: number[]
}

export interface WordDetails {
  view: WordView
  card?: VocabCard
  roots: RootEntry[]
}

export function startOfDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The dictionary with a lookup by headword and a form → headword index, built once. */
let indexed: Promise<{
  entries: DictEntry[]
  byWord: Map<string, DictEntry>
  lemmas: Map<string, string>
}> | null = null

/** Test helper: forget the indexed dictionary (after swapping the data loader). */
export function resetVocabIndexForTesting(): void {
  indexed = null
}

export async function vocabIndex() {
  indexed ??= loadDictionary().then((entries) => ({
    entries,
    byWord: new Map(entries.map((entry) => [normalizeWord(entry.word), entry])),
    lemmas: buildLemmaIndex(entries),
  }))
  indexed.catch(() => (indexed = null))
  return indexed
}

/** Due now, or a course-exam word that must be seen in the exam's final week. */
function isDueNow(card: VocabCard, now: number, examAt: number | undefined): boolean {
  return card.due <= now || (examAt !== undefined && dueForExamWeek(card, examAt, now))
}

/** Seconds a review / a new word takes on average (for the study plan's estimate). */
const REVIEW_SECONDS = 10
const NEW_WORD_SECONDS = 25

/** Today's vocabulary load for the study plan. */
export interface DailyVocabLoad {
  /** Reviews due today (course words only when a course is given). */
  due: number
  /** New words still to learn today (within the daily limit). */
  new: number
  /** Rough minutes for both. */
  estimatedMinutes: number
}

/** When a word comes back, for the word list and after a rating. */
export interface WordSchedule {
  due: number
  leech: boolean
  /** Still in the short learning / relearning steps. */
  learning: boolean
  reps: number
}

function viewOfEntry(entry: DictEntry): WordView {
  return {
    word: entry.word,
    phonetic: entry.phonetic,
    meanings: entry.meanings,
    tags: entry.tags,
    forms: entry.forms,
  }
}

/**
 * Word books, daily study sessions and progress. Progress is stored per word
 * (FSRS cards); exam books come from the shipped dictionary, course and
 * custom books from their own entries.
 */
export class VocabService {
  private repo: VocabRepository
  private users: UserRepository
  private db: AppDatabase

  constructor(db: AppDatabase = getDb()) {
    this.db = db
    this.repo = new VocabRepository(db)
    this.users = new UserRepository(db)
  }

  async settings(): Promise<VocabSettings> {
    const profile = await this.users.get().catch(() => undefined)
    return {
      bookId: profile?.vocabBookId || DEFAULT_VOCAB_SETTINGS.bookId,
      dailyNew: profile?.vocabDailyNew ?? DEFAULT_VOCAB_SETTINGS.dailyNew,
      reviewMode: profile?.vocabReviewMode ?? DEFAULT_VOCAB_SETTINGS.reviewMode,
    }
  }

  async updateSettings(patch: Partial<VocabSettings>): Promise<VocabSettings> {
    await this.users.update({
      ...(patch.bookId ? { vocabBookId: patch.bookId } : {}),
      ...(patch.dailyNew !== undefined
        ? { vocabDailyNew: Math.max(1, Math.min(MAX_DAILY_NEW, Math.round(patch.dailyNew))) }
        : {}),
      ...(patch.reviewMode ? { vocabReviewMode: patch.reviewMode } : {}),
    })
    return this.settings()
  }

  // ---------------------------------------------------------------- books

  async books(): Promise<BookSummary[]> {
    const [{ entries }, cards, stored] = await Promise.all([
      vocabIndex(),
      this.repo.listCards(),
      this.repo.listBooks(),
    ])
    const learned = new Set(cards.map((card) => card.word))
    const exam: BookSummary[] = TAG_ORDER.map((tag) => {
      const words = entries.filter((entry) => entry.tags.includes(tag))
      return {
        id: examBookId(tag),
        kind: 'exam',
        name: tag,
        nameKey: EXAM_LABEL_KEYS[tag],
        wordCount: words.length,
        learned: words.filter((entry) => learned.has(normalizeWord(entry.word))).length,
      }
    })
    const own = await Promise.all(
      stored
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(async (book): Promise<BookSummary> => {
          const words = await this.repo.listEntries(book.id)
          return {
            id: book.id,
            kind: book.kind,
            name: book.name,
            ...(book.projectId ? { projectId: book.projectId } : {}),
            ...(!isEnglish(book.language) ? { language: book.language } : {}),
            wordCount: words.length,
            learned: words.filter((entry) => learned.has(entry.word)).length,
          }
        }),
    )
    return [...exam, ...own]
  }

  /** The words of a book in study order. */
  async bookWords(bookId: string): Promise<WordView[]> {
    const tag = examTagOf(bookId)
    if (tag) {
      const { entries } = await vocabIndex()
      return entries.filter((entry) => entry.tags.includes(tag)).map(viewOfEntry)
    }
    const entries = await this.repo.listEntries(bookId)
    const book = await this.repo.getBook(bookId)
    const language = book?.language
    // A course book: looked-up words and the exam's key terms first.
    const ordered =
      book?.kind === 'course'
        ? entries.sort(
            (a, b) => courseEntryPriority(b) - courseEntryPriority(a) || a.createdAt - b.createdAt,
          )
        : entries.sort((a, b) => a.createdAt - b.createdAt)
    return Promise.all(ordered.map((entry) => this.viewOfStored(entry, language)))
  }

  /** Language of a book when it is not English (exam books are English). */
  async bookLanguage(bookId: string | null | undefined): Promise<string | undefined> {
    if (!bookId || examTagOf(bookId)) return undefined
    const language = (await this.repo.getBook(bookId))?.language
    return isEnglish(language) ? undefined : language
  }

  /** Book id → language, for the stored books not in English. */
  private async languages(): Promise<Map<string, string>> {
    const books = await this.repo.listBooks()
    return new Map(
      books
        .filter((book) => !isEnglish(book.language))
        .map((book) => [book.id, book.language!] as const),
    )
  }

  async bookEntries(bookId: string): Promise<VocabEntry[]> {
    return this.repo.listEntries(bookId)
  }

  async deleteBook(bookId: string): Promise<void> {
    if (examTagOf(bookId)) throw new ValidationError(t('vocab.cannotDeleteExam'))
    await this.repo.deleteBook(bookId)
    const settings = await this.settings()
    if (settings.bookId === bookId) await this.users.update({ vocabBookId: '' })
  }

  async removeEntry(id: string): Promise<void> {
    await this.repo.deleteEntry(id)
  }

  /**
   * A stored word as shown: the dictionary's phonetic and meanings unless the
   * book has its own. Words of another language are never looked up in the
   * (English) dictionary.
   */
  private async viewOfStored(entry: VocabEntry, language?: string): Promise<WordView> {
    if (!isEnglish(language)) {
      const grammar = grammarLine(entry)
      return {
        word: entry.word,
        phonetic: entry.phonetic ?? '',
        meanings: entry.meanings,
        tags: [],
        ...(grammar ? { grammar } : {}),
        ...(entry.context ? { context: entry.context } : {}),
      }
    }
    const { byWord } = await vocabIndex()
    const known = byWord.get(entry.word)
    return {
      word: entry.word,
      phonetic: entry.phonetic || known?.phonetic || '',
      meanings: entry.meanings.length ? entry.meanings : (known?.meanings ?? []),
      tags: known?.tags ?? [],
      ...(known?.forms.length ? { forms: known.forms } : {}),
      ...(entry.context ? { context: entry.context } : {}),
    }
  }

  /**
   * Everything known about a word: dictionary entry, course context, progress,
   * root hints (English only: the roots are English and Latin affixes).
   */
  async details(word: string, language?: string): Promise<WordDetails> {
    const key = wordKey(word, language)
    const english = isEnglish(language)
    const [view, card, roots] = await Promise.all([
      this.view(key, language),
      this.repo.getCard(key),
      english ? loadRoots().catch(() => []) : Promise.resolve([]),
    ])
    return { view, ...(card ? { card } : {}), roots: english ? rootHints(key, roots) : [] }
  }

  /**
   * The view of any word: the dictionary, enriched by a course sentence when
   * there is one. A word of another `language` comes from its books only.
   */
  async view(word: string, language?: string): Promise<WordView> {
    const key = wordKey(word, language)
    if (!isEnglish(language)) {
      const stored = await this.repo.entriesForWord(key)
      const pick =
        stored.find((entry) => entry.meanings.length && entry.context) ??
        stored.find((entry) => entry.meanings.length) ??
        stored.find((entry) => entry.context) ??
        stored[0]
      if (pick) return this.viewOfStored(pick, language)
      return { word: key, phonetic: '', meanings: [], tags: [] }
    }
    const [{ byWord }, stored] = await Promise.all([vocabIndex(), this.repo.entriesForWord(key)])
    const withContext = stored.find((entry) => entry.context) ?? stored[0]
    const known = byWord.get(key)
    if (withContext) {
      const fromBook = await this.viewOfStored(withContext)
      return {
        ...fromBook,
        ...(known && fromBook.meanings.length === 0 ? { meanings: known.meanings } : {}),
      }
    }
    if (known) return viewOfEntry(known)
    return { word: key, phonetic: '', meanings: [], tags: [] }
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Today's session: due reviews first (earliest first), then new words from
   * the current book up to the daily limit.
   */
  async session(now = Date.now()): Promise<SessionItem[]> {
    const settings = await this.settings()
    const [cards, languages, examWords] = await Promise.all([
      this.repo.listCards(),
      this.languages(),
      this.examWords(now),
    ])
    // 顽固词 first, then the rest by due date.
    const due = (await this.dueInBook(cards, settings.bookId, now, languages, examWords))
      .sort((a, b) => Number(Boolean(b.leech)) - Number(Boolean(a.leech)))
      .slice(0, MAX_SESSION_REVIEWS)
    const items: SessionItem[] = []
    for (const card of due) {
      const language = languages.get(card.bookId)
      const view = await this.view(card.word, language)
      items.push({
        view,
        kind: 'review',
        mode: this.reviewMode(card, view, settings, language),
        ...(language ? { language } : {}),
        ...(card.leech ? { leech: true } : {}),
      })
    }
    if (settings.bookId) {
      const newToday = cards.filter((card) => card.addedAt >= startOfDay(now)).length
      const room = Math.max(0, settings.dailyNew - newToday)
      if (room > 0) {
        const language = languages.get(settings.bookId)
        const known = new Set(cards.map((card) => card.word))
        const fresh = (await this.bookWords(settings.bookId))
          .filter((view) => !known.has(wordKey(view.word, language)))
          .slice(0, room)
        for (const view of fresh)
          items.push({ view, kind: 'new', mode: 'learn', ...(language ? { language } : {}) })
      }
    }
    return items
  }

  /**
   * Due cards of the current book, earliest first: cards added from it, and
   * words of it learned elsewhere in the same language (progress is global).
   * A German card never shows up in an English book's session. Without a
   * chosen book every due card counts.
   */
  private async dueInBook(
    cards: VocabCard[],
    bookId: string | null | undefined,
    now: number,
    languages: Map<string, string>,
    /** Course-exam words (word → next exam): due in the exam's final week too. */
    examWords: Map<string, number> = new Map(),
  ): Promise<VocabCard[]> {
    const due = cards
      .filter((card) => isDueNow(card, now, examWords.get(card.word)))
      .sort((a, b) => a.due - b.due)
    if (!bookId) return due
    const language = languages.get(bookId)
    const words = new Set(
      (await this.bookWords(bookId)).map((view) => wordKey(view.word, language)),
    )
    return due.filter(
      (card) =>
        card.bookId === bookId || (languages.get(card.bookId) === language && words.has(card.word)),
    )
  }

  /** Spelling practice of the words misspelled before, most recent first. */
  async mistakeSession(): Promise<SessionItem[]> {
    const [all, languages] = await Promise.all([this.repo.listCards(), this.languages()])
    const cards = all.filter((card) => card.mistakes > 0)
    cards.sort((a, b) => (b.lastMistakeAt ?? 0) - (a.lastMistakeAt ?? 0))
    return Promise.all(
      cards.map(async (card): Promise<SessionItem> => {
        const language = languages.get(card.bookId)
        return {
          view: await this.view(card.word, language),
          kind: 'review',
          mode: 'spell',
          ...(language ? { language } : {}),
        }
      }),
    )
  }

  /**
   * How a review is practised. New and shaky words are recognised first;
   * settled ones rotate through spelling, the course sentence with a blank,
   * and dictation. A fixed preference wins.
   */
  reviewMode(
    card: VocabCard,
    view: WordView,
    settings: VocabSettings,
    language?: string,
  ): VocabMode {
    if (settings.reviewMode !== 'auto') return settings.reviewMode
    // A 顽固词 starts from recognition (with its sentence and root hints).
    if (isLearning(card) || card.reps < 2 || card.leech) return 'recognize'
    const cycle: VocabMode[] = ['spell', 'cloze', 'dictation']
    const pick = cycle[card.reps % cycle.length]!
    if (
      pick === 'cloze' &&
      !(view.context && clozeOf(view.context.text, view.word, view.forms, language))
    )
      return 'spell'
    return pick
  }

  /** Rate a word. Wrong spellings are counted for the mistake list. */
  async grade(
    word: string,
    rating: VocabRating,
    mode: VocabMode,
    options: { correct?: boolean; bookId?: string; now?: number; language?: string } = {},
  ): Promise<VocabCard> {
    const now = options.now ?? Date.now()
    const key = wordKey(word, options.language)
    const existing = await this.repo.getCard(key)
    const base =
      existing ??
      newVocabCard(key, options.bookId ?? (await this.settings()).bookId ?? 'unknown', now)
    let next = scheduleVocabCard(base, rating, now, await this.scheduleContext(key, now))
    // Only a typed answer that was wrong ("forgot", rating 1) counts toward the
    // mistake list; a near miss (one letter off, rating 2) does not.
    if (options.correct === false && rating === 1) {
      next = { ...next, mistakes: next.mistakes + 1, lastMistakeAt: now }
    }
    // Card and review log together: today's counts and the streak read the log.
    await this.db.transaction('rw', this.db.vocabCards, this.db.vocabReviews, async () => {
      await this.repo.putCard(next)
      await this.repo.addReview({
        id: crypto.randomUUID(),
        word: key,
        rating,
        mode,
        ...(options.correct !== undefined ? { correct: options.correct } : {}),
        at: now,
      })
    })
    return next
  }

  /** Time each rating would postpone the word (a new word previews from scratch). */
  async previewIntervals(
    word: string,
    now = Date.now(),
    language?: string,
  ): Promise<Record<VocabRating, number>> {
    const key = wordKey(word, language)
    const card = (await this.repo.getCard(key)) ?? newVocabCard(key, 'preview', now)
    return previewVocabIntervals(card, now, await this.scheduleContext(key, now))
  }

  /** What a review of `word` needs beyond FSRS: its recent ratings and its next course exam. */
  private async scheduleContext(word: string, now: number): Promise<ScheduleContext> {
    const [reviews, examAt] = await Promise.all([
      this.repo.reviewsOf(word),
      this.examAtFor(word, now),
    ])
    return {
      recent: reviews.map((review) => review.rating),
      ...(examAt !== undefined ? { examAt } : {}),
    }
  }

  /**
   * Next exam (epoch ms) of each course with one ahead, from the study plan's
   * exams (`exams` table). Empty when there is no such table or no exam.
   */
  private async upcomingExams(now: number): Promise<Map<string, number>> {
    const exams = new Map<string, number>()
    if (!this.db.tables.some((table) => table.name === 'exams')) return exams
    try {
      const rows = await this.db
        .table<{ projectId?: string; at?: number }>('exams')
        .where('at')
        .above(now)
        .toArray()
      for (const row of rows) {
        if (!row.projectId || typeof row.at !== 'number') continue
        const known = exams.get(row.projectId)
        if (known === undefined || row.at < known) exams.set(row.projectId, row.at)
      }
    } catch {
      // No exams to plan around.
    }
    return exams
  }

  /** The next exam of any course whose book has this word. */
  private async examAtFor(word: string, now: number): Promise<number | undefined> {
    const exams = await this.upcomingExams(now)
    if (exams.size === 0) return undefined
    let at: number | undefined
    for (const entry of await this.repo.entriesForWord(word)) {
      const exam = entry.projectId ? exams.get(entry.projectId) : undefined
      if (exam !== undefined && (at === undefined || exam < at)) at = exam
    }
    return at
  }

  /** Every course-exam word with its next exam (for the final-week guarantee). */
  private async examWords(now: number): Promise<Map<string, number>> {
    const exams = await this.upcomingExams(now)
    const words = new Map<string, number>()
    for (const [projectId, at] of exams) {
      const book = await this.repo.findCourseBook(projectId)
      if (!book) continue
      for (const entry of await this.repo.listEntries(book.id)) {
        const known = words.get(entry.word)
        if (known === undefined || at < known) words.set(entry.word, at)
      }
    }
    return words
  }

  /**
   * When each word comes back (only words with progress), for the word list
   * and the line shown after a rating. Words of another `language` keep their case.
   */
  async schedules(words: string[], language?: string): Promise<Map<string, WordSchedule>> {
    const result = new Map<string, WordSchedule>()
    const cards = new Map((await this.repo.listCards()).map((card) => [card.word, card]))
    for (const word of words) {
      const card = cards.get(wordKey(word, language))
      if (card)
        result.set(word, {
          due: card.due,
          leech: Boolean(card.leech),
          learning: isLearning(card),
          reps: card.reps,
        })
    }
    return result
  }

  /** 顽固词 so far, most recent first. */
  async leeches(): Promise<Array<{ view: WordView; card: VocabCard }>> {
    const [all, languages] = await Promise.all([this.repo.listCards(), this.languages()])
    const cards = all.filter((card) => card.leech)
    cards.sort((a, b) => (b.leechAt ?? 0) - (a.leechAt ?? 0))
    return Promise.all(
      cards.map(async (card) => ({
        view: await this.view(card.word, languages.get(card.bookId)),
        card,
      })),
    )
  }

  /**
   * Today's vocabulary task for the study plan: due reviews and the new
   * words still allowed today, with a time estimate. With a course, only its
   * course book counts (its words due anywhere, its unlearned words as new);
   * without one, the current book (as `session` would build it).
   */
  async planDailyLoad(projectId?: string, now = Date.now()): Promise<DailyVocabLoad> {
    const settings = await this.settings()
    const [cards, languages, examWords] = await Promise.all([
      this.repo.listCards(),
      this.languages(),
      this.examWords(now),
    ])
    const newToday = cards.filter((card) => card.addedAt >= startOfDay(now)).length
    const room = Math.max(0, settings.dailyNew - newToday)
    let due: number
    let fresh: number
    if (projectId) {
      const book = await this.repo.findCourseBook(projectId)
      const entries = book ? await this.repo.listEntries(book.id) : []
      const words = new Set(entries.map((entry) => entry.word))
      const byWord = new Map(cards.map((card) => [card.word, card]))
      due = cards.filter(
        (card) => words.has(card.word) && isDueNow(card, now, examWords.get(card.word)),
      ).length
      fresh = Math.min(room, entries.filter((entry) => !byWord.has(entry.word)).length)
    } else {
      due = Math.min(
        MAX_SESSION_REVIEWS,
        (await this.dueInBook(cards, settings.bookId, now, languages, examWords)).length,
      )
      if (settings.bookId && room > 0) {
        const language = languages.get(settings.bookId)
        const known = new Set(cards.map((card) => card.word))
        fresh = Math.min(
          room,
          (await this.bookWords(settings.bookId)).filter(
            (view) => !known.has(wordKey(view.word, language)),
          ).length,
        )
      } else fresh = 0
    }
    const seconds = due * REVIEW_SECONDS + fresh * NEW_WORD_SECONDS
    return {
      due,
      new: fresh,
      estimatedMinutes: seconds === 0 ? 0 : Math.max(1, Math.ceil(seconds / 60)),
    }
  }

  /** Take a word off the mistake list (it stays in the review schedule). */
  async clearMistakes(word: string): Promise<void> {
    // The word as stored (other languages keep their case), else lower-cased (English).
    const card = (await this.repo.getCard(word)) ?? (await this.repo.getCard(normalizeWord(word)))
    if (card) await this.repo.putCard({ ...card, mistakes: 0 })
  }

  async mistakes(): Promise<Array<{ view: WordView; card: VocabCard }>> {
    const [all, languages] = await Promise.all([this.repo.listCards(), this.languages()])
    const cards = all.filter((card) => card.mistakes > 0)
    cards.sort((a, b) => b.mistakes - a.mistakes || (b.lastMistakeAt ?? 0) - (a.lastMistakeAt ?? 0))
    return Promise.all(
      cards.map(async (card) => ({
        view: await this.view(card.word, languages.get(card.bookId)),
        card,
      })),
    )
  }

  async stats(now = Date.now()): Promise<VocabStats> {
    const [settings, cards, reviews, languages, examWords] = await Promise.all([
      this.settings(),
      this.repo.listCards(),
      this.repo.listReviews(),
      this.languages(),
      this.examWords(now),
    ])
    const dueHere = await this.dueInBook(cards, settings.bookId, now, languages, examWords)
    const today = startOfDay(now)
    const days = new Set(reviews.map((review) => startOfDay(review.at)))
    let streak = 0
    let day = days.has(today) ? today : startOfDay(today - DAY_MS / 2)
    while (days.has(day)) {
      streak++
      day = startOfDay(day - DAY_MS / 2)
    }
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const end = today + (i + 1) * DAY_MS
      const start = i === 0 ? -Infinity : today + i * DAY_MS
      return cards.filter((card) => card.due < end && card.due >= start).length
    })
    return {
      due: dueHere.length,
      dueAllBooks: cards.filter((card) => card.due <= now).length,
      newToday: cards.filter((card) => card.addedAt >= today).length,
      dailyNew: settings.dailyNew,
      reviewsToday: reviews.filter((review) => review.at >= today).length,
      learned: cards.length,
      mature: cards.filter(isMature).length,
      leeches: cards.filter((card) => card.leech).length,
      streak,
      forecast,
    }
  }

  // ---------------------------------------------------------------- import / export

  /**
   * A custom book from a pasted or uploaded list ("word" or "word<TAB>meaning"
   * per line). English words without a meaning take the dictionary's; a list
   * in another `language` (BCP-47) keeps its words as written and has only
   * the meanings it brings.
   */
  async importList(
    name: string,
    text: string,
    now = Date.now(),
    language?: string,
  ): Promise<{ book: VocabBook; added: number; skipped: number; withoutMeaning: number }> {
    const english = isEnglish(language)
    const { words, skipped } = parseWordList(text, english ? {} : { language })
    if (words.length === 0) throw new ValidationError(t('vocab.importEmpty'))
    const { byWord, lemmas } = english
      ? await vocabIndex()
      : { byWord: new Map<string, DictEntry>(), lemmas: new Map<string, string>() }
    const book: VocabBook = {
      id: crypto.randomUUID(),
      kind: 'custom',
      name: name.trim() || t('vocab.importDefaultName'),
      ...(english ? {} : { language: primaryLanguage(language)! }),
      createdAt: now,
      updatedAt: now,
    }
    let withoutMeaning = 0
    const entries: VocabEntry[] = words.map(({ word, meaning }, i) => {
      const lemma =
        !english || byWord.has(word) ? word : lemmaOf(word, lemmas, (w) => byWord.has(w))
      const known = byWord.get(lemma) ?? byWord.get(word)
      const meanings = meaning ? [meaning] : (known?.meanings ?? [])
      if (meanings.length === 0) withoutMeaning++
      return {
        id: crypto.randomUUID(),
        bookId: book.id,
        word,
        ...(known?.phonetic ? { phonetic: known.phonetic } : {}),
        meanings,
        glossBy: meaning ? 'user' : known ? 'dictionary' : 'none',
        // Keep the list's own order.
        createdAt: now + i,
      }
    })
    await this.repo.putBook(book)
    await this.repo.putEntries(entries)
    return { book, added: entries.length, skipped, withoutMeaning }
  }

  /**
   * A word list for another app: a book, everything learned so far, or the
   * mistake list.
   */
  async export(
    target: { bookId: string } | 'learned' | 'mistakes',
    format: ExportFormat,
  ): Promise<{ filename: string; content: string; mimeType: string }> {
    let views: WordView[]
    let label: string
    if (target === 'learned' || target === 'mistakes') {
      const [all, languages] = await Promise.all([this.repo.listCards(), this.languages()])
      const cards = all.filter((card) => target === 'learned' || card.mistakes > 0)
      cards.sort((a, b) => a.addedAt - b.addedAt)
      views = await Promise.all(
        cards.map((card) => this.view(card.word, languages.get(card.bookId))),
      )
      label = target === 'learned' ? 'learned' : 'mistakes'
    } else {
      views = await this.bookWords(target.bookId)
      const tag = examTagOf(target.bookId) as ExamTag | null
      label = tag ?? (await this.repo.getBook(target.bookId))?.name ?? 'words'
    }
    const rows: ExportRow[] = views.map((view) => ({
      word: view.word,
      phonetic: view.phonetic,
      meanings: view.meanings,
      ...(view.context ? { context: view.context } : {}),
      tags: [...new Set([label.replace(/\s+/g, '_'), ...view.tags])],
    }))
    const extension = format === 'csv' ? 'csv' : 'txt'
    const safe = label.replace(/[\\/:*?"<>|\s]+/g, '-')
    return {
      filename: `vocab-${safe}-${format}.${extension}`,
      content: formatExport(rows, format),
      mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
    }
  }
}
