import { splitSentences } from './text'

/**
 * Words the student looks up (划词翻译 / 解释) become course vocabulary.
 * Pure helpers: is the selection a word or short phrase, and which sentence
 * of the surrounding text holds it.
 */

/** Longest selection kept as a term, in characters and in words. */
export const LOOKUP_MAX_CHARS = 48
export const LOOKUP_MAX_WORDS = 4
/** Longest example sentence kept with a looked-up word. */
const SENTENCE_MAX_CHARS = 280

const CJK = /[㐀-鿿豈-﫿]/

/**
 * The term of a selection, or null when it is not vocabulary: empty, a
 * sentence (too long, too many words, ends like one), Chinese text (the
 * student's own language), digits or formula symbols only.
 */
export function lookupTermOf(selection: string): string | null {
  const text = selection
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’«»„(（[【]+|[\s"'“”‘’«»„)）\]】,，;；:：]+$/gu, '')
    .replace(/[.。!?！？]+$/u, '')
    .trim()
  if (!text || text.length > LOOKUP_MAX_CHARS) return null
  if (CJK.test(text)) return null
  if (!/\p{L}{2,}/u.test(text)) return null
  if (/[=+*/^\\{}<>|$]/.test(text)) return null
  if (text.split(' ').length > LOOKUP_MAX_WORDS) return null
  return text
}

/** The sentence of `surrounding` that holds `term` (case-insensitive), clipped; '' when none. */
export function sentenceWith(surrounding: string, term: string): string {
  const needle = term.toLocaleLowerCase()
  const sentence =
    splitSentences(surrounding).find((item) => item.toLocaleLowerCase().includes(needle)) ?? ''
  if (sentence.length <= SENTENCE_MAX_CHARS) return sentence
  const at = sentence.toLocaleLowerCase().indexOf(needle)
  const start = Math.max(0, at - SENTENCE_MAX_CHARS / 2)
  return `${start > 0 ? '…' : ''}${sentence.slice(start, start + SENTENCE_MAX_CHARS).trim()}…`
}
