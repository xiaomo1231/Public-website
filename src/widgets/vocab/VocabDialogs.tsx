import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/DropdownMenu'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { downloadText } from '@/shared/lib/download'
import { primaryLanguage } from '@/shared/lib/language'
import type { ExportFormat, VocabEntry, WordView } from '@/entities/vocab/types'
import type { VocabService } from '@/services/vocabService'
import { toast } from '@/features/toast/toastStore'
import { formatNumber, useTranslation, type TranslationKey } from '@/i18n'

const FORMATS: Array<{ format: ExportFormat; labelKey: TranslationKey; hintKey: TranslationKey }> =
  [
    { format: 'anki', labelKey: 'vocab.export.anki', hintKey: 'vocab.export.ankiHint' },
    { format: 'csv', labelKey: 'vocab.export.csv', hintKey: 'vocab.export.csvHint' },
    { format: 'txt', labelKey: 'vocab.export.txt', hintKey: 'vocab.export.txtHint' },
  ]

/** Export a book, everything learned, or the mistake list, for another app. */
export function ExportMenu({
  service,
  target,
  disabled,
  size = 'sm',
}: {
  service: VocabService
  target: { bookId: string } | 'learned' | 'mistakes'
  disabled?: boolean
  size?: 'sm' | 'default'
}): JSX.Element {
  const { t } = useTranslation()
  const run = async (format: ExportFormat) => {
    try {
      const file = await service.export(target, format)
      downloadText(file.filename, file.content, file.mimeType)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('vocab.exportFailed'),
        description: (err as Error).message,
      })
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={disabled}>
          <Download className="h-4 w-4" />
          {t('vocab.export.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('vocab.export.title')}</DropdownMenuLabel>
        {FORMATS.map(({ format, labelKey, hintKey }) => (
          <DropdownMenuItem
            key={format}
            onSelect={() => void run(format)}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-medium">{t(labelKey)}</span>
            <span className="text-xs text-muted-foreground">{t(hintKey)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Languages offered for an imported list; "other" takes a typed code. */
const IMPORT_LANGUAGES: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: 'en', labelKey: 'vocab.language.en' },
  { value: 'de', labelKey: 'vocab.language.de' },
  { value: 'hu', labelKey: 'vocab.language.hu' },
  { value: 'other', labelKey: 'vocab.language.other' },
]

const IMPORT_PLACEHOLDERS: Record<string, string> = {
  en: 'abandon\nphysiology\tn. 生理学\nglenoid, 关节盂',
  de: 'der Arzt – physician\ndie Ärztin, 女医生\ndie Übelkeit\tnausea',
  hu: 'fájdalom pain\na fej – head\nszédülés, 头晕',
}

/** Paste or upload a word list as a custom book. */
export function ImportDialog({
  open,
  onOpenChange,
  service,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: VocabService
  onImported: (bookId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [choice, setChoice] = useState('en')
  const [otherCode, setOtherCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setText('')
      setChoice('en')
      setOtherCode('')
    }
  }, [open])

  const language = choice === 'other' ? primaryLanguage(otherCode) : choice
  const languageMissing = choice === 'other' && !language

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setText(await file.text())
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async () => {
    setBusy(true)
    try {
      const result = await service.importList(name, text, Date.now(), language)
      toast({
        variant: 'success',
        title: t('vocab.imported', { count: result.added }),
        ...(result.skipped || result.withoutMeaning
          ? {
              description: t('vocab.importedDetail', {
                skipped: result.skipped,
                missing: result.withoutMeaning,
              }),
            }
          : {}),
      })
      onImported(result.book.id)
      onOpenChange(false)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('vocab.importFailed'),
        description: (err as Error).message,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('vocab.importTitle')}</DialogTitle>
          <DialogDescription>{t('vocab.importHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vocab-import-name">{t('vocab.importName')}</Label>
            <Input
              id="vocab-import-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('vocab.importDefaultName')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vocab-import-language">{t('vocab.importLanguage')}</Label>
            <div className="flex gap-2">
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger id="vocab-import-language" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_LANGUAGES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {choice === 'other' && (
                <Input
                  value={otherCode}
                  onChange={(event) => setOtherCode(event.target.value)}
                  placeholder={t('vocab.language.codePlaceholder')}
                  aria-label={t('vocab.language.code')}
                  className="w-40"
                />
              )}
            </div>
            {language !== 'en' && !languageMissing && (
              <p className="text-xs text-muted-foreground">{t('vocab.importLanguageHint')}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vocab-import-text">{t('vocab.importWords')}</Label>
            <Textarea
              id="vocab-import-text"
              rows={8}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={IMPORT_PLACEHOLDERS[language ?? ''] ?? IMPORT_PLACEHOLDERS.en}
              className="font-mono text-sm"
            />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <Upload className="h-4 w-4" />
            {t('vocab.importFile')}
            <input
              type="file"
              accept=".txt,.csv,.tsv,text/plain,text/csv"
              className="sr-only"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !text.trim() || languageMissing}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('vocab.importButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Shown at most at once; the search narrows long exam books. */
const PAGE = 200

/** The words of a book, searchable; course and custom words can be removed. */
export function WordListDialog({
  bookId,
  title,
  editable,
  service,
  onClose,
  onChanged,
}: {
  bookId: string | null
  title: string
  editable: boolean
  service: VocabService
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [views, setViews] = useState<WordView[]>([])
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    setLoading(true)
    setQuery('')
    setLimit(PAGE)
    void Promise.all([
      service.bookWords(bookId),
      editable ? service.bookEntries(bookId) : Promise.resolve([]),
    ])
      .then(([words, stored]) => {
        if (cancelled) return
        setViews(words)
        setEntries(stored)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [bookId, editable, service])

  // Filter against a deferred copy so typing stays responsive on 15k-word
  // books; a new query starts again from the first page.
  const deferredQuery = useDeferredValue(query)
  const needle = deferredQuery.trim().toLowerCase()
  useEffect(() => setLimit(PAGE), [needle])
  const matching = useMemo(
    () =>
      needle
        ? views.filter(
            (view) => view.word.includes(needle) || view.meanings.some((m) => m.includes(needle)),
          )
        : views,
    [views, needle],
  )
  const entryOf = (word: string) => entries.find((entry) => entry.word === word)

  const remove = async (word: string) => {
    const entry = entryOf(word)
    if (!entry) return
    await service.removeEntry(entry.id)
    setViews((list) => list.filter((view) => view.word !== word))
    onChanged()
  }

  return (
    <Dialog open={bookId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('vocab.wordCount', { count: views.length, n: formatNumber(views.length) })}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('vocab.searchWords')}
            aria-label={t('vocab.searchWords')}
            className="pl-9"
          />
        </div>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-t border-border/70 px-6">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              {t('vocab.loading')}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {matching.slice(0, limit).map((view) => (
                <li key={view.word} className="flex items-start gap-3 py-2.5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm">
                      <span translate="no" className="notranslate font-medium">
                        {view.word}
                      </span>
                      {view.phonetic && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          /{view.phonetic}/
                        </span>
                      )}
                      {view.grammar && (
                        <span
                          translate="no"
                          className="notranslate ml-2 text-xs text-muted-foreground"
                        >
                          {view.grammar}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {view.meanings.join('；') || t('vocab.noMeaning')}
                    </p>
                    {view.context && (
                      <p className="line-clamp-2 text-xs italic text-muted-foreground">
                        {view.context.text}
                        {view.context.page !== undefined
                          ? ` · ${t('vocab.page', { page: view.context.page })}`
                          : ''}
                      </p>
                    )}
                  </div>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('vocab.removeWord')}
                      onClick={() => void remove(view.word)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!loading && matching.length > limit && (
            <div className="py-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                {t('vocab.showMore', { count: matching.length - limit })}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
