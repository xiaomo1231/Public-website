import type { Project } from '@/entities/project/types'

/**
 * Guard for destructive project deletion.
 *
 * A project may only be deleted when the caller has an explicitly selected
 * project AND the user typed its exact name. The system never infers which
 * project the user meant.
 */
export function canConfirmProjectDeletion(selected: Project | null, input: string): boolean {
  return Boolean(selected && input === selected.name)
}
