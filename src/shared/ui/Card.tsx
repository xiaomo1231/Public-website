import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * Surface variants.
 *
 * The platform deliberately avoids "everything is the same white rounded box":
 * callers pick the weight that matches the content. All variants share the
 * same radius and text colour so the page stays coherent.
 *
 * - `default`     — the standard content surface (soft elevation).
 * - `elevated`    — a raised surface for the single most important block.
 * - `interactive` — a clickable surface; lifts gently on hover (motion-safe).
 * - `accent`      — a theme-tinted panel for emphasis, not for reading text.
 * - `plain`       — no border or shadow; for grouping inside another surface.
 */
export type CardVariant = 'default' | 'elevated' | 'interactive' | 'accent' | 'plain'

const CARD_VARIANTS: Record<CardVariant, string> = {
  default: 'border-border/80 bg-card shadow-soft',
  elevated: 'border-border/70 bg-card shadow-lift',
  interactive:
    'border-border/80 bg-card shadow-soft motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lift',
  accent: 'border-theme-primary/25 bg-theme-primary-soft/45 shadow-soft',
  plain: 'border-transparent bg-transparent shadow-none',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-[1.5rem] text-card-foreground', CARD_VARIANTS[variant], className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref as never}
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'
