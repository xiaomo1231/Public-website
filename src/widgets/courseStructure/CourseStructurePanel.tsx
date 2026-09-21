import { useEffect, useState } from 'react'
import { ListTree } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { CourseStructureService } from '@/services/courseStructureService'
import type {
  CourseStructureNode,
  StructureConfidence,
} from '@/entities/courseStructure/types'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

/**
 * The textbook's chapter/section tree.
 *
 * Read-only: it shows the structure detected from the material, so the learner
 * can navigate by the book's own outline rather than a model-invented list.
 */
export interface CourseStructurePanelProps {
  projectId: string
  /** Currently selected node (chapter or section), if any. */
  selectedId?: string
  onSelect?: (node: CourseStructureNode) => void
}

export function CourseStructurePanel({
  projectId,
  selectedId,
  onSelect,
}: CourseStructurePanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const [nodes, setNodes] = useState<CourseStructureNode[]>([])
  const [confidence, setConfidence] = useState<StructureConfidence | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const service = new CourseStructureService()
      const structures = await service.listByProject(projectId)
      const primary = structures[0]
      if (!primary) {
        if (!cancelled) {
          setNodes([])
          setConfidence(null)
        }
        return
      }
      const list = await service.listNodes(primary.id)
      if (cancelled) return
      setNodes(list)
      setConfidence(primary.confidence)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (confidence === null) return null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {t('structure.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {confidence === 'low' ? (
          <p className="text-xs text-muted-foreground">{t('structure.lowConfidence')}</p>
        ) : nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('structure.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {nodes.map((node) => {
              const label = `${node.number ? `${node.number} ` : ''}${node.title}`
              const page =
                node.sourcePageStart !== undefined
                  ? t('structure.pageRange', {
                      start: node.sourcePageStart,
                      end: node.sourcePageEnd ?? node.sourcePageStart,
                    })
                  : undefined
              const selectable = Boolean(onSelect) && node.type !== 'subsection'
              return (
                <li key={node.id} className={cn(node.depth > 0 && 'pl-4', node.depth > 1 && 'pl-8')}>
                  {selectable ? (
                    <button
                      type="button"
                      onClick={() => onSelect?.(node)}
                      aria-pressed={selectedId === node.id}
                      className={cn(
                        'flex w-full min-w-0 flex-wrap items-baseline gap-x-1 rounded px-1 py-0.5 text-left text-sm transition-colors',
                        node.depth > 0 && 'text-muted-foreground',
                        selectedId === node.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <span className="min-w-0 break-words">{label}</span>
                      {page && <span className="text-[11px] text-muted-foreground">{page}</span>}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        'flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm',
                        node.depth > 0 && 'text-muted-foreground',
                      )}
                    >
                      <span className="min-w-0 break-words">{label}</span>
                      {page && <span className="text-[11px] text-muted-foreground">{page}</span>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
