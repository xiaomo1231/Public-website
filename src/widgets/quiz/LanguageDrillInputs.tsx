import { useRef } from 'react'
import { Check, X } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import {
  GERMAN_ARTICLES,
  decodeGenderAnswer,
  encodeGenderAnswer,
  paradigmBlanks,
  paradigmCellLabel,
  stripPluralArticle,
} from '@/entities/question/languageDrills'
import { Input } from '@/shared/ui/Input'
import { compareTargetText, isNearTarget } from '@/shared/lib/language'
import { cn } from '@/shared/lib/utils'
import { answerFieldAttrs } from '@/shared/lib/answerFieldAttrs'
import { LetterBar } from '@/widgets/mathInput/LetterBar'
import {
  gradedOptionStatusKey,
  optionKeyClass,
  optionListClass,
  optionRowClass,
} from './optionStyles'
import { useTranslation } from '@/i18n'

interface DrillInputProps {
  question: Question
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  revealed?: boolean
  onSubmit?: () => void
}

/** How a typed form compares once graded: exact, nearly (accents / capitals), wrong. */
function formStatus(
  given: string,
  accepted: string[],
  language: string | undefined,
): 'exact' | 'near' | 'wrong' {
  let near = false
  for (const form of accepted) {
    const outcome = compareTargetText(form, given, language)
    if (outcome === 'exact') return 'exact'
    if (isNearTarget(outcome)) near = true
  }
  return near ? 'near' : 'wrong'
}

const STATUS_FIELD: Record<'exact' | 'near' | 'wrong', string> = {
  exact: 'border-emerald-500/70 bg-emerald-50/50 dark:bg-emerald-950/20',
  near: 'border-amber-500/70 bg-amber-50/50 dark:bg-amber-950/20',
  wrong: 'border-destructive/70 bg-destructive/5',
}

/**
 * German article drill: the noun (with its meaning), der / die / das in a
 * fixed order (keys 1–3), and — when the course gives it — the plural.
 * Value: `<article>\n<plural>`.
 */
export function ArticleGenderInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
  onSubmit,
}: DrillInputProps): JSX.Element {
  const { t } = useTranslation()
  const field = useRef<HTMLInputElement | null>(null)
  const noun = question.gender
  const { article, plural } = decodeGenderAnswer(value)
  if (!noun) return <p className="text-sm text-muted-foreground">{t('question.unverified')}</p>
  const pluralStatus =
    revealed && noun.plural
      ? formStatus(stripPluralArticle(plural), [noun.plural], 'de')
      : undefined
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          lang="de"
          translate="no"
          className="notranslate text-2xl font-semibold lecture:font-heading lab:font-mono lab:text-xl"
        >
          {noun.noun}
        </span>
        {noun.gloss && <span className="text-sm text-muted-foreground">{noun.gloss}</span>}
      </p>
      <div
        role="radiogroup"
        aria-label={t('articleGender.article')}
        className={cn(optionListClass, 'grid grid-cols-3 gap-2 space-y-0 lab:gap-0')}
      >
        {GERMAN_ARTICLES.map((option, i) => {
          const selected = article === option
          const isCorrect = noun.article === option
          const status = gradedOptionStatusKey(revealed, selected, isCorrect)
          return (
            <button
              key={option}
              type="button"
              role="radio"
              data-quiz-option
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(encodeGenderAnswer(option, plural))}
              className={cn(
                optionRowClass({
                  selected,
                  correct: Boolean(revealed && isCorrect),
                  wrong: Boolean(revealed && selected && !isCorrect),
                }),
                'justify-center lab:-ml-px lab:mt-0 lab:first:ml-0',
              )}
            >
              <span aria-hidden className={optionKeyClass(Boolean(selected && !revealed))}>
                {revealed && isCorrect ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : revealed && selected ? (
                  <X className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  i + 1
                )}
              </span>
              <span lang="de" translate="no" className="notranslate font-medium">
                {option}
              </span>
              {status && <span className="sr-only">{` (${t(status)})`}</span>}
            </button>
          )
        })}
      </div>
      {noun.plural && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">
              {t('articleGender.plural')}{' '}
              <span lang="de" translate="no" className="notranslate">
                die
              </span>
            </span>
            <Input
              ref={field}
              lang="de"
              value={plural}
              disabled={disabled}
              {...answerFieldAttrs('term')}
              // German nouns start with a capital letter.
              autoCapitalize="sentences"
              enterKeyHint="go"
              placeholder={t('articleGender.pluralPlaceholder')}
              className={cn(pluralStatus && STATUS_FIELD[pluralStatus])}
              onChange={(event) =>
                onChange(encodeGenderAnswer(article, event.target.value.replace(/\n/g, ' ')))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && onSubmit) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
            />
          </label>
          {revealed && pluralStatus !== 'exact' && (
            <p className="text-xs text-muted-foreground">
              {t('articleGender.expectedPlural', { plural: `die ${noun.plural}` })}
            </p>
          )}
          {!disabled && (
            <LetterBar
              language="de"
              field={() => field.current}
              value={() => plural}
              onChange={(text) => onChange(encodeGenderAnswer(article, text))}
            />
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('articleGender.hint')}</p>
    </div>
  )
}

/**
 * Paradigm table: a real table whose blank cells are text fields named
 * "row × column". Enter moves to the next blank, Ctrl/⌘+Enter submits. After
 * grading each blank shows whether it was exact, nearly right or wrong, with
 * the expected form. Value: the blanks' answers in reading order, one per line.
 */
export function ParadigmTableInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
  onSubmit,
  language,
}: DrillInputProps & { language?: string | undefined }): JSX.Element {
  const { t } = useTranslation()
  const table = question.paradigm
  const fields = useRef<Array<HTMLInputElement | null>>([])
  const focused = useRef(0)
  if (!table) return <p className="text-sm text-muted-foreground">{t('question.unverified')}</p>
  const blanks = paradigmBlanks(table)
  const answers = blanks.map((_, i) => value.split('\n')[i] ?? '')
  const set = (i: number, text: string) => {
    const next = [...answers]
    next[i] = text.replace(/\n/g, ' ')
    onChange(next.join('\n'))
  }
  const blankIndex = (row: number, column: number) =>
    blanks.findIndex((blank) => blank.row === row && blank.column === column)
  const showColumns = table.columns.length > 1 || Boolean(table.columns[0])

  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto">
        <table
          lang={language}
          className="w-full border-collapse text-sm lecture:text-base lab:border lab:border-border"
        >
          {table.title && (
            <caption className="pb-2 text-left text-sm font-medium text-muted-foreground lecture:font-heading lab:font-mono lab:text-xs lab:uppercase lab:tracking-wide">
              {table.title}
            </caption>
          )}
          {showColumns && (
            <thead>
              <tr className="border-b border-foreground/40 lab:border-border lab:bg-muted/40">
                <td className="px-2 py-1.5" />
                {table.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-2 py-1.5 text-left font-medium text-muted-foreground lab:font-mono lab:text-xs"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((rowLabel, row) => (
              <tr key={rowLabel} className="border-b border-border/70 lab:border-border">
                <th
                  scope="row"
                  translate="no"
                  className="notranslate whitespace-nowrap px-2 py-1.5 text-left font-medium lab:border-r lab:border-border lab:font-mono lab:text-[13px]"
                >
                  {rowLabel}
                </th>
                {table.cells[row]!.map((cell, column) => {
                  const index = blankIndex(row, column)
                  if (index < 0) {
                    return (
                      <td
                        key={column}
                        translate="no"
                        className="notranslate px-2 py-1.5 text-muted-foreground"
                      >
                        {cell.text}
                      </td>
                    )
                  }
                  const accepted = blanks[index]!.accepted
                  const status = revealed
                    ? formStatus(answers[index] ?? '', accepted, language)
                    : undefined
                  return (
                    <td key={column} className="px-1.5 py-1">
                      <Input
                        ref={(node) => {
                          fields.current[index] = node
                        }}
                        aria-label={paradigmCellLabel(table, row, column)}
                        value={answers[index] ?? ''}
                        disabled={disabled}
                        {...answerFieldAttrs('term')}
                        enterKeyHint="next"
                        className={cn(
                          'h-8 min-w-[7rem] lab:rounded-none coarse:h-11',
                          status && STATUS_FIELD[status],
                        )}
                        onFocus={() => {
                          focused.current = index
                        }}
                        onChange={(event) => set(index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                          event.preventDefault()
                          if (event.ctrlKey || event.metaKey) {
                            onSubmit?.()
                            return
                          }
                          fields.current[index + 1]?.focus()
                        }}
                      />
                      {status && status !== 'exact' && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          <span className="sr-only">
                            {t(status === 'near' ? 'paradigm.srNear' : 'paradigm.srWrong')}
                          </span>
                          {t('paradigm.expected', { form: accepted.join(' / ') })}
                        </span>
                      )}
                      {status === 'exact' && (
                        <span className="sr-only">{t('paradigm.srCorrect')}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <LetterBar
          language={language}
          field={() => fields.current[focused.current] ?? null}
          value={() => answers[focused.current] ?? ''}
          onChange={(text) => set(focused.current, text)}
        />
      )}
      <p className="text-xs text-muted-foreground">{t('paradigm.hint')}</p>
    </div>
  )
}
