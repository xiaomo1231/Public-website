/**
 * The actions of a paused assignment card. 继续 finishes the run, so it is the
 * primary action whenever it is available; 打开讲解 (when some questions are
 * ready) is then secondary. While the run is live again there is nothing to
 * resume and the card shows the run's own controls instead.
 */
export interface PausedCardActions {
  /** Show 继续 as the card's primary (filled) button. */
  resume: boolean
  /** How 打开讲解 is shown: primary only when there is nothing to resume. */
  open: 'primary' | 'secondary' | null
}

export function pausedCardActions({
  live,
  questionCount,
}: {
  /** The set's run is running / pausing in this tab. */
  live: boolean
  questionCount: number
}): PausedCardActions {
  const resume = !live
  const open = questionCount > 0 ? (resume ? 'secondary' : 'primary') : null
  return { resume, open }
}
