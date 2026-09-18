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
import { relativeTime } from '@/shared/lib/utils'
import { formatBytes } from '@/shared/lib/format'

const TYPE_ICON: Record<DocumentType, typeof FileText> = {
  pdf: FileText,
  docx: FileSpreadsheet,
  pptx: Presentation,
  image: FileImage,
  text: FileText,
}

const TYPE_LABEL: Record<DocumentType, string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  image: 'Image',
  text: 'Text',
}

const STATUS_BADGE: Record<ProcessingStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  uploading: { label: 'Uploading', variant: 'outline' },
  processing: { label: 'Processing', variant: 'secondary' },
  ready: { label: 'Ready', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
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
    return <LoadingState label="Loading content library" />
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title="No content yet"
        description="Upload PDFs, Word files, PowerPoint slides, images, or paste text to start building your study material."
        action={
          <Button onClick={onUploadClick}>
            Upload your first document
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
            placeholder="Search by filename"
            className="pl-9"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
          <SelectTrigger className="w-[140px]">
            <Filter className="h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="docx">Word</SelectItem>
            <SelectItem value="pptx">PowerPoint</SelectItem>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="text">Text</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="uploading">Uploading</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="size">Size</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={onUploadClick}>
          Upload
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matches" description="Adjust filters or clear the search." />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Content library</CardTitle>
            <CardDescription>
              {filtered.length} of {documents.length} item{documents.length === 1 ? '' : 's'}
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
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <Link
                    to={`/projects/${projectId}/documents/${doc.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {doc.name}
                  </Link>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {TYPE_LABEL[doc.type]}
                  </Badge>
                  <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
                    {formatBytes(doc.sizeBytes)}
                  </span>
                  <Badge variant={statusBadge.variant} className="gap-1">
                    <StatusIcon
                      className={`h-3 w-3 ${doc.status === 'processing' || doc.status === 'uploading' ? 'animate-spin' : ''}`}
                    />
                    {statusBadge.label}
                  </Badge>
                  <span className="hidden text-xs text-muted-foreground lg:inline">
                    {relativeTime(doc.uploadedAt)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Document actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/projects/${projectId}/documents/${doc.id}`}>Open</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenaming(doc)
                          setRenameValue(doc.name)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleting(doc)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
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
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Pick a new filename for this document.</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!renaming || !renameValue.trim()) return
                await onRename(renaming.id, renameValue.trim())
                setRenaming(null)
              }}
            >
              Save
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
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{deleting?.name}</span> and its extracted chunks will
              be permanently removed from this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                await onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}