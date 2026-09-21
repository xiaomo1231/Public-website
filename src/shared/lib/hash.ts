/**
 * Deterministic string hashing shared by every cache / freshness fingerprint in
 * the app (course analysis, tutor lessons, course context, practice sets).
 *
 * This is the single implementation: services must import it rather than
 * carrying their own copy, so two fingerprints of the same data can never
 * disagree.
 */

/** Small, dependency-free, deterministic 32-bit FNV-1a hash. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
