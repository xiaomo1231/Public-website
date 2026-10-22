import type { HandwritingRecognitionMode, RecognizerId } from './types'

export interface RecognizerAvailability {
  /** A configured AI provider is present and the browser is online. */
  online: boolean
  /** An on-device recogniser is installed and loadable. */
  local: boolean
}

/**
 * Order in which recognisers are tried for the chosen 识别方式. `typed` (the
 * student types the transcript) is always last, so there is always a way to
 * finish: recognition can fail, grading never has to guess.
 *
 * - `auto`:   online → on-device → typed
 * - `online`: online → typed (never falls back to on-device recognition)
 * - `local`:  on-device → typed (nothing leaves the device)
 */
export function recognizerOrder(
  mode: HandwritingRecognitionMode,
  availability: RecognizerAvailability,
): RecognizerId[] {
  const order: RecognizerId[] = []
  if ((mode === 'auto' || mode === 'online') && availability.online) order.push('vision-llm')
  if ((mode === 'auto' || mode === 'local') && availability.local) order.push('local-model')
  order.push('typed')
  return order
}

/** Why only typing is left, for the message shown next to the empty transcript. */
export function typedOnlyReason(
  mode: HandwritingRecognitionMode,
  availability: RecognizerAvailability,
): 'local-unavailable' | 'online-unavailable' | 'none-available' {
  if (mode === 'local') return 'local-unavailable'
  if (mode === 'online') return 'online-unavailable'
  return availability.online ? 'local-unavailable' : 'none-available'
}
