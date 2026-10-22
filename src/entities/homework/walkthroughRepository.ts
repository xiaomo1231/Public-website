import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import {
  mergeSectionWrite,
  type HomeworkWalkthrough,
  type WalkthroughNote,
  type WalkthroughSection,
} from './walkthrough'

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
   *
   * The other source of the section (生成的讲解 / 导入的讲解) is never lost:
   * see `mergeSectionWrite`.
   */
  async putSection(
    base: Pick<HomeworkWalkthrough, 'id' | 'projectId' | 'setId' | 'language'>,
    section: WalkthroughSection,
    now = Date.now(),
  ): Promise<HomeworkWalkthrough | null> {
    return this.db.transaction('rw', [this.walkthroughs(), this.db.homeworkSets], async () => {
      if (!(await this.db.homeworkSets.get(base.setId))) return null
      const existing = await this.walkthroughs().get(base.id)
      const stored = existing?.sections.find((item) => item.id === section.id)
      const sections = (existing?.sections ?? []).filter((item) => item.id !== section.id)
      const next: HomeworkWalkthrough = {
        ...base,
        sections: [...sections, mergeSectionWrite(stored, section)],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await this.walkthroughs().put(next)
      return next
    })
  }

  /**
   * Write several sections at once (an imported walkthrough), in one
   * transaction. `build` sees the stored sections so a replaced one can be
   * kept as `previous`. Returns `null` when the assignment was deleted.
   */
  async putSections(
    base: Pick<HomeworkWalkthrough, 'id' | 'projectId' | 'setId' | 'language'>,
    build: (existing: readonly WalkthroughSection[]) => WalkthroughSection[],
    now = Date.now(),
  ): Promise<HomeworkWalkthrough | null> {
    return this.db.transaction('rw', [this.walkthroughs(), this.db.homeworkSets], async () => {
      if (!(await this.db.homeworkSets.get(base.setId))) return null
      const existing = await this.walkthroughs().get(base.id)
      const current = existing?.sections ?? []
      const written = build(current)
      const ids = new Set(written.map((section) => section.id))
      const next: HomeworkWalkthrough = {
        ...base,
        sections: [...current.filter((section) => !ids.has(section.id)), ...written],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await this.walkthroughs().put(next)
      return next
    })
  }

  /**
   * Change one stored section in place (read-modify-write in a transaction):
   * `update` sees the section as it is now and returns the new one, or `null`
   * to leave it. Returns what was written, or `null` when nothing was.
   */
  async updateSection(
    id: string,
    sectionId: string,
    update: (section: WalkthroughSection) => WalkthroughSection | null,
    now = Date.now(),
  ): Promise<WalkthroughSection | null> {
    return this.db.transaction('rw', [this.walkthroughs(), this.db.homeworkSets], async () => {
      const existing = await this.walkthroughs().get(id)
      if (!existing || !(await this.db.homeworkSets.get(existing.setId))) return null
      const current = existing.sections.find((section) => section.id === sectionId)
      const next = current ? update(current) : null
      if (!next) return null
      await this.walkthroughs().put({
        ...existing,
        sections: existing.sections.map((section) => (section.id === sectionId ? next : section)),
        updatedAt: now,
      })
      return next
    })
  }

  /** Change every stored section of a walkthrough in one transaction. */
  async updateSections(
    id: string,
    update: (section: WalkthroughSection) => WalkthroughSection,
  ): Promise<void> {
    await this.db.transaction('rw', this.walkthroughs(), async () => {
      const existing = await this.walkthroughs().get(id)
      if (!existing) return
      await this.walkthroughs().put({ ...existing, sections: existing.sections.map(update) })
    })
  }

  /** Drop sections that no longer belong (e.g. a retired question). */
  async keepSections(id: string, keep: ReadonlySet<string>): Promise<void> {
    await this.db.transaction('rw', this.walkthroughs(), async () => {
      const existing = await this.walkthroughs().get(id)
      if (!existing) return
      const sections = existing.sections.filter((section) => keep.has(section.id))
      if (sections.length !== existing.sections.length)
        await this.walkthroughs().put({ ...existing, sections })
    })
  }

  listNotes(setId: string): Promise<WalkthroughNote[]> {
    return this.notes()
      .where('[setId+updatedAt]')
      .between([setId, -Infinity], [setId, Infinity])
      .reverse()
      .toArray()
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
    return this.notes()
      .where('[setId+updatedAt]')
      .between([setId, -Infinity], [setId, Infinity])
      .count()
  }

  /** Called inside the assignment / document / project delete transactions. */
  async deleteBySet(setId: string): Promise<void> {
    await this.walkthroughs().where('setId').equals(setId).delete()
    await this.notes()
      .where('[setId+updatedAt]')
      .between([setId, -Infinity], [setId, Infinity])
      .delete()
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.walkthroughs().where('projectId').equals(projectId).delete()
    await this.notes().where('projectId').equals(projectId).delete()
  }
}
