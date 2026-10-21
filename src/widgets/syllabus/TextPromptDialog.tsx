import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { useTranslation } from '@/i18n'

/** A one-field dialog (rename a scope, name a new one). */
export function TextPromptDialog({
  open,
  title,
  initial = '',
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  title: string
  initial?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (value: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!value.trim()) return
            onSubmit(value.trim())
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={title}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
