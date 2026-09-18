import { create } from 'zustand'
import type { Document } from '@/entities/document/types'
import { DocumentService } from '@/services/documentService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { getDb } from '@/infrastructure/db/database'
import { NotFoundError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

export type DocumentLoadStatus = 'loading' | 'found' | 'not-found' | 'error'

interface DocumentsState {
  byProject: Record<string, Document[]>
  /** Cache of documents loaded individually (deep link / refresh). */
  byId: Record<string, Document>
  loading: Record<string, boolean>
  loaded: Record<string, boolean>
  error: Record<string, string | null>
  /** Per-document load state, keyed by documentId. */
  singleStatus: Record<string, DocumentLoadStatus>
  singleError: Record<string, string | null>
}

interface DocumentsActions {
  load: (projectId: string) => Promise<void>
  /**
   * Load a single document by id, scoped to a project.
   * Uses the project list cache when available; otherwise fetches exactly one
   * document — never the whole library.
   */
  loadOne: (projectId: string, documentId: string, opts?: { force?: boolean }) => Promise<void>
  refresh: (projectId: string) => Promise<void>
  remove: (id: string, projectId: string) => Promise<void>
  rename: (id: string, projectId: string, name: string) => Promise<void>
  reset: () => void
}

export type DocumentsStore = DocumentsState & DocumentsActions

let service: DocumentService | null = null

function getService(): DocumentService {
  if (!service) {
    const db = getDb()
    service = new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
    })
  }
  return service
}

/** Test seam: inject a service bound to a fresh database. */
export function setDocumentsServiceForTesting(svc: DocumentService | null): void {
  service = svc
}

const EMPTY_STATE: DocumentsState = {
  byProject: {},
  byId: {},
  loading: {},
  loaded: {},
  error: {},
  singleStatus: {},
  singleError: {},
}

export const useDocumentsStore = create<DocumentsStore>((set, get) => ({
  ...EMPTY_STATE,

  async load(projectId) {
    if (!projectId) return
    if (get().loading[projectId]) return
    set((s) => ({ loading: { ...s.loading, [projectId]: true }, error: { ...s.error, [projectId]: null } }))
    try {
      const docs = await getService().listByProject(projectId)
      set((s) => ({
        byProject: { ...s.byProject, [projectId]: docs },
        loading: { ...s.loading, [projectId]: false },
        loaded: { ...s.loaded, [projectId]: true },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToLoadDocuments')
      logger.error('DocumentsStore.load failed', { projectId }, err)
      set((s) => ({
        loading: { ...s.loading, [projectId]: false },
        loaded: { ...s.loaded, [projectId]: true },
        error: { ...s.error, [projectId]: msg },
      }))
    }
  },

  async loadOne(projectId, documentId, opts = {}) {
    if (!projectId || !documentId) return
    const state = get()

    /** Mark a non-found outcome and evict any stale cached copy. */
    const settle = (status: Exclude<DocumentLoadStatus, 'loading' | 'found'>, message?: string) => {
      set((s) => {
        const byId = { ...s.byId }
        delete byId[documentId]
        const byProject = { ...s.byProject }
        for (const [pid, list] of Object.entries(byProject)) {
          if (list.some((d) => d.id === documentId)) {
            byProject[pid] = list.filter((d) => d.id !== documentId)
          }
        }
        return {
          byId,
          byProject,
          singleStatus: { ...s.singleStatus, [documentId]: status },
          singleError: { ...s.singleError, [documentId]: message ?? null },
        }
      })
    }

    if (!opts.force) {
      // 1. Already present in the project's list cache.
      if (state.byProject[projectId]?.some((d) => d.id === documentId)) {
        if (state.singleStatus[documentId] !== 'found') {
          set((s) => ({ singleStatus: { ...s.singleStatus, [documentId]: 'found' } }))
        }
        return
      }
      // 2. Already fetched individually.
      const cached = state.byId[documentId]
      if (cached) {
        if (cached.projectId === projectId) {
          if (state.singleStatus[documentId] !== 'found') {
            set((s) => ({ singleStatus: { ...s.singleStatus, [documentId]: 'found' } }))
          }
        } else {
          settle('not-found')
        }
        return
      }
      // 3. Already attempted (loading / not-found / error) — do not loop.
      if (state.singleStatus[documentId] !== undefined) return
    }

    set((s) => ({
      singleStatus: { ...s.singleStatus, [documentId]: 'loading' },
      singleError: { ...s.singleError, [documentId]: null },
    }))

    try {
      const doc = await getService().get(documentId)
      if (doc.projectId !== projectId) {
        // The document exists but belongs to another project. From this
        // project's perspective it is not found.
        settle('not-found')
        return
      }
      set((s) => {
        const next: DocumentsState = {
          ...s,
          byId: { ...s.byId, [documentId]: doc },
          singleStatus: { ...s.singleStatus, [documentId]: 'found' },
          singleError: { ...s.singleError, [documentId]: null },
        }
        const list = s.byProject[projectId]
        if (list && !list.some((d) => d.id === documentId)) {
          next.byProject = { ...s.byProject, [projectId]: [doc, ...list] }
        }
        return next
      })
    } catch (err) {
      if (err instanceof NotFoundError) {
        settle('not-found')
        return
      }
      const msg = err instanceof Error ? err.message : t('errors.failedToLoadDocument')
      logger.error('DocumentsStore.loadOne failed', { projectId, documentId }, err)
      settle('error', msg)
    }
  },

  async refresh(projectId) {
    const docs = await getService().listByProject(projectId)
    set((s) => ({ byProject: { ...s.byProject, [projectId]: docs } }))
  },

  async remove(id, projectId) {
    await getService().delete(id)
    set((s) => {
      const byId = { ...s.byId }
      delete byId[id]
      const singleStatus = { ...s.singleStatus }
      delete singleStatus[id]
      const singleError = { ...s.singleError }
      delete singleError[id]
      return {
        byProject: {
          ...s.byProject,
          [projectId]: (s.byProject[projectId] ?? []).filter((d) => d.id !== id),
        },
        byId,
        singleStatus,
        singleError,
      }
    })
  },

  async rename(id, projectId, name) {
    const updated = await getService().rename(id, name)
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: (s.byProject[projectId] ?? []).map((d) => (d.id === id ? updated : d)),
      },
      byId: s.byId[id] ? { ...s.byId, [id]: updated } : s.byId,
    }))
  },

  reset() {
    set({ ...EMPTY_STATE })
  },
}))
