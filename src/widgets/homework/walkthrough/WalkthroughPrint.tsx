import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { RichText } from '@/shared/ui/RichText'
import { useTranslation } from '@/i18n'

export interface PrintableSection {
  id: string
  title: string
  conclusion?: string
  body: string
  suggestions?: string[]
}

/**
 * A plain copy of the walkthrough for the browser's print dialog, where
 * "Save as PDF" makes the PDF. It is mounted only while printing; the print
 * stylesheet hides everything else (see `#walkthrough-print` in globals.css).
 */
export function WalkthroughPrint({
  title,
  sections,
  onDone,
}: {
  title: string
  sections: PrintableSection[]
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  // The dialog opens once per mount, whatever the parent re-renders.
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const body = document.body
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      body.classList.remove('printing-walkthrough')
      done.current()
    }
    body.classList.add('printing-walkthrough')
    window.addEventListener('afterprint', finish)
    // Let KaTeX lay out before the dialog snapshots the page.
    const timer = window.setTimeout(() => window.print(), 150)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', finish)
      body.classList.remove('printing-walkthrough')
    }
  }, [])

  return createPortal(
    <div id="walkthrough-print" className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {sections.map((section) => (
        <section key={section.id} className="space-y-3">
          <h2 className="border-b pb-1 text-xl font-semibold">{section.title}</h2>
          {section.conclusion && (
            <div className="border-l-4 pl-3">
              <strong>{t('homework.walkthrough.conclusion')}</strong>
              <RichText
                text={section.conclusion}
                format="markdown"
                paragraphClassName="text-[14px] leading-relaxed"
              />
            </div>
          )}
          <RichText
            text={section.body}
            format="markdown"
            className="space-y-2"
            paragraphClassName="text-[14px] leading-[1.7]"
          />
          {section.suggestions && section.suggestions.length > 0 && (
            <>
              <h3 className="text-base font-semibold">{t('homework.walkthrough.suggestions')}</h3>
              <ul className="list-disc space-y-1 pl-5">
                {section.suggestions.map((item, index) => (
                  <li key={index}>
                    <RichText
                      text={item}
                      format="markdown"
                      paragraphClassName="text-[14px] leading-relaxed"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </div>,
    document.body,
  )
}
