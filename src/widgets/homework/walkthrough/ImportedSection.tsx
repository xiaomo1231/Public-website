import { Link } from 'react-router-dom'
import { AlertTriangle, FileInput } from 'lucide-react'
import type { WalkthroughImportIssue } from '@/entities/homework/walkthrough'
import { Badge } from '@/shared/ui/Badge'
import { RichText } from '@/shared/ui/RichText'
import { useTranslation } from '@/i18n'

/** 「来自导入」 with a link to the imported file. */
export function ImportedBadge({
  projectId,
  documentId,
}: {
  projectId: string
  documentId?: string | undefined
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5" data-imported-section>
      <Badge variant="outline" className="gap-1">
        <FileInput className="h-3 w-3" aria-hidden />
        {t('walkthroughImport.badge')}
      </Badge>
      {documentId && (
        <Link
          to={`/projects/${projectId}/documents/${documentId}`}
          className="focus-ring text-xs text-primary underline-offset-2 hover:underline"
          data-print-hidden
        >
          {t('walkthroughImport.openOriginal')}
        </Link>
      )}
    </span>
  )
}

/**
 * 「这里可能有误」: what the import suspects is wrong. Shown next to the
 * author's text, which itself is never changed.
 */
export function ImportIssuesView({ issues }: { issues: WalkthroughImportIssue[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 text-sm" data-import-issues>
      {issues.map((issue, index) => (
        <div
          key={index}
          className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 lecture:rounded-none lecture:border-x-0 lecture:bg-transparent lecture:px-0 lab:rounded-none"
        >
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            {t('walkthroughImport.issueTitle')}
          </p>
          <blockquote className="border-l-2 pl-3 text-muted-foreground">
            <RichText text={issue.quote} format="markdown" paragraphClassName="text-sm" />
          </blockquote>
          <RichText
            text={issue.note}
            format="markdown"
            paragraphClassName="text-sm leading-relaxed"
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('walkthroughImport.issueScope')}</p>
    </div>
  )
}
