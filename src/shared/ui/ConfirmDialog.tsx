import { useEffect, useId, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Button } from './Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog'
import { Input } from './Input'
import { Label } from './Label'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Precise description of what will happen (which item, what is removed). */
  details?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  /**
   * When set, the user must type this exact text to enable the confirm
   * button. Used for irreversible operations.
   */
  requireText?: string
  /** Disables the footer and blocks dismissal while an action is running. */
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * Shared confirmation dialog.
 *
 * - Radix Dialog supplies focus trapping, `aria-*` wiring, and ESC-to-close.
 * - ESC / overlay clicks are ignored while `busy`, so an in-flight action
 *   cannot be dismissed mid-way.
 * - The confirm button is disabled while `busy` to prevent double submission.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  requireText,
  busy = false,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const { t } = useTranslation()
  const inputId = useId()
  const [typed, setTyped] = useState('')

  const resolvedConfirmLabel = confirmLabel ?? t('confirmDialog.confirm')
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel')

  // Reset the typed confirmation whenever the dialog closes.
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  const needsText = Boolean(requireText)
  const satisfiesRequirement = !needsText || typed === requireText
  const canConfirm = satisfiesRequirement && !busy

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {details && <div className="rounded-md border bg-muted/30 p-3 text-sm">{details}</div>}

        {needsText && (
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {t('confirmDialog.typeToConfirm', { word: requireText ?? '' })}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              invalid={typed.length > 0 && typed !== requireText}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => void onConfirm()}
            disabled={!canConfirm}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {resolvedConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
