import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors motion-safe:transition-[transform,background-color,box-shadow,color,border-color] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.96] focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg.lucide-arrow-right]:transition-transform [&_svg.lucide-arrow-right]:duration-200 motion-safe:[&:hover_svg.lucide-arrow-right]:translate-x-0.5',
  {
    variants: {
      variant: {
        default:
          'bg-primary-strong text-primary-foreground shadow-soft hover:bg-primary-strong/90 hover:shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.7)]',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline:
          'border border-input bg-background hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-12 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
