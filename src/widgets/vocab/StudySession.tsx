import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Volume2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Progress } from '@/shared/ui/Progress'
import { canSpeak, hasVoiceFor, onVoicesChanged, speak } from '@/shared/lib/speech'
import { isEnglish, languageName, targetHintKey } from '@/shared/lib/language'
import { cn } from '@/shared/lib/utils'
import { checkSpelling, clozeOf, type RootEntry, type SpellingResult } from '@/entities/vocab/text'
import { LetterBar } from '@/widgets/mathInput/LetterBar'
import type { SessionItem, VocabMode, VocabRating, WordView } from '@/entities/vocab/types'
import type { VocabService } from '@/services/vocabService'
import { toast } from '@/features/toast/toastStore'
import { useTranslation, type TranslationKey } from '@/i18n'
import { formatSpan } from './formatSpan'

type T = ReturnType<typeof useTranslation>['t']

const RATINGS: Array<{
  rating: VocabRating
  labelKey: TranslationKey
  variant: 'outline' | 'default'
}> = [
  { rating: 1, labelKey: 'vocab.rate.again', variant: 'outline' },
  { rating: 2, labelKey: 'vocab.rate.hard', variant: 'outline' },
  { rating: 3, labelKey: 'vocab.rate.good', variant: 'default' },
  { rating: 4, labelKey: 'vocab.rate.easy', variant: 'outline' },
]

const MODE_KEYS: Record<VocabMode, TranslationKey> = {
  learn: 'vocab.mode.learn',
  recognize: 'vocab.mode.recognize',
  spell: 'vocab.mode.spell',
  dictation: 'vocab.mode.dictation',
  cloze: 'vocab.mode.cloze',
}

/** A word that is forgotten comes back at most this often in one session. */
const MAX_REPEATS = 2

/**
 * Whether the word can be read aloud: English needs speech synthesis; another
 * language also needs a voice for it installed on this device.
 */
function canSpeakWord(language?: string): boolean {
  return canSpeak() && (isEnglish(language) || hasVoiceFor(language!))
}

/** The word read aloud, in its book's language. */
function speakWord(word: string, language?: string): void {
  speak(word, isEnglish(language) ? 'en-US' : language)
}

/** The mode actually used: dictation needs speech, a cloze needs a sentence holding the word. */
function effectiveMode(item: SessionItem): VocabMode {
  if (item.mode === 'dictation' && !canSpeakWord(item.language)) return 'spell'
  if (
    item.mode === 'cloze' &&
    !(
      item.view.context &&
      clozeOf(item.view.context.text, item.view.word, item.view.forms, item.language)
    )
  )
    return 'spell'
  return item.mode
}

export function WordMeaning({
  view,
  roots,
  t,
}: {
  view: WordView
  roots?: RootEntry[]
  t: T
}): JSX.Element {
  return (
    <div className="space-y-2 text-left">
      {view.meanings.length ? (
        <ul className="space-y-0.5 text-[15px]">
          {view.meanings.map((meaning, i) => (
            <li key={i}>{meaning}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('vocab.noMeaning')}</p>
      )}
      {view.context && (
        <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
          <p className="italic">{view.context.text}</p>
          {(view.context.documentName || view.context.page !== undefined) && (
            <p className="mt-0.5 text-xs">
              {[
                view.context.documentName,
                view.context.page !== undefined ? t('vocab.page', { page: view.context.page }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </blockquote>
      )}
      {roots && roots.length > 0 && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="font-medium">{t('vocab.rootsHint')}</p>
          {roots.map(([key, , meaning, examples]) => (
            <p key={key}>
              <span className="font-mono text-foreground">{key.replace(/\d+$/, '')}</span> —{' '}
              {meaning}
              {examples.length ? `（${examples.join(', ')}）` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export interface StudySessionProps {
  items: SessionItem[]
  bookId: string | null
  /** What is being studied (the book's name, or the mistake list), shown with the word's language. */
  sourceLabel?: string
  service: VocabService
  onExit: () => void
  /** After every rating, so the counts around the session stay current. */
  onProgress?: () => void
}

export function StudySession({
  items,
  bookId,
  sourceLabel,
  service,
  onExit,
  onProgress,
}: StudySessionProps): JSX.Element {
  const { t, language: uiLanguage } = useTranslation()
  const [queue, setQueue] = useState(items)
  const [done, setDone] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<SpellingResult | null>(null)
  const [intervals, setIntervals] = useState<Record<VocabRating, number> | null>(null)
  const [roots, setRoots] = useState<RootEntry[]>([])
  const [busy, setBusy] = useState(false)
  const repeats = useRef(new Map<string, number>())
  const inputRef = useRef<HTMLInputElement>(null)

  // Browsers list their voices late: re-render when they arrive.
  const [, setVoices] = useState(0)
  useEffect(() => onVoicesChanged(() => setVoices((n) => n + 1)), [])

  const current = queue[0] ?? null
  const language = current?.language
  const mode = current ? effectiveMode(current) : 'learn'
  const typing = mode === 'spell' || mode === 'dictation' || mode === 'cloze'
  const speakable = canSpeakWord(language)
  const cloze = useMemo(
    () =>
      current?.view.context
        ? clozeOf(
            current.view.context.text,
            current.view.word,
            current.view.forms,
            current.language,
          )
        : null,
    [current],
  )

  // Per word: rating previews and root hints; dictation speaks right away.
  useEffect(() => {
    if (!current) return
    let cancelled = false
    setIntervals(null)
    setRoots([])
    const lang = current.language
    void (
      lang
        ? service.previewIntervals(current.view.word, undefined, lang)
        : service.previewIntervals(current.view.word)
    ).then((value) => !cancelled && setIntervals(value))
    void (
      lang ? service.details(current.view.word, lang) : service.details(current.view.word)
    ).then((value) => !cancelled && setRoots(value.roots))
    if (mode === 'dictation') speakWord(current.view.word, lang)
    if (typing) setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      cancelled = true
    }
  }, [current, mode, typing, service])

  const advance = useCallback(
    async (rating: VocabRating, correct?: boolean) => {
      if (!current || busy) return
      setBusy(true)
      try {
        await service.grade(current.view.word, rating, mode, {
          ...(correct !== undefined ? { correct } : {}),
          ...(bookId ? { bookId } : {}),
          ...(current.language ? { language: current.language } : {}),
        })
        const key = current.view.word
        const count = repeats.current.get(key) ?? 0
        setQueue((q) => {
          const rest = q.slice(1)
          // Forgotten: once more at the end of this session, as recognition.
          if (rating === 1 && count < MAX_REPEATS) {
            repeats.current.set(key, count + 1)
            return [
              ...rest,
              {
                view: current.view,
                kind: 'review',
                mode: 'recognize',
                ...(current.language ? { language: current.language } : {}),
              },
            ]
          }
          return rest
        })
        setDone((n) => n + 1)
        setRevealed(false)
        setTyped('')
        setResult(null)
        onProgress?.()
      } catch (err) {
        toast({
          variant: 'error',
          title: t('vocab.saveFailed'),
          description: (err as Error).message,
        })
      } finally {
        setBusy(false)
      }
    },
    [current, busy, service, mode, bookId, onProgress, t],
  )

  const check = useCallback(() => {
    if (!current || !typed.trim()) return
    const target = checkSpelling(typed, current.view.word, current.language)
    const form = cloze ? checkSpelling(typed, cloze.answer, current.language) : target
    setResult(form.correct ? form : target)
    setRevealed(true)
  }, [current, typed, cloze])

  // Keyboard: Space reveals, 1–4 rate; Enter checks and moves on when typing.
  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent) => {
      const inField = (event.target as HTMLElement | null)?.tagName === 'INPUT'
      if (typing) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        if (!result) check()
        else void advance(result.correct ? 3 : result.nearMiss ? 2 : 1, result.correct)
        return
      }
      if (inField) return
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault()
        setRevealed(true)
      } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        void advance(Number(event.key) as VocabRating)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, typing, result, revealed, check, advance])

  const total = done + queue.length
  if (!current) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-lg font-medium">{t('vocab.sessionDone')}</p>
          <p className="text-sm text-muted-foreground">
            {t('vocab.sessionDoneHint', { count: done })}
          </p>
          <Button onClick={onExit}>{t('vocab.backToOverview')}</Button>
        </CardContent>
      </Card>
    )
  }

  const { view } = current
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <p className="text-sm text-muted-foreground" data-testid="vocab-session-source">
          {[sourceLabel, languageName(language ?? 'en', uiLanguage)].filter(Boolean).join(' · ')}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{t('vocab.progress', { done, total })}</span>
          <Progress value={total ? (done / total) * 100 : 0} className="h-1.5 flex-1" />
          <span>
            {t(MODE_KEYS[mode])}
            {current.kind === 'new' ? ` · ${t('vocab.newWord')}` : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={onExit}>
            {t('vocab.endSession')}
          </Button>
        </div>
        {!isEnglish(language) && !speakable && (
          <p className="text-xs text-muted-foreground">
            {t('vocab.noVoice', { language: languageName(language!, uiLanguage) })}
          </p>
        )}

        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 px-5 py-6 text-center">
          {/* Prompt */}
          {!typing && (
            <div className="flex items-center justify-center gap-2">
              <span translate="no" className="notranslate text-3xl font-semibold tracking-wide">
                {view.word}
              </span>
              {speakable && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('vocab.speak')}
                  onClick={() => speakWord(view.word, language)}
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          {!typing && view.phonetic && (
            <p className="text-sm text-muted-foreground">/{view.phonetic}/</p>
          )}
          {mode === 'dictation' && (
            <Button variant="outline" onClick={() => speakWord(view.word, language)}>
              <Volume2 className="h-4 w-4" />
              {t('vocab.listenAgain')}
            </Button>
          )}
          {mode === 'cloze' && cloze && <p className="text-[15px] italic">{cloze.text}</p>}
          {(mode === 'spell' || mode === 'cloze') && !revealed && (
            <div className="mx-auto max-w-md">
              <WordMeaning
                view={{
                  ...view,
                  context:
                    mode === 'spell' && cloze ? { ...view.context!, text: cloze.text } : undefined,
                }}
                t={t}
              />
            </div>
          )}

          {/* Answer */}
          {typing && (
            <div className="mx-auto max-w-sm space-y-2">
              <Input
                ref={inputRef}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={Boolean(result)}
                placeholder={t(isEnglish(language) ? 'vocab.typeWord' : 'vocab.typeWordAny')}
                aria-label={t(isEnglish(language) ? 'vocab.typeWord' : 'vocab.typeWordAny')}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                translate="no"
                className={cn(
                  'notranslate text-center text-lg',
                  result?.correct && 'border-emerald-500',
                  result && !result.correct && 'border-destructive',
                )}
              />
              {!result && (
                <LetterBar
                  language={language}
                  field={() => inputRef.current}
                  value={() => typed}
                  onChange={setTyped}
                />
              )}
              {result && (
                <p
                  className={cn(
                    'flex items-center justify-center gap-1.5 text-sm',
                    result.correct ? 'text-emerald-600' : 'text-destructive',
                  )}
                >
                  {result.correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  {result.correct
                    ? t('vocab.correct')
                    : result.outcome && targetHintKey(result.outcome, view.word, typed)
                      ? t(targetHintKey(result.outcome, view.word, typed)!, { answer: view.word })
                      : result.nearMiss
                        ? t('vocab.nearMiss')
                        : t('vocab.wrong')}
                </p>
              )}
            </div>
          )}

          {revealed && (
            <div className="mx-auto max-w-md space-y-2 border-t border-border/60 pt-3">
              {typing && (
                <div className="flex items-center justify-center gap-2">
                  <span translate="no" className="notranslate text-2xl font-semibold">
                    {view.word}
                  </span>
                  {view.phonetic && (
                    <span className="text-sm text-muted-foreground">/{view.phonetic}/</span>
                  )}
                  {speakable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('vocab.speak')}
                      onClick={() => speakWord(view.word, language)}
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
              {view.grammar && (
                <p
                  lang={language}
                  translate="no"
                  className="notranslate text-center text-sm font-medium"
                >
                  {view.grammar}
                </p>
              )}
              <WordMeaning view={view} roots={roots} t={t} />
            </div>
          )}
        </div>

        {/* Actions */}
        {typing ? (
          result ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                void advance(result.correct ? 3 : result.nearMiss ? 2 : 1, result.correct)
              }
            >
              {t('vocab.next')}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!typed.trim()} onClick={check}>
                {t('vocab.check')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setResult({ correct: false, nearMiss: false })
                  setRevealed(true)
                }}
              >
                {t('vocab.dontKnow')}
              </Button>
            </div>
          )
        ) : revealed ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map(({ rating, labelKey, variant }) => (
              <Button
                key={rating}
                variant={variant}
                disabled={busy}
                onClick={() => void advance(rating)}
                className="h-auto flex-col gap-0.5 py-2"
              >
                <span>
                  {t(labelKey)} <span className="text-xs opacity-60">{rating}</span>
                </span>
                {intervals && (
                  <span className="text-xs font-normal opacity-75">
                    {formatSpan(intervals[rating], t)}
                  </span>
                )}
              </Button>
            ))}
          </div>
        ) : (
          <Button className="w-full" onClick={() => setRevealed(true)}>
            {t('vocab.reveal')}
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {typing ? t('vocab.keyboardTyping') : t('vocab.keyboardHint')}
        </p>
      </CardContent>
    </Card>
  )
}
