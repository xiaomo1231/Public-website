/** Case-insensitive substring filter; the list is short enough to scan. */
export function filterModels(models: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...models]
  return models.filter((m) => m.toLowerCase().includes(q))
}
