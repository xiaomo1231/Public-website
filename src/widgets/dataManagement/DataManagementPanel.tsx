import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { DataManagementService, type DataInventory } from '@/services/dataManagementService'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { formatBytes } from '@/shared/lib/format'

type ConfirmAction = 'delete-all' | 'clear-key' | null

export function DataManagementPanel(): JSX.Element {
  const navigate = useNavigate()
  const [inventory, setInventory] = useState<DataInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmAction>(null)
  const [busy, setBusy] = useState(false)
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)

  useEffect(() => {
    const svc = new DataManagementService()
    void svc
      .inventory()
      .then(setInventory)
      .finally(() => setLoading(false))
  }, [])

  async function refreshInventory() {
    setLoading(true)
    setInventory(await new DataManagementService().inventory())
    setLoading(false)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { json, blobs } = await new DataManagementService().exportAll()
      const bundle = { json, blobs }
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-learning-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ variant: 'success', title: 'Export ready', description: 'Saved to your downloads.' })
    } catch (err) {
      toast({ variant: 'error', title: 'Export failed', description: (err as Error).message })
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteAll() {
    setBusy(true)
    try {
      await new DataManagementService().deleteAll()
      toast({ variant: 'success', title: 'All local data deleted' })
      setConfirm(null)
      await refreshInventory()
    } catch (err) {
      toast({ variant: 'error', title: 'Could not delete', description: isAppError(err) ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function handleClearKey() {
    setBusy(true)
    try {
      await new DataManagementService().clearAISettings()
      toast({ variant: 'success', title: 'AI settings cleared' })
      setConfirm(null)
      await refreshInventory()
    } catch (err) {
      toast({ variant: 'error', title: 'Could not clear', description: isAppError(err) ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          Data
        </CardTitle>
        <CardDescription>
          What we store locally and what leaves your device. AI provider calls go directly to your configured endpoint — nothing is relayed through a project server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <LoadingState label="Loading inventory" inline />
        ) : inventory ? (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <InventoryLine label="Projects" value={inventory.projects} />
            <InventoryLine label="Documents" value={inventory.documents} />
            <InventoryLine label="Chunks" value={inventory.chunks} />
            <InventoryLine label="Quizzes" value={inventory.quizzes} />
            <InventoryLine label="Tutor sessions" value={inventory.tutorSessions} />
            <InventoryLine label="Mistakes" value={inventory.mistakes} />
            <InventoryLine label="Translations" value={inventory.translations} />
            <InventoryLine label="Course analyses" value={inventory.courseAnalyses} />
            <InventoryLine label="Document blobs" value={formatBytes(inventory.estimatedTotalBytes)} />
            <InventoryLine label="AI key configured" value={inventory.hasApiKey ? 'yes' : 'no'} badge={inventory.hasApiKey ? 'default' : 'secondary'} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Exporting…' : 'Export data'}
          </Button>
          <Button variant="outline" onClick={() => setDeleteProjectOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete a project
          </Button>
          <Button variant="outline" onClick={() => setConfirm('clear-key')}>
            Clear AI settings
          </Button>
          <Button variant="destructive" onClick={() => setConfirm('delete-all')}>
            <AlertTriangle className="h-4 w-4" />
            Delete all local data
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          AI provider requests include only the necessary chunks / selections for the task — never your full document library.
          See the <LinkInline>Privacy section</LinkInline> of the README for the full contract.
        </p>
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => setConfirm(open ? confirm : null)}
        title={confirm === 'delete-all' ? 'Delete all local data?' : 'Clear AI settings?'}
        description={
          confirm === 'delete-all'
            ? 'Wipes every project, document, chunk, quiz, mistake, tutor session, and AI setting. Invite unlocks survive. This cannot be undone.'
            : 'The API key, base URL, and model name are cleared. Your projects and learning data are kept. Tutor and Quiz features will be unavailable until you reconfigure.'
        }
        requireText={confirm === 'delete-all' ? 'DELETE ALL' : 'CLEAR KEY'}
        confirmLabel={confirm === 'delete-all' ? 'Delete everything' : 'Clear settings'}
        variant={confirm === 'delete-all' ? 'destructive' : 'default'}
        busy={busy}
        onConfirm={confirm === 'delete-all' ? handleDeleteAll : handleClearKey}
      />

      <DeleteProjectDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        onDeleted={async () => {
          await refreshInventory()
          navigate('/dashboard')
        }}
      />
    </Card>
  )
}

function InventoryLine({ label, value, badge }: { label: string; value: number | string; badge?: 'default' | 'secondary' }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge ? <Badge variant={badge}>{value}</Badge> : <span className="font-mono tabular-nums">{value}</span>}
    </div>
  )
}

function LinkInline({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground underline underline-offset-2">{children}</span>
}
