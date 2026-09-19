/**
 * Filename display helpers.
 *
 * These never touch the stored name — they only decide how much of it to *show*
 * in a fixed-width surface (notifications, metadata rows, exported text). Any
 * surface that can reflow should prefer CSS ellipsis so the browser truncates
 * against the real container width.
 */

const ELLIPSIS = '...'

/**
 * Extensions longer than this are treated as part of the base name, so a file
 * called `report.final.verylongsuffix` is not reduced to `repo...verylongsuffix`.
 */
const MAX_EXTENSION_LENGTH = 10

export interface SplitFilename {
  /** Everything before the final dot. */
  base: string
  /** The final dot and what follows it, or `''` when there is no extension. */
  extension: string
}

/**
 * Splits `name` into base and extension.
 *
 * A leading dot is not an extension (`.gitignore` has no extension), and a
 * trailing dot is ignored (`report.` has no extension). Over-long "extensions"
 * are treated as base text.
 */
export function splitFilename(name: string): SplitFilename {
  const value = name ?? ''
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || dot === value.length - 1) return { base: value, extension: '' }

  const extension = value.slice(dot)
  if (extension.length > MAX_EXTENSION_LENGTH) return { base: value, extension: '' }

  return { base: value.slice(0, dot), extension }
}

/**
 * Shortens `name` to at most `maxLength` characters while keeping the beginning
 * of the name and the file extension, e.g.
 *
 * ```
 * truncateFilename('Calculus_Lecture_Week_03_Derivatives_Review.pdf', 36)
 * // 'Calculus_Lecture_Week_03_Deriva...pdf'
 * ```
 *
 * Names that already fit are returned untouched.
 */
export function truncateFilename(name: string, maxLength = 36): string {
  const value = name ?? ''
  if (maxLength <= 0 || value.length <= maxLength) return value

  const { base, extension } = splitFilename(value)

  // Not enough room for both the ellipsis and the extension — drop the extension
  // rather than produce something longer than the budget.
  if (ELLIPSIS.length + extension.length >= maxLength) {
    return `${value.slice(0, Math.max(1, maxLength - ELLIPSIS.length))}${ELLIPSIS}`
  }

  const headBudget = maxLength - ELLIPSIS.length - extension.length
  return `${base.slice(0, headBudget)}${ELLIPSIS}${extension}`
}
