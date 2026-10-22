/**
 * Input attributes for answer fields, chosen by what the answer is.
 *
 * Every answer field is a real `<input>` / `<textarea>` (never contenteditable
 * only), so iPadOS Scribble (随手写) converts Apple Pencil handwriting into
 * it, and the on-screen keyboard opens on the right page:
 *
 *   number      decimal keypad / numbers page
 *   fraction    a matrix or blank cell holding an exact number such as −3/2:
 *               on iPadOS `numeric` opens the numbers-and-punctuation page,
 *               which has − / . as well as the digits; elsewhere (Android
 *               and others) `numeric` is a digits-only pad without "/" or
 *               "−", so those get the full keyboard plus a `pattern` hint
 *   expression  maths / chemistry / quantity typed in plain syntax: full
 *               keyboard, but no auto-capitalisation (x → X) or autocorrect
 *   term        a word or short phrase that is graded as typed (fill-in
 *               blanks, spelling drills): autocorrect would change the answer
 *   text        free prose: the platform defaults
 */
export type AnswerFieldKind = 'number' | 'fraction' | 'expression' | 'term' | 'text'

export interface AnswerFieldAttrs {
  inputMode: 'decimal' | 'numeric' | 'text'
  autoCapitalize: 'off' | 'sentences'
  autoCorrect: 'off' | 'on'
  spellCheck: boolean
  autoComplete?: 'off'
  pattern?: string
}

/**
 * What an exact number may contain: digits, sign, fraction bar, point. `-`
 * and `/` are escaped, as the `v`-flag regex of `pattern` requires.
 */
export const FRACTION_PATTERN = '[0-9\\-−+.\\/ ]*'

/** The parts of `navigator` the platform check reads. */
export interface PlatformLike {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}

function currentNavigator(): PlatformLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator
}

/**
 * iPadOS (or iOS). iPadOS Safari reports a Mac user agent, so a "Mac" with a
 * touch screen counts too.
 */
export function isAppleTouch(nav: PlatformLike | undefined = currentNavigator()): boolean {
  if (!nav) return false
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true
  const mac = /Macintosh/.test(nav.userAgent) || nav.platform === 'MacIntel'
  return mac && (nav.maxTouchPoints ?? 0) > 1
}

export function answerFieldAttrs(
  kind: AnswerFieldKind,
  nav: PlatformLike | undefined = currentNavigator(),
): AnswerFieldAttrs {
  switch (kind) {
    case 'number':
      return {
        inputMode: 'decimal',
        autoCapitalize: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        autoComplete: 'off',
      }
    case 'fraction':
      return {
        ...(isAppleTouch(nav)
          ? { inputMode: 'numeric' as const }
          : { inputMode: 'text' as const, pattern: FRACTION_PATTERN }),
        autoCapitalize: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        autoComplete: 'off',
      }
    case 'expression':
    case 'term':
      return {
        inputMode: 'text',
        autoCapitalize: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        autoComplete: 'off',
      }
    case 'text':
      return { inputMode: 'text', autoCapitalize: 'sentences', autoCorrect: 'on', spellCheck: true }
  }
}
