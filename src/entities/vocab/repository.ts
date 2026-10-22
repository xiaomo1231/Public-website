import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { VocabBook, VocabCard, VocabEntry, VocabReview } from './types'

export class VocabRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  // Cards (progress, keyed by word)
  getCard(word: string): Promise<VocabCard | undefined> {
    return this.db.vocabCards.get(word)
  }
  listCards(): Promise<VocabCard[]> {
    return this.db.vocabCards.toArray()
  }
  /** Cards due at or before `now`, earliest first. */
  dueCards(now: number, limit: number): Promise<VocabCard[]> {
    return this.db.vocabCards.where('due').belowOrEqual(now).limit(limit).sortBy('due')
  }
  async putCard(card: VocabCard): Promise<VocabCard> {
    await this.db.vocabCards.put(card)
    return card
  }

  // Books and their entries
  listBooks(): Promise<VocabBook[]> {
    return this.db.vocabBooks.toArray()
  }
  getBook(id: string): Promise<VocabBook | undefined> {
    return this.db.vocabBooks.get(id)
  }
  findCourseBook(projectId: string): Promise<VocabBook | undefined> {
    return this.db.vocabBooks.where('projectId').equals(projectId).first()
  }
  async putBook(book: VocabBook): Promise<VocabBook> {
    await this.db.vocabBooks.put(book)
    return book
  }
  listEntries(bookId: string): Promise<VocabEntry[]> {
    return this.db.vocabEntries.where('bookId').equals(bookId).toArray()
  }
  /** Course or custom entries for a word, in any book. */
  entriesForWord(word: string): Promise<VocabEntry[]> {
    return this.db.vocabEntries.where('word').equals(word).toArray()
  }
  async putEntries(entries: VocabEntry[]): Promise<void> {
    if (entries.length) await this.db.vocabEntries.bulkPut(entries)
  }
  deleteEntry(id: string): Promise<void> {
    return this.db.vocabEntries.delete(id)
  }
  /** A book and its entries. Learning progress (cards) stays. */
  async deleteBook(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.vocabBooks, this.db.vocabEntries, async () => {
      await this.db.vocabEntries.where('bookId').equals(id).delete()
      await this.db.vocabBooks.delete(id)
    })
  }
  /** A deleted course takes its course vocabulary with it. */
  async deleteByProject(projectId: string): Promise<void> {
    const books = await this.db.vocabBooks.where('projectId').equals(projectId).primaryKeys()
    for (const id of books) await this.deleteBook(id)
    // Entries tagged with the course whose book is already gone (orphans).
    await this.db.vocabEntries.where('projectId').equals(projectId).delete()
  }

  // Review log
  async addReview(review: VocabReview): Promise<void> {
    await this.db.vocabReviews.add(review)
  }
  reviewsSince(since: number): Promise<VocabReview[]> {
    return this.db.vocabReviews.where('at').aboveOrEqual(since).toArray()
  }
  listReviews(): Promise<VocabReview[]> {
    return this.db.vocabReviews.toArray()
  }
}
