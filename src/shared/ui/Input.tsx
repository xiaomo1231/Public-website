import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-[color,background-color,border-color,box-shadow] duration-200 placeholder:text-muted-foreground hover:border-primary/40 focus-ring disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-destructive focus-visible:ring-destructive',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'