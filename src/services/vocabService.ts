import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { VocabRepository } from '@/entities/vocab/repository'
import { UserRepository } from '@/entities/user/repository'
import {
  DEFAULT_VOCAB_SETTINGS,
  EXAM_LABEL_KEYS,
  TAG_ORDER,
  examBookId,
  examTagOf,
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
import { isLearning, isMature, newVocabCard, previewVocabIntervals, rateVocabCard } from '@/entities/vocab/schedule'
import {
  buildLemmaIndex,
  clozeOf,
  formatExport,
  lemmaOf,
  normalizeWord,
  parseWordList,
  rootHints,
  type ExportRow,
  type RootEntry,
} from '@/entities/vocab/text'
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
  wordCount: number
  learned: number
}

export interface VocabStats {
  due: number
  newToday: number
  dailyNew: number
  reviewsToday: number
  learned: number
  mature: number
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
let indexed: Promise<{ entries: DictEntry[]; byWord: Map<string, DictEntry>; lemmas: Map<string, string> }> | null = null

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

function viewOfEntry(entry: DictEntry): WordView {
  return { word: entry.word, phonetic: entry.phonetic, meanings: entry.meanings, tags: entry.tags, forms: entry.forms }
}

/**
 * Word books, daily study sessions and progress. Progress is stored per word
 * (FSRS cards); exam books come from the shipped dictionary, course and
 * custom books from their own entries.
 */
export class VocabService {
  private repo: VocabRepository
  private users: UserRepository

  constructor(db: AppDatabase = getDb()) {
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
      ...(patch.dailyNew !== undefined ? { vocabDailyNew: Math.max(1, Math.min(MAX_DAILY_NEW, Math.round(patch.dailyNew))) } : {}),
      ...(patch.reviewMode ? { vocabReviewMode: patch.reviewMode } : {}),
    })
    return this.settings()
  }

  // ---------------------------------------------------------------- books

  async books(): Promise<BookSummary[]> {
    const [{ entries }, cards, stored] = await Promise.all([vocabIndex(), this.repo.listCards(), this.repo.listBooks()])
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
    const ordered =
      book?.kind === 'course'
        ? entries.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0) || a.createdAt - b.createdAt)
        : entries.sort((a, b) => a.createdAt - b.createdAt)
    return Promise.all(ordered.map((entry) => this.viewOfStored(entry)))
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

  /** A stored word as shown: the dictionary's phonetic and meanings unless the book has its own. */
  private async viewOfStored(entry: VocabEntry): Promise<WordView> {
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

  /** Everything known about a word: dictionary entry, course context, progress, root hints. */
  async details(word: string): Promise<WordDetails> {
    const key = normalizeWord(word)
    const [view, card, roots] = await Promise.all([this.view(key), this.repo.getCard(key), loadRoots().catch(() => [])])
    return { view, ...(card ? { card } : {}), roots: rootHints(key, roots) }
  }

  /** The view of any word: the dictionary, enriched by a course sentence when there is one. */
  async view(word: string): Promise<WordView> {
    const key = normalizeWord(word)
    const [{ byWord }, stored] = await Promise.all([vocabIndex(), this.repo.entriesForWord(key)])
    const withContext = stored.find((entry) => entry.context) ?? stored[0]
    const known = byWord.get(key)
    if (withContext) {
      const fromBook = await this.viewOfStored(withContext)
      return { ...fromBook, ...(known && fromBook.meanings.length === 0 ? { meanings: known.meanings } : {}) }
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
    const [due, cards] = await Promise.all([this.repo.dueCards(now, MAX_SESSION_REVIEWS), this.repo.listCards()])
    const items: SessionItem[] = []
    for (const card of due) {
      const view = await this.view(card.word)
      items.push({ view, kind: 'review', mode: this.reviewMode(card, view, settings) })
    }
    if (settings.bookId) {
      const newToday = cards.filter((card) => card.addedAt >= startOfDay(now)).length
      const room = Math.max(0, settings.dailyNew - newToday)
      if (room > 0) {
        const known = new Set(cards.map((card) => card.word))
        const fresh = (await this.bookWords(settings.bookId)).filter((view) => !known.has(normalizeWord(view.word))).slice(0, room)
        for (const view of fresh) items.push({ view, kind: 'new', mode: 'learn' })
      }
    }
    return items
  }

  /** Spelling practice of the words misspelled before, most recent first. */
  async mistakeSession(): Promise<SessionItem[]> {
    const cards = (await this.repo.listCards()).filter((card) => card.mistakes > 0)
    cards.sort((a, b) => (b.lastMistakeAt ?? 0) - (a.lastMistakeAt ?? 0))
    return Promise.all(cards.map(async (card) => ({ view: await this.view(card.word), kind: 'review' as const, mode: 'spell' as const })))
  }

  /**
   * How a review is practised. New and shaky words are recognised first;
   * settled ones rotate through spelling, the course sentence with a blank,
   * and dictation. A fixed preference wins.
   */
  reviewMode(card: VocabCard, view: WordView, settings: VocabSettings): VocabMode {
    if (settings.reviewMode !== 'auto') return settings.reviewMode
    if (isLearning(card) || card.reps < 2) return 'recognize'
    const cycle: VocabMode[] = ['spell', 'cloze', 'dictation']
    const pick = cycle[card.reps % cycle.length]!
    if (pick === 'cloze' && !(view.context && clozeOf(view.context.text, view.word, view.forms))) return 'spell'
    return pick
  }

  /** Rate a word. Wrong spellings are counted for the mistake list. */
  async grade(
    word: string,
    rating: VocabRating,
    mode: VocabMode,
    options: { correct?: boolean; bookId?: string; now?: number } = {},
  ): Promise<VocabCard> {
    const now = options.now ?? Date.now()
    const key = normalizeWord(word)
    const existing = await this.repo.getCard(key)
    const base = existing ?? newVocabCard(key, options.bookId ?? (await this.settings()).bookId ?? 'unknown', now)
    let next = rateVocabCard(base, rating, now)
    // Only a typed answer that was wrong ("forgot", rating 1) counts toward the
    // mistake list; a near miss (one letter off, rating 2) does not.
    if (options.correct === false && rating === 1) {
      next = { ...next, mistakes: next.mistakes + 1, lastMistakeAt: now }
    }
    await this.repo.putCard(next)
    await this.repo.addReview({
      id: crypto.randomUUID(),
      word: key,
      rating,
      mode,
      ...(options.correct !== undefined ? { correct: options.correct } : {}),
      at: now,
    })
    return next
  }

  /** Time each rating would postpone the word (a new word previews from scratch). */
  async previewIntervals(word: string, now = Date.now()): Promise<Record<VocabRating, number>> {
    const key = normalizeWord(word)
    const card = (await this.repo.getCard(key)) ?? newVocabCard(key, 'preview', now)
    return previewVocabIntervals(card, now)
  }

  /** Take a word off the mistake list (it stays in the review schedule). */
  async clearMistakes(word: string): Promise<void> {
    const card = await this.repo.getCard(normalizeWord(word))
    if (card) await this.repo.putCard({ ...card, mistakes: 0 })
  }

  async mistakes(): Promise<Array<{ view: WordView; card: VocabCard }>> {
    const cards = (await this.repo.listCards()).filter((card) => card.mistakes > 0)
    cards.sort((a, b) => b.mistakes - a.mistakes || (b.lastMistakeAt ?? 0) - (a.lastMistakeAt ?? 0))
    return Promise.all(cards.map(async (card) => ({ view: await this.view(card.word), card })))
  }

  async stats(now = Date.now()): Promise<VocabStats> {
    const [settings, cards, reviews] = await Promise.all([this.settings(), this.repo.listCards(), this.repo.listReviews()])
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
      due: cards.filter((card) => card.due <= now).length,
      newToday: cards.filter((card) => card.addedAt >= today).length,
      dailyNew: settings.dailyNew,
      reviewsToday: reviews.filter((review) => review.at >= today).length,
      learned: cards.length,
      mature: cards.filter(isMature).length,
      streak,
      forecast,
    }
  }

  // ---------------------------------------------------------------- import / export

  /**
   * A custom book from a pasted or uploaded list ("word" or "word<TAB>meaning"
   * per line). Words without a meaning take the dictionary's.
   */
  async importList(name: string, text: string, now = Date.now()): Promise<{ book: VocabBook; added: number; skipped: number; withoutMeaning: number }> {
    const { words, skipped } = parseWordList(text)
    if (words.length === 0) throw new ValidationError(t('vocab.importEmpty'))
    const { byWord, lemmas } = await vocabIndex()
    const book: VocabBook = {
      id: crypto.randomUUID(),
      kind: 'custom',
      name: name.trim() || t('vocab.importDefaultName'),
      createdAt: now,
      updatedAt: now,
    }
    let withoutMeaning = 0
    const entries: VocabEntry[] = words.map(({ word, meaning }, i) => {
      const lemma = byWord.has(word) ? word : lemmaOf(word, lemmas, (w) => byWord.has(w))
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
      const cards = (await this.repo.listCards()).filter((card) => target === 'learned' || card.mistakes > 0)
      cards.sort((a, b) => a.addedAt - b.addedAt)
      views = await Promise.all(cards.map((card) => this.view(card.word)))
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
