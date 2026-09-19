import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Presentation,
  Search,
  Trash2,
} from 'lucide-react'
import type { Document, DocumentType, ProcessingStatus } from '@/entities/document/types'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import { Badge } from '@/shared/ui/Badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/shared/ui/Dialog'
import { TooltipProvider, TooltipWrapper } from '@/shared/ui/Tooltip'
import { relativeTime } from '@/shared/lib/utils'
import { formatBytes } from '@/shared/lib/format'
import { useTranslation, type TranslationKey } from '@/i18n'

const TYPE_ICON: Record<DocumentType, typeof FileText> = {
  pdf: FileText,
  docx: FileSpreadsheet,
  pptx: Presentation,
  image: FileImage,
  text: FileText,
}

const TYPE_LABEL_KEY: Record<DocumentType, TranslationKey> = {
  pdf: 'docType.pdf',
  docx: 'docType.word',
  pptx: 'docType.powerpoint',
  image: 'docType.image',
  text: 'docType.text',
}

const STATUS_BADGE: Record<ProcessingStatus, { labelKey: TranslationKey; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  uploading: { labelKey: 'docStatus.uploading', variant: 'outline' },
  processing: { labelKey: 'docStatus.processing', variant: 'secondary' },
  ready: { labelKey: 'docStatus.ready', variant: 'default' },
  failed: { labelKey: 'docStatus.failed', variant: 'destructive' },
}

const STATUS_ICON: Record<ProcessingStatus, typeof Loader2 | typeof CheckCircle2 | typeof AlertCircle> = {
  uploading: Loader2,
  processing: Loader2,
  ready: CheckCircle2,
  failed: AlertCircle,
}

type SortKey = 'newest' | 'oldest' | 'name' | 'size'
type TypeFilter = 'all' | DocumentType
type StatusFilter = 'all' | ProcessingStatus

export interface DocumentListProps {
  documents: Document[]
  loading: boolean
  projectId: string
  onUploadClick: () => void
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function DocumentList({
  documents,
  loading,
  projectId,
  onUploadClick,
  onRename,
  onDelete,
}: DocumentListProps): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [renaming, setRenaming] = useState<Document | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<Document | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = documents.filter((d) => {
      if (type !== 'all' && d.type !== type) return false
      if (status !== 'all' && d.status !== status) return false
      if (q && !d.name.toLowerCase().includes(q)) return false
      return true
    })
    list = list.slice().sort((a, b) => {
      switch (sort) {
        case 'newest':
          return b.uploadedAt - a.uploadedAt
        case 'oldest':
          return a.uploadedAt - b.uploadedAt
        case 'name':
          return a.name.localeCompare(b.name)
        case 'size':
          return b.sizeBytes - a.sizeBytes
        default:
          return 0
      }
    })
    return list
  }, [documents, query, type, status, sort])

  if (loading) {
    return <LoadingState label={t('documents.loading')} />
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title={t('documents.empty')}
        description={t('documents.emptyHint')}
        action={
          <Button onClick={onUploadClick}>
            {t('documents.uploadFirst')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('documents.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
          <SelectTrigger className="w-[140px]">
            <Filter className="h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('documents.filter.allTypes')}</SelectItem>
            <SelectItem value="pdf">{t('docType.pdf')}</SelectItem>
            <SelectItem value="docx">{t('docType.word')}</SelectItem>
            <SelectItem value="pptx">{t('docType.powerpoint')}</SelectItem>
            <SelectItem value="image">{t('docType.image')}</SelectItem>
            <SelectItem value="text">{t('docType.text')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('documents.filter.allStatus')}</SelectItem>
            <SelectItem value="uploading">{t('docStatus.uploading')}</SelectItem>
            <SelectItem value="processing">{t('docStatus.processing')}</SelectItem>
            <SelectItem value="ready">{t('docStatus.ready')}</SelectItem>
            <SelectItem value="failed">{t('docStatus.failed')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t('documents.sort.newest')}</SelectItem>
            <SelectItem value="oldest">{t('documents.sort.oldest')}</SelectItem>
            <SelectItem value="name">{t('documents.sort.name')}</SelectItem>
            <SelectItem value="size">{t('documents.sort.size')}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={onUploadClick}>
          {t('documents.upload')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={t('documents.noMatches')} description={t('documents.noMatchesHint')} />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('documents.title')}</CardTitle>
            <CardDescription>
              {t('documents.count', { shown: filtered.length, total: documents.length, count: documents.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {filtered.map((doc) => {
              const Icon = TYPE_ICON[doc.type]
              const StatusIcon = STATUS_ICON[doc.status]
              const statusBadge = STATUS_BADGE[doc.status]
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 transition-colors hover:bg-accent/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <TooltipProvider delayDuration={300}>
                    <TooltipWrapper content={doc.name}>
                      <Link
                        to={`/projects/${projectId}/documents/${doc.id}`}
                        aria-label={doc.name}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {doc.name}
                      </Link>
                    </TooltipWrapper>
                  </TooltipProvider>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {t(TYPE_LABEL_KEY[doc.type])}
                  </Badge>
                  <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
                    {formatBytes(doc.sizeBytes)}
                  </span>
                  <Badge variant={statusBadge.variant} className="gap-1">
                    <StatusIcon
                      className={`h-3 w-3 ${doc.status === 'processing' || doc.status === 'uploading' ? 'animate-spin' : ''}`}
                    />
                    {t(statusBadge.labelKey)}
                  </Badge>
                  <span className="hidden text-xs text-muted-foreground lg:inline">
                    {relativeTime(doc.uploadedAt)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('documents.actions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/projects/${projectId}/documents/${doc.id}`}>{t('documents.open')}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenaming(doc)
                          setRenameValue(doc.name)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        {t('documents.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleting(doc)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('documents.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('documents.renameTitle')}</DialogTitle>
            <DialogDescription>{t('documents.renameDescription')}</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={async () => {
                if (!renaming || !renameValue.trim()) return
                await onRename(renaming.id, renameValue.trim())
                setRenaming(null)
              }}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('documents.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('documents.deleteBody', { name: deleting?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                await onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
