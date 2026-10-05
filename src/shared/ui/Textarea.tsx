import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[color,background-color,border-color,box-shadow] duration-200 placeholder:text-muted-foreground hover:border-primary/40 focus-ring disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-destructive focus-visible:ring-destructive',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'