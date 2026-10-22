import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { NotFoundError, ValidationError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import {
  defaultNoteTitle,
  MAX_NOTE_TITLE,
  MAX_NOTE_TURNS,
  type NoteCardSize,
  type NoteDisplay,
  type NoteWindowRect,
  type WalkthroughNote,
  type WalkthroughNoteTurn,
} from '@/entities/homework/walkthrough'
import type { TextAnchor } from '@/shared/lib/textAnchor'
import { ReviewCardService } from './reviewCardService'
import { t } from '@/i18n'

export interface NewWalkthroughNote {
  setId: string
  sectionId: string
  sectionTitle: string
  quote: string
  latex?: string
  anchor: TextAnchor
  surrounding: string
  turns: WalkthroughNoteTurn[]
  rect?: NoteWindowRect
  cardSize?: NoteCardSize
  /** How it is shown now (kept on the page after a reload). */
  display?: NoteDisplay
  /** Name it after the passage (the first question was the generic "explain"). */
  titleFromQuote?: boolean
}

const MAX_QUOTE = 2_000
/** Review cards keep at most 1 200 characters on the back. */
const MAX_CARD_BACK = 1_150
const MAX_SURROUNDING = 600

/**
 * Questions saved about a walkthrough passage. Local only, no AI: saving,
 * renaming, moving and deleting a note, and turning it into a review card.
 */
export class WalkthroughNoteService {
  private db: AppDatabase
  private repo: WalkthroughRepository
  private homework: HomeworkRepository

  constructor(db: AppDatabase = getDb()) {
    this.db = db
    this.repo = new WalkthroughRepository(db)
    this.homework = new HomeworkRepository(db)
  }

  list(setId: string): Promise<WalkthroughNote[]> {
    return this.repo.listNotes(setId)
  }

  async create(input: NewWalkthroughNote, now = Date.now()): Promise<WalkthroughNote> {
    if (input.turns.length === 0) throw new ValidationError(t('walkthroughQA.nothingToSave'))
    // The set check and the write share one transaction, so a note can never
    // be saved for an assignment deleted in between.
    return this.db.transaction('rw', [this.db.homeworkSets, this.db.walkthroughNotes], async () => {
      const set = await this.homework.getSet(input.setId)
      if (!set) throw new NotFoundError('HomeworkSet', input.setId)
      return this.repo.putNote(this.buildNote(set, input, now))
    })
  }

  private buildNote(
    set: { id: string; projectId: string },
    input: NewWalkthroughNote,
    now: number,
  ): WalkthroughNote {
    const turns = input.turns.slice(-MAX_NOTE_TURNS)
    const quote = input.quote.slice(0, MAX_QUOTE)
    const note: WalkthroughNote = {
      id: crypto.randomUUID(),
      projectId: set.projectId,
      setId: set.id,
      sectionId: input.sectionId,
      sectionTitle: input.sectionTitle,
      quote,
      ...(input.latex ? { latex: input.latex.slice(0, MAX_QUOTE) } : {}),
      anchor: input.anchor,
      surrounding: input.surrounding.slice(0, MAX_SURROUNDING),
      title: defaultNoteTitle({ turns: input.titleFromQuote ? [] : turns, quote }),
      turns,
      ...(input.rect ? { rect: input.rect } : {}),
      ...(input.cardSize ? { cardSize: input.cardSize } : {}),
      ...(input.display ? { display: input.display } : {}),
      createdAt: now,
      updatedAt: now,
    }
    return note
  }

  // Each change reads and writes inside one transaction, so a window move
  // landing while an answer is saved cannot put back the older turns.

  async appendTurn(id: string, turn: WalkthroughNoteTurn): Promise<WalkthroughNote> {
    return this.db.transaction('rw', this.db.walkthroughNotes, async () => {
      const note = await this.require(id)
      return this.repo.putNote({
        ...note,
        turns: [...note.turns, turn].slice(-MAX_NOTE_TURNS),
        updatedAt: turn.at,
      })
    })
  }

  async rename(id: string, title: string): Promise<WalkthroughNote> {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_TITLE)
    if (!clean) throw new ValidationError(t('walkthroughQA.titleEmpty'))
    return this.db.transaction('rw', this.db.walkthroughNotes, async () => {
      const note = await this.require(id)
      return this.repo.putNote({ ...note, title: clean, updatedAt: Date.now() })
    })
  }

  /** Remember where the window was; does not count as an edit. */
  async saveRect(id: string, rect: NoteWindowRect): Promise<void> {
    await this.db.transaction('rw', this.db.walkthroughNotes, async () => {
      const note = await this.repo.getNote(id)
      if (note) await this.repo.putNote({ ...note, rect })
    })
  }

  /** Remember the size the learner gave the note's card; does not count as an edit. */
  async saveCardSize(id: string, cardSize: NoteCardSize): Promise<void> {
    await this.db.transaction('rw', this.db.walkthroughNotes, async () => {
      const note = await this.repo.getNote(id)
      if (note) await this.repo.putNote({ ...note, cardSize })
    })
  }

  /**
   * Remember how the note is shown (window / card / tucked / dock, and where),
   * or that it was closed (`undefined`); does not count as an edit. A missing
   * note (deleted meanwhile) is left alone.
   */
  async saveDisplay(
    id: string,
    display: NoteDisplay | undefined,
    rect?: NoteWindowRect,
  ): Promise<void> {
    await this.db.transaction('rw', this.db.walkthroughNotes, async () => {
      const note = await this.repo.getNote(id)
      if (!note) return
      const { display: _previous, ...rest } = note
      await this.repo.putNote({
        ...rest,
        ...(display ? { display } : {}),
        ...(rect ? { rect } : {}),
      })
    })
  }

  delete(id: string): Promise<void> {
    return this.repo.deleteNote(id)
  }

  /**
   * One review card per question in the note: front = the question (with the
   * passage when the question alone would be unclear), back = the answer.
   * Returns how many cards were added (duplicates are skipped).
   */
  async addToReviewCards(id: string): Promise<number> {
    const note = await this.require(id)
    const quote = note.quote.replace(/\s+/g, ' ').trim()
    const short = quote.length > 80 ? `${quote.slice(0, 79)}…` : quote
    return new ReviewCardService(this.db).addMany(
      note.projectId,
      note.turns.map((turn) => ({
        front: turn.question.length < 24 && short ? `${turn.question}（${short}）` : turn.question,
        back: cardBack(turn.answer),
        source: 'note' as const,
      })),
    )
  }

  private async require(id: string): Promise<WalkthroughNote> {
    const note = await this.repo.getNote(id)
    if (!note) throw new NotFoundError('WalkthroughNote', id)
    return note
  }
}

/** Shorten a long answer at a paragraph break, so no formula is cut in half. */
export function cardBack(answer: string): string {
  const text = answer.trim()
  if (text.length <= MAX_CARD_BACK) return text
  const cut = text.lastIndexOf('\n\n', MAX_CARD_BACK)
  return `${text.slice(0, cut > 200 ? cut : MAX_CARD_BACK).trimEnd()}\n\n…`
}
