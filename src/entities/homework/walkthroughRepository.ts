import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { HomeworkWalkthrough, WalkthroughNote, WalkthroughSection } from './walkthrough'

/**
 * Persistence for assignment walkthroughs and the questions saved about them.
 * Rows carry `projectId` and `setId`; every query is set-scoped.
 */
export class WalkthroughRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private walkthroughs() {
    return this.db.table<HomeworkWalkthrough, string>('homeworkWalkthroughs')
  }

  private notes() {
    return this.db.table<WalkthroughNote, string>('walkthroughNotes')
  }

  get(id: string): Promise<HomeworkWalkthrough | undefined> {
    return this.walkthroughs().get(id)
  }

  /**
   * Write one section into the walkthrough, creating the row when needed.
   * Read-modify-write inside a transaction, so two sections finishing at the
   * same moment cannot overwrite each other. Returns `null` (and writes
   * nothing) when the assignment was deleted meanwhile, so a run that outlives
   * its assignment cannot bring its data back.
   */
  async putSection(
    base: Pick<HomeworkWalkthrough, 'id' | 'projectId' | 'setId' | 'language'>,
    section: WalkthroughSection,
    now = Date.now(),
  ): Promise<HomeworkWalkthrough | null> {
    return this.db.transaction('rw', [this.walkthroughs(), this.db.homeworkSets], async () => {
      if (!(await this.db.homeworkSets.get(base.setId))) return null
      const existing = await this.walkthroughs().get(base.id)
      const sections = (existing?.sections ?? []).filter((item) => item.id !== section.id)
      const next: HomeworkWalkthrough = {
        ...base,
        sections: [...sections, section],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await this.walkthroughs().put(next)
      return next
    })
  }

  /** Drop sections that no longer belong (e.g. a retired question). */
  async keepSections(id: string, keep: ReadonlySet<string>): Promise<void> {
    await this.db.transaction('rw', this.walkthroughs(), async () => {
      const existing = await this.walkthroughs().get(id)
      if (!existing) return
      const sections = existing.sections.filter((section) => keep.has(section.id))
      if (sections.length !== existing.sections.length) await this.walkthroughs().put({ ...existing, sections })
    })
  }

  listNotes(setId: string): Promise<WalkthroughNote[]> {
    return this.notes().where('[setId+updatedAt]').between([setId, -Infinity], [setId, Infinity]).reverse().toArray()
  }

  getNote(id: string): Promise<WalkthroughNote | undefined> {
    return this.notes().get(id)
  }

  async putNote(note: WalkthroughNote): Promise<WalkthroughNote> {
    await this.notes().put(note)
    return note
  }

  async deleteNote(id: string): Promise<void> {
    await this.notes().delete(id)
  }

  countNotes(setId: string): Promise<number> {
    return this.notes().where('[setId+updatedAt]').between([setId, -Infinity], [setId, Infinity]).count()
  }

  /** Called inside the assignment / document / project delete transactions. */
  async deleteBySet(setId: string): Promise<void> {
    await this.walkthroughs().where('setId').equals(setId).delete()
    await this.notes().where('[setId+updatedAt]').between([setId, -Infinity], [setId, Infinity]).delete()
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.walkthroughs().where('projectId').equals(projectId).delete()
    await this.notes().where('projectId').equals(projectId).delete()
  }
}
