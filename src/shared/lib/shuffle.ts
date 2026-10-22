/** Fisher–Yates shuffle (a new array). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** "None of the options are correct", "None of the above", "以上都不对" … */
const NONE_OPTION =
  /^(?:none of (?:the )?(?:above|options|these|answers|the options)(?: (?:is|are) correct)?|no correct (?:option|answer)|以上(?:都|均|皆)?(?:不|非)|都不(?:对|正确)|以上答案均不正确|以上皆非)/i

/** Whether an option is a "none of the options" choice (kept last when shuffling). */
export function isNoneOption(label: string): boolean {
  return NONE_OPTION.test(label.normalize('NFKC').trim())
}

/**
 * Shuffle answer options, keeping a final "None of the options are correct"
 * choice in last place (where the professor puts it, as option F).
 */
export function shuffledOptions<T extends { label: string }>(
  options: readonly T[],
  random: () => number = Math.random,
): T[] {
  const none = options.filter((option) => isNoneOption(option.label))
  if (none.length !== 1) return shuffled(options, random)
  return [
    ...shuffled(
      options.filter((option) => option !== none[0]),
      random,
    ),
    none[0]!,
  ]
}
