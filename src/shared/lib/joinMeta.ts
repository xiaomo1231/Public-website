/**
 * A meta line from its parts ("Calculus · 2 days ago"): empty parts are left
 * out, so the line never starts or ends with a separator or doubles one.
 */
export function joinMeta(
  parts: ReadonlyArray<string | number | null | undefined | false>,
  separator = ' · ',
): string {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : part ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(separator)
}
