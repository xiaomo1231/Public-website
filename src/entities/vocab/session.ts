import type { SessionItem, VocabCard, VocabMode, VocabRating } from './types'

/**
 * In-session reinforcement (pure): what happens to the queue after a rating.
 *
 *  - A forgotten word comes back once more at the end, as recognition (at
 *    most `FORGOT_REPEATS` times).
 *  - A 顽固词 rated "forgot" or "hard" comes back sooner — after
 *    `LEECH_GAP` other words — up to `LEECH_REPEATS` times, each time with
 *    another prompt type (recognise → spell → cloze with its sentence →
 *    dictation), so it is met from several sides.
 */

export const FORGOT_REPEATS = 2
export const LEECH_REPEATS = 3
export const LEECH_GAP = 2
export const LEECH_MODES: readonly VocabMode[] = ['recognize', 'spell', 'cloze', 'dictation']

export function requeueAfterRating(
  rest: readonly SessionItem[],
  item: SessionItem,
  rating: VocabRating,
  card: Pick<VocabCard, 'leech'> | undefined,
  /** Times this word has already come back in this session. */
  repeats: number,
): { queue: SessionItem[]; repeated: boolean } {
  const language = item.language ? { language: item.language } : {}
  if (card?.leech && rating <= 2 && repeats < LEECH_REPEATS) {
    const mode = LEECH_MODES[(repeats + 1) % LEECH_MODES.length]!
    const at = Math.min(LEECH_GAP, rest.length)
    const again: SessionItem = { view: item.view, kind: 'review', mode, leech: true, ...language }
    return { queue: [...rest.slice(0, at), again, ...rest.slice(at)], repeated: true }
  }
  if (rating === 1 && repeats < FORGOT_REPEATS) {
    const again: SessionItem = {
      view: item.view,
      kind: 'review',
      mode: 'recognize',
      ...(card?.leech ? { leech: true } : {}),
      ...language,
    }
    return { queue: [...rest, again], repeated: true }
  }
  return { queue: [...rest], repeated: false }
}
