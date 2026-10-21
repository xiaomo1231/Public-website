import { useMemo, useState } from 'react'
import { Check, MessageSquareText, Pencil, Search, Trash2 } from 'lucide-react'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import { deleteNote, renameNote } from '@/features/homework/floatingQA'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface WalkthroughNotesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notes: WalkthroughNote[]
  /** Notes whose passage is still in the walkthrough text. */
  located: ReadonlySet<string>
  onOpenNote: (note: WalkthroughNote) => void
}

/** Every question saved about this walkthrough: search, open, rename, delete. */
export function WalkthroughNotesDialog({
  open,
  onOpenChange,
  notes,
  located,
  onOpenNote,
}: WalkthroughNotesDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<WalkthroughNote | null>(null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return notes
    return notes.filter((note) =>
      [
        note.title,
        note.quote,
        note.sectionTitle,
        ...note.turns.flatMap((turn) => [turn.question, turn.answer]),
      ]
        .join('\n')
        .toLowerCase()
        .includes(needle),
    )
  }, [notes, query])

  async function commitRename(): Promise<void> {
    if (!editing) return
    try {
      await renameNote(editing.id, editing.title)
      setEditing(null)
    } catch (err) {
      toast({ variant: 'error', title: friendlyAIError(err) })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('walkthroughQA.listTitle')}</DialogTitle>
            <DialogDescription>{t('walkthroughQA.listHint')}</DialogDescription>
          </DialogHeader>
          {notes.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('walkthroughQA.search')}
                aria-label={t('walkthroughQA.search')}
                className="pl-8"
              />
            </div>
          )}
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {notes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('walkthroughQA.listEmpty')}
              </p>
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('walkthroughQA.noMatch')}
              </p>
            ) : (
              shown.map((note) => (
                <div key={note.id} className="space-y-1.5 rounded-lg border p-3">
                  {editing?.id === note.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void commitRename()
                      }}
                    >
                      <Input
                        autoFocus
                        value={editing.title}
                        onChange={(event) => setEditing({ id: note.id, title: event.target.value })}
                        aria-label={t('walkthroughQA.rename')}
                      />
                      <Button type="submit" size="icon" aria-label={t('common.save')}>
                        <Check className="h-4 w-4" />
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-start gap-2">
                      <MessageSquareText
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{note.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('walkthroughQA.meta', {
                            section: note.sectionTitle,
                            count: note.turns.length,
                            time: relativeTime(note.updatedAt),
                          })}
                        </p>
                      </div>
                      {!located.has(note.id) && (
                        <Badge variant="outline">{t('walkthroughQA.passageChangedBadge')}</Badge>
                      )}
                    </div>
                  )}
                  <p className="line-clamp-2 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                    “{note.quote}”
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onOpenNote(note)}>
                      {t('walkthroughQA.open')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ id: note.id, title: note.title })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('walkthroughQA.rename')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(note)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('walkthroughQA.deleteTitle')}
        description={deleting ? t('walkthroughQA.deleteBody', { title: deleting.title }) : ''}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={async () => {
          if (deleting) await deleteNote(deleting.id)
          setDeleting(null)
        }}
      />
    </>
  )
}
