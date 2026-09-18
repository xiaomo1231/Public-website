import { useState } from 'react'
import { FileText, Image as ImageIcon, Upload } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { Textarea } from '@/shared/ui/Textarea'
import type { DocumentType } from '@/entities/document/types'
import { useDocumentUpload } from '@/features/documents/useUpload'
import { ACCEPTED_TYPES } from '@/infrastructure/files/validation'
import { cn } from '@/shared/lib/utils'

export interface DocumentUploadDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TYPE_LABELS: Record<DocumentType, string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  image: 'Image',
  text: 'Text',
}

const TEXT_TAB = 'text' as const
const FILE_TAB = 'file' as const

type Mode = typeof FILE_TAB | typeof TEXT_TAB

export function DocumentUploadDialog({
  projectId,
  open,
  onOpenChange,
}: DocumentUploadDialogProps): JSX.Element {
  const [mode, setMode] = useState<Mode>(FILE_TAB)
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [textName, setTextName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const { upload, uploading, progress, message } = useDocumentUpload(projectId)

  const accept = ACCEPTED_TYPES.flatMap((t) => t.mime).concat(ACCEPTED_TYPES.flatMap((t) => t.ext.map((e) => `.${e}`))).join(',')

  function reset() {
    setFile(null)
    setText('')
    setTextName('')
    setMode(FILE_TAB)
    setDragOver(false)
  }

  async function handleSubmit() {
    try {
      if (mode === FILE_TAB) {
        if (!file) return
        const detected = detectType(file)
        if (!detected) {
          toast({ variant: 'error', title: 'Unsupported file type' })
          return
        }
        await upload({ type: detected, file })
      } else {
        if (!text.trim()) return
        await upload({ type: 'text', text, name: textName })
      }
      reset()
      onOpenChange(false)
    } catch {
      /* toast already shown */
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload content</DialogTitle>
          <DialogDescription>
            Add course material to this project. Files are processed locally.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value={FILE_TAB}>
              <Upload className="h-4 w-4" /> Upload file
            </TabsTrigger>
            <TabsTrigger value={TEXT_TAB}>
              <FileText className="h-4 w-4" /> Paste text
            </TabsTrigger>
          </TabsList>

          <TabsContent value={FILE_TAB} className="space-y-3">
            <Label
              htmlFor="upload-file"
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-6 py-10 text-center text-sm transition-colors',
                dragOver && 'border-primary bg-primary/5',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const dropped = e.dataTransfer.files[0]
                if (dropped) setFile(dropped)
              }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : 'Drop a file or click to browse'}
              </span>
              <span className="text-xs text-muted-foreground">
                PDF · DOCX · PPTX · PNG · JPG · WebP · GIF · BMP
              </span>
              <Input
                id="upload-file"
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Label>
            {file && (
              <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{file.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {Math.ceil(file.size / 1024)} KB · {TYPE_LABELS[detectType(file) ?? 'text']}
                </span>
              </div>
            )}
          </TabsContent>

          <TabsContent value={TEXT_TAB} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="text-name">Title (optional)</Label>
              <Input
                id="text-name"
                value={textName}
                onChange={(e) => setTextName(e.target.value)}
                placeholder="e.g. Lecture 3 notes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text-body">Course material</Label>
              <Textarea
                id="text-body"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste or type your notes here…"
              />
              <p className="text-xs text-muted-foreground">
                {text.length.toLocaleString()} / 1,048,576 characters
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {uploading && (
          <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="capitalize">{message ?? 'Working…'}</span>
              <span className="tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={uploading || (mode === FILE_TAB ? !file : !text.trim())}
          >
            {uploading ? 'Processing…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function detectType(file: File): DocumentType | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return 'docx'
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  )
    return 'pptx'
  if (file.type.startsWith('image/')) return 'image'
  return null
}