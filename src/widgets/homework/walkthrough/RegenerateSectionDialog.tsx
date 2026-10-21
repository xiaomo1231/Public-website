import { useEffect, useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { MAX_REVISION_SUGGESTION } from '@/services/homeworkWalkthroughService'

export interface RegenerateSectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The section's title, as shown on the page. */
  title: string
  /** Start the rewrite; the suggestion is empty when the student wrote none. */
  onConfirm: (suggestion: string) => void
}

/** 重新生成这一节: an optional suggestion for how to rewrite one section. */
export function RegenerateSectionDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: RegenerateSectionDialogProps): JSX.Element {
  const { t } = useTranslation()
  const fieldId = useId()
  const [suggestion, setSuggestion] = useState('')

  useEffect(() => {
    if (open) setSuggestion('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('homework.walkthrough.regenerateTitle', { title })}</DialogTitle>
          <DialogDescription>{t('homework.walkthrough.regenerateBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm(suggestion.trim())
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={fieldId}>{t('homework.walkthrough.suggestionLabel')}</Label>
            <Textarea
              id={fieldId}
              value={suggestion}
              rows={4}
              maxLength={MAX_REVISION_SUGGESTION}
              placeholder={t('homework.walkthrough.suggestionPlaceholder')}
              onChange={(event) => setSuggestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  onConfirm(suggestion.trim())
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('homework.walkthrough.regenerateConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
