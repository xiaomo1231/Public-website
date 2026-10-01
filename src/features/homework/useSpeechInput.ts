import { useEffect, useRef, useState } from 'react'

export type SpeechInputState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'
export type SpeechInputError =
  | 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'language-not-supported' | 'other'

interface SpeechResult {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<SpeechResult>
}

interface SpeechErrorEvent {
  error: string
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function speechErrorCode(error: string): SpeechInputError {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'not-allowed'
  if (error === 'no-speech') return 'no-speech'
  if (error === 'audio-capture') return 'audio-capture'
  if (error === 'network') return 'network'
  if (error === 'language-not-supported') return 'language-not-supported'
  return 'other'
}

export function appendSpeechText(previous: string, transcript: string): string {
  const next = transcript.trim()
  if (!next) return previous
  if (!previous || /\s$/.test(previous) || /^[，。！？、,.!?;:]/.test(next)) return previous + next
  if (/[\u3400-\u9fff]$/.test(previous) && /^[\u3400-\u9fff]/.test(next)) return previous + next
  return `${previous} ${next}`
}

/** Browser speech input. Only final results are handed to the editable question field. */
export function useSpeechInput(language: string, onFinalText: (text: string) => void) {
  const [state, setState] = useState<SpeechInputState>('idle')
  const [error, setError] = useState<SpeechInputError | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const generation = useRef(0)
  const finalText = useRef(onFinalText)
  finalText.current = onFinalText

  function discardCurrent(): void {
    generation.current += 1
    const current = recognition.current
    recognition.current = null
    if (!current) return
    current.onstart = null
    current.onresult = null
    current.onerror = null
    current.onend = null
    try { current.abort() } catch { /* the browser may already have ended it */ }
  }

  useEffect(() => {
    setState('idle')
    setError(null)
    return () => { discardCurrent() }
  }, [language])

  function start(): void {
    if (recognition.current) return
    const Constructor = getRecognitionConstructor()
    if (!Constructor) return
    const current = new Constructor()
    const session = ++generation.current
    const emitted = new Set<number>()
    current.lang = language
    current.continuous = true
    current.interimResults = true
    recognition.current = current
    setError(null)
    setState('starting')
    current.onstart = () => {
      if (generation.current === session) setState('listening')
    }
    current.onresult = (event) => {
      if (generation.current !== session) return
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result?.isFinal || emitted.has(index)) continue
        emitted.add(index)
        const transcript = result[0]?.transcript.trim()
        if (transcript) finalText.current(transcript)
      }
    }
    current.onerror = (event) => {
      if (generation.current !== session) return
      discardCurrent()
      setError(speechErrorCode(event.error))
      setState('error')
    }
    current.onend = () => {
      if (generation.current !== session) return
      recognition.current = null
      setState((previous) => previous === 'error' ? 'error' : 'idle')
    }
    try {
      current.start()
    } catch {
      discardCurrent()
      setError('other')
      setState('error')
    }
  }

  function stop(): void {
    if (!recognition.current || state === 'stopping') return
    setState('stopping')
    try {
      recognition.current.stop()
    } catch {
      discardCurrent()
      setError('other')
      setState('error')
    }
  }

  function cancel(): void {
    discardCurrent()
    setError(null)
    setState('idle')
  }

  return {
    supported: getRecognitionConstructor() !== null,
    state,
    error,
    start,
    stop,
    cancel,
  }
}
