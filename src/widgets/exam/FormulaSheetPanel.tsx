import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { FormulaSheet } from '@/entities/exam/paper'
import type { MockExamService } from '@/services/mockExamService'
import { useTranslation } from '@/i18n'

/**
 * The paper's own formula / data sheet beside the mock exam, as on the paper:
 * the rendered page(s) when the paper is a PDF, and always the extracted text
 * with a link to the page. Nothing is added or rewritten.
 */
export function FormulaSheetPanel({
  sheet,
  setId,
  projectId,
  documentId,
  service,
}: {
  sheet: FormulaSheet
  setId: string
  projectId: string
  documentId: string
  service: MockExamService
}): JSX.Element {
  const { t } = useTranslation()
  const [images, setImages] = useState<Array<{ page: number; url: string }>>([])

  useEffect(() => {
    let alive = true
    const urls: string[] = []
    void service
      .formulaSheetImages(setId)
      .then((pages) => {
        if (!alive) return
        const next = pages.map((page) => {
          const url = URL.createObjectURL(page.image)
          urls.push(url)
          return { page: page.page, url }
        })
        setImages(next)
      })
      .catch(() => {
        /* the extracted text below stays available */
      })
    return () => {
      alive = false
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [service, setId])

  return (
    <aside
      aria-label={t('mockExam.formulaSheet')}
      className="space-y-3 rounded-lg border bg-card p-3 text-sm lecture:rounded-none lecture:border-x-0 lecture:bg-transparent lab:rounded-none"
      data-formula-sheet
    >
      <div className="flex items-center gap-2 font-medium">
        <FileText className="h-4 w-4" aria-hidden />
        {t('mockExam.formulaSheet')}
      </div>
      <p className="text-xs text-muted-foreground">{t('mockExam.formulaSheetHint')}</p>
      {images.map((image) => (
        <figure key={image.page} className="space-y-1">
          <img
            src={image.url}
            alt={t('mockExam.formulaSheetPage', { page: image.page })}
            className="w-full border bg-white"
          />
          <figcaption className="text-xs text-muted-foreground">
            {t('mockExam.formulaSheetPage', { page: image.page })}
          </figcaption>
        </figure>
      ))}
      {images.length === 0 && (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
          {sheet.text}
        </pre>
      )}
      <Link
        to={`/projects/${projectId}/documents/${documentId}${sheet.pages[0] ? `?page=${sheet.pages[0]}` : ''}`}
        className="inline-flex min-h-[44px] items-center text-xs text-primary underline-offset-2 hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {sheet.pages.length > 0
          ? t('mockExam.formulaSheetOpen', { pages: sheet.pages.join(', ') })
          : t('mockExam.formulaSheetOpenFile')}
      </Link>
    </aside>
  )
}
