import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Database, Download, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import type { SectionShellProps } from '@/widgets/settings/settingsSection'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { DataManagementService, type DataInventory } from '@/services/dataManagementService'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { RestoreBackupSection } from './RestoreBackupSection'
import { useSettingsStore } from '@/features/settings/settingsStore'
import { SettingsService } from '@/services/settingsService'
import { useProjectStore } from '@/features/project/projectStore'
import { useAuthStore } from '@/features/auth/authStore'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { formatBytes } from '@/shared/lib/format'
import { downloadBlob } from '@/shared/lib/download'
import { useTranslation } from '@/i18n'

type ConfirmAction = 'delete-all' | 'clear-key' | null

/**
 * Replace the settings store's copy with what is stored now. Done without the
 * store's `load()` so the settings page does not swap to its loading state
 * (and unmount this panel) mid-action.
 */
async function reloadSettingsStore(): Promise<void> {
  const settings = await new SettingsService().get()
  useSettingsStore.setState({ settings, loaded: true, error: null })
}

interface DataManagementPanelProps {
  /**
   * Called after the stored AI settings were cleared (alone or with all data),
   * once the settings store holds the fresh values, so a page holding an
   * edit draft can drop the old key instead of saving it back.
   */
  onSettingsCleared?: () => void
}

export function DataManagementPanel({
  onSettingsCleared,
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
}: DataManagementPanelProps & SectionShellProps = {}): JSX.Element {
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
      .catch(() => toast({ variant: 'error', title: t('data.inventoryFailed') }))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on mount
  }, [])

  async function refreshInventory() {
    setLoading(true)
    try {
      setInventory(await new DataManagementService().inventory())
    } catch {
      toast({ variant: 'error', title: t('data.inventoryFailed') })
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await new DataManagementService().exportFile()
      downloadBlob(`ai-learning-export-${new Date().toISOString().slice(0, 10)}.json`, blob)
      toast({
        variant: 'success',
        title: t('data.exportReady'),
        description: t('data.exportReadyBody'),
      })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('data.exportFailed'),
        description: (err as Error).message,
      })
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteAll() {
    setBusy(true)
    try {
      await new DataManagementService().deleteAll()
      // Drop every in-memory copy of the wiped data: the decrypted key, the
      // project list and the unlocked profile (which sends the app back to
      // the invite gate).
      useProjectStore.getState().reset()
      await reloadSettingsStore()
      onSettingsCleared?.()
      toast({ variant: 'success', title: t('data.allDeleted') })
      setConfirm(null)
      await refreshInventory()
      await useAuthStore.getState().load()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('data.deleteFailed'),
        description: isAppError(err) ? err.message : (err as Error).message,
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleClearKey() {
    setBusy(true)
    try {
      await new DataManagementService().clearAISettings()
      await reloadSettingsStore()
      onSettingsCleared?.()
      toast({ variant: 'success', title: t('data.settingsCleared') })
      setConfirm(null)
      await refreshInventory()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('data.clearFailed'),
        description: isAppError(err) ? err.message : (err as Error).message,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={className}>
      <CardHeader className={headerClassName}>
        <CardTitle className={cn('flex items-center gap-2 text-base', titleClassName)}>
          <Database className="h-4 w-4 lecture:hidden" />
          {t('data.title')}
        </CardTitle>
        <CardDescription>{t('data.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-4', bodyClassName)}>
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
            <InventoryLine
              label={t('data.documentBlobs')}
              value={formatBytes(inventory.estimatedTotalBytes)}
            />
            <InventoryLine
              label={t('data.aiKeyConfigured')}
              value={inventory.hasApiKey ? t('data.yes') : t('data.no')}
              badge={inventory.hasApiKey ? 'default' : 'secondary'}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
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

        <RestoreBackupSection onExport={handleExport} exporting={exporting} />

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
        description={confirm === 'delete-all' ? t('data.deleteAllBody') : t('data.clearBody')}
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

function InventoryLine({
  label,
  value,
  badge,
}: {
  label: string
  value: number | string
  badge?: 'default' | 'secondary'
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant={badge}>{value}</Badge>
      ) : (
        <span className="font-mono tabular-nums">{value}</span>
      )}
    </div>
  )
}

function LinkInline({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground underline underline-offset-2">{children}</span>
}
