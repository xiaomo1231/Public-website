/**
 * Input attributes for answer fields, chosen by what the answer is.
 *
 * Every answer field is a real `<input>` / `<textarea>` (never contenteditable
 * only), so iPadOS Scribble (随手写) converts Apple Pencil handwriting into
 * it, and the on-screen keyboard opens on the right page:
 *
 *   number      decimal keypad / numbers page
 *   fraction    a matrix or blank cell holding an exact number such as −3/2:
 *               `numeric` opens the iPad numbers-and-punctuation page, which
 *               has − / . as well as the digits
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
}

export function answerFieldAttrs(kind: AnswerFieldKind): AnswerFieldAttrs {
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
        inputMode: 'numeric',
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
