/**
 * Pronunciation through the browser's own speech synthesis — no audio files,
 * nothing fetched. Unavailable in some browsers and in tests.
 */
export function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

export function speak(text: string, lang: 'en-US' | 'en-GB' = 'en-US'): void {
  if (!canSpeak() || !text.trim()) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.9
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
