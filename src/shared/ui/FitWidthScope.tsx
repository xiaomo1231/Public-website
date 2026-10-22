import type { ReactNode } from 'react'
import { PRINT_FIT, SCREEN_FIT } from '@/shared/lib/fitToWidth'
import { FitWidthContext } from '@/shared/lib/useFitStage'

/**
 * Inside this scope, display / inline formulas, tables, code and matrices are
 * fitted to their column (broken into lines, scaled down, wrapped) instead of
 * scrolling sideways. Adds no element of its own. `print` = the print copy,
 * where nothing may scroll.
 */
export function FitWidthScope({
  children,
  print = false,
}: {
  children: ReactNode
  print?: boolean
}): JSX.Element {
  return (
    <FitWidthContext.Provider value={print ? PRINT_FIT : SCREEN_FIT}>
      {children}
    </FitWidthContext.Provider>
  )
}
