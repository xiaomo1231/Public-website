import { cn } from '@/shared/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps): JSX.Element {
  const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
    default: 'bg-primary-strong text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border text-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}