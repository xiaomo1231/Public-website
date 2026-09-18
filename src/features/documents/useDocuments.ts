import { useCallback, useEffect } from 'react'
import type { Document } from '@/entities/document/types'
import { useDocumentsStore, type DocumentLoadStatus } from './documentsStore'

/** Hook providing the document list for a given project. Loads on mount. */
export function useDocuments(projectId: string | undefined): {
  documents: Document[]
  loading: boolean
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
} {
  const store = useDocumentsStore()

  useEffect(() => {
    if (!projectId) return
    if (!store.loaded[projectId] && !store.loading[projectId]) {
      void store.load(projectId)
    }
  }, [projectId, store.loaded, store.loading, store])

  const docs = (projectId ? store.byProject[projectId] : undefined) ?? []
  return {
    documents: docs,
    loading: Boolean(projectId && store.loading[projectId]),
    loaded: Boolean(projectId && store.loaded[projectId]),
    error: projectId ? store.error[projectId] ?? null : null,
    refresh: async () => {
      if (projectId) await store.refresh(projectId)
    },
    remove: async (id) => {
      if (!projectId) return
      await store.remove(id, projectId)
    },
    rename: async (id, name) => {
      if (!projectId) return
      await store.rename(id, projectId, name)
    },
  }
}

export interface UseDocumentResult {
  document: Document | null
  status: DocumentLoadStatus
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load a single document scoped to a project.
 *
 * Works on a cold store (deep link / page refresh): it fetches exactly one
 * document on demand instead of relying on the project list having been
 * loaded elsewhere. Project isolation is enforced — a document that belongs
 * to another project reports `not-found`.
 */
export function useDocument(
  projectId: string | undefined,
  documentId: string | undefined,
): UseDocumentResult {
  const byId = useDocumentsStore((s) => (documentId ? s.byId[documentId] : undefined))
  const fromList = useDocumentsStore((s) =>
    projectId && documentId
      ? s.byProject[projectId]?.find((d) => d.id === documentId)
      : undefined,
  )
  const status = useDocumentsStore((s) =>
    documentId ? s.singleStatus[documentId] : undefined,
  )
  const error = useDocumentsStore((s) =>
    documentId ? s.singleError[documentId] ?? null : null,
  )
  const loadOne = useDocumentsStore((s) => s.loadOne)

  useEffect(() => {
    if (!projectId || !documentId) return
    void loadOne(projectId, documentId)
  }, [projectId, documentId, loadOne])

  const refresh = useCallback(async () => {
    if (!projectId || !documentId) return
    await loadOne(projectId, documentId, { force: true })
  }, [projectId, documentId, loadOne])

  // A document that lives in another project's cache must never be surfaced.
  const cached = byId && byId.projectId === projectId ? byId : null
  const document = fromList ?? cached

  const resolvedStatus: DocumentLoadStatus = document
    ? 'found'
    : status ?? 'loading'

  return { document, status: resolvedStatus, error, refresh }
}