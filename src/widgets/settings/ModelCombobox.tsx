import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { filterModels } from './modelFilter'

export interface ModelComboboxProps {
  id: string
  value: string
  onChange: (value: string) => void
  /** Fetched or preset model ids. Empty → a plain text input. */
  models: readonly string[]
  placeholder?: string
  onBlur?: () => void
}

/**
 * Model field: a free-text input with a searchable list of known models.
 * Typing filters the list but any name is accepted, so a model the provider
 * does not list (or a failed fetch) never blocks the user.
 */
export function ModelCombobox({
  id,
  value,
  onChange,
  models,
  placeholder,
  onBlur,
}: ModelComboboxProps): JSX.Element {
  const { t } = useTranslation()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // While the list is open after a click on the chevron, show every model.
  const [showAll, setShowAll] = useState(false)
  const options = useMemo(
    () => (showAll ? [...models] : filterModels(models, value)),
    [models, value, showAll],
  )
  const hasList = models.length > 0
  const expanded = open && hasList

  function choose(model: string): void {
    onChange(model)
    setOpen(false)
    setActive(-1)
    setShowAll(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!hasList) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter' && expanded && active >= 0 && options[active]) {
      event.preventDefault()
      choose(options[active]!)
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      setOpen(false)
      setShowAll(false)
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role={hasList ? 'combobox' : undefined}
        aria-autocomplete={hasList ? 'list' : undefined}
        aria-expanded={hasList ? expanded : undefined}
        aria-controls={hasList ? listId : undefined}
        aria-activedescendant={
          expanded && active >= 0 && options[active] ? `${listId}-${active}` : undefined
        }
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={hasList ? t('settings.models.search') : placeholder}
        className={cn(hasList && 'pr-9')}
        onChange={(e) => {
          onChange(e.target.value)
          setShowAll(false)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Let a click on an option land before closing.
          window.setTimeout(() => {
            setOpen(false)
            setShowAll(false)
          }, 120)
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
      />
      {hasList && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('settings.models.toggle')}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setShowAll(true)
            setOpen((o) => !o)
          }}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      )}
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('settings.models.listLabel')}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card p-1 text-sm text-foreground shadow-lift"
        >
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {t('settings.models.noMatch')}
            </li>
          ) : (
            options.map((model, index) => (
              <li
                key={model}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={model === value}
                className={cn(
                  'cursor-pointer truncate rounded-sm px-2 py-1.5 font-mono text-xs',
                  index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  model === value && 'font-semibold',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(model)}
              >
                {model}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
