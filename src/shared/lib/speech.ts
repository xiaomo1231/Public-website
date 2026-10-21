/**
 * Pronunciation through the browser's own speech synthesis — no audio files,
 * nothing fetched. Unavailable in some browsers and in tests. Voices for
 * languages other than English depend on what the operating system has
 * installed.
 */
export function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

function voices(): SpeechSynthesisVoice[] {
  try {
    return canSpeak() ? window.speechSynthesis.getVoices() : []
  } catch {
    return []
  }
}

/**
 * The installed voice for a BCP-47 code: an exact match ('de-DE') first,
 * then any voice of the same language ('de' → 'de-AT'), preferring the
 * system default among equals.
 */
export function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const wanted = lang.trim().toLowerCase().replace(/_/g, '-')
  const primary = wanted.split('-')[0]!
  if (!primary) return undefined
  const list = voices()
  const tagOf = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace(/_/g, '-')
  const sameLanguage = list.filter((voice) => {
    const tag = tagOf(voice)
    return tag === primary || tag.startsWith(`${primary}-`)
  })
  return (
    sameLanguage.find((voice) => tagOf(voice) === wanted) ??
    sameLanguage.find((voice) => voice.default) ??
    sameLanguage[0]
  )
}

/** Whether this device can read text of a language aloud. */
export function hasVoiceFor(lang: string): boolean {
  return canSpeak() && voiceFor(lang) !== undefined
}

/**
 * Read `text` aloud in `lang` (a BCP-47 code such as 'en-US', 'de' or 'hu'),
 * with a voice of that language when one is installed.
 */
export function speak(text: string, lang = 'en-US'): void {
  if (!canSpeak() || !text.trim()) return
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = voiceFor(lang)
  utterance.lang = voice?.lang ?? lang
  if (voice) utterance.voice = voice
  utterance.rate = 0.9
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

/** Call `listener` when the list of voices changes (browsers load it late). */
export function onVoicesChanged(listener: () => void): () => void {
  if (!canSpeak()) return () => undefined
  const synth = window.speechSynthesis
  if (typeof synth.addEventListener !== 'function') return () => undefined
  synth.addEventListener('voiceschanged', listener)
  return () => synth.removeEventListener('voiceschanged', listener)
}
