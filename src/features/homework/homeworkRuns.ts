import { useEffect } from 'react'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import { useGenerationRun, type UseGenerationRunResult } from '@/shared/lib/useGenerationRun'

/**
 * The pausable run of each assignment, keyed by its document id (a first
 * read has no set id yet). Module scope: the run outlives the page that
 * started it, so another page (or a remount) can still pause it.
 */
const runs = new Map<string, GenerationRun>()

function isActive(run: GenerationRun | undefined): run is GenerationRun {
  return run?.state === 'running' || run?.state === 'pausing'
}

/** Start a run for this assignment, or join the one already working. */
export function startHomeworkRun(documentId: string): GenerationRun {
  const existing = runs.get(documentId)
  if (isActive(existing)) return existing
  const run = createGenerationRun()
  runs.set(documentId, run)
  return run
}

export function homeworkRun(documentId: string): GenerationRun | undefined {
  return runs.get(documentId)
}

/** Follow an assignment's run (re-rendering on its state), if there is one. */
export function useHomeworkRun(documentId: string | undefined): UseGenerationRunResult {
  const handle = useGenerationRun()
  const { attach } = handle
  const run = documentId ? runs.get(documentId) : undefined
  useEffect(() => {
    attach(run ?? null)
  }, [attach, run])
  return handle
}

/** Test helper. */
export function clearHomeworkRunsForTesting(): void {
  runs.clear()
}
