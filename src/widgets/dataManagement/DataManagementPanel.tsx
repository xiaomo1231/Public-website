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
import { useTranslation } from '@/i18n'

type ConfirmAction = 'delete-all' | 'clear-key' | null

export function DataManagementPanel(): JSX.Element {
  const { t } = useTranslation()
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
      toast({ variant: 'success', title: t('data.exportReady'), description: t('data.exportReadyBody') })
    } catch (err) {
      toast({ variant: 'error', title: t('data.exportFailed'), description: (err as Error).message })
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteAll() {
    setBusy(true)
    try {
      await new DataManagementService().deleteAll()
      toast({ variant: 'success', title: t('data.allDeleted') })
      setConfirm(null)
      await refreshInventory()
    } catch (err) {
      toast({ variant: 'error', title: t('data.deleteFailed'), description: isAppError(err) ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function handleClearKey() {
    setBusy(true)
    try {
      await new DataManagementService().clearAISettings()
      toast({ variant: 'success', title: t('data.settingsCleared') })
      setConfirm(null)
      await refreshInventory()
    } catch (err) {
      toast({ variant: 'error', title: t('data.clearFailed'), description: isAppError(err) ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          {t('data.title')}
        </CardTitle>
        <CardDescription>
          {t('data.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <LoadingState label={t('data.loading')} inline />
        ) : inventory ? (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <InventoryLine label={t('data.projects')} value={inventory.projects} />
            <InventoryLine label={t('data.documents')} value={inventory.documents} />
            <InventoryLine label={t('data.chunks')} value={inventory.chunks} />
            <InventoryLine label={t('data.quizzes')} value={inventory.quizzes} />
            <InventoryLine label={t('data.tutorSessions')} value={inventory.tutorSessions} />
            <InventoryLine label={t('data.mistakes')} value={inventory.mistakes} />
            <InventoryLine label={t('data.translations')} value={inventory.translations} />
            <InventoryLine label={t('data.courseAnalyses')} value={inventory.courseAnalyses} />
            <InventoryLine label={t('data.documentBlobs')} value={formatBytes(inventory.estimatedTotalBytes)} />
            <InventoryLine label={t('data.aiKeyConfigured')} value={inventory.hasApiKey ? t('data.yes') : t('data.no')} badge={inventory.hasApiKey ? 'default' : 'secondary'} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? t('data.exporting') : t('data.export')}
          </Button>
          <Button variant="outline" onClick={() => setDeleteProjectOpen(true)}>
            <Trash2 className="h-4 w-4" />
            {t('data.deleteProject')}
          </Button>
          <Button variant="outline" onClick={() => setConfirm('clear-key')}>
            {t('data.clearAiSettings')}
          </Button>
          <Button variant="destructive" onClick={() => setConfirm('delete-all')}>
            <AlertTriangle className="h-4 w-4" />
            {t('data.deleteAll')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('data.privacy')}
          <LinkInline>{t('data.privacyLink')}</LinkInline>
          {t('data.privacyEnd')}
        </p>
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => setConfirm(open ? confirm : null)}
        title={confirm === 'delete-all' ? t('data.deleteAllTitle') : t('data.clearTitle')}
        description={
          confirm === 'delete-all'
            ? t('data.deleteAllBody')
            : t('data.clearBody')
        }
        requireText={confirm === 'delete-all' ? t('data.deleteAllConfirm') : t('data.clearConfirm')}
        confirmLabel={confirm === 'delete-all' ? t('data.deleteAllAction') : t('data.clearAction')}
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
