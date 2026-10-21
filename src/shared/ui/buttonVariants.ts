import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm lab:rounded-md font-medium transition-[background-color,box-shadow,color,border-color,transform] duration-press ease-out motion-safe:active:scale-[0.97] focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg.lucide-arrow-right]:transition-transform [&_svg.lucide-arrow-right]:duration-200 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:[&:hover_svg.lucide-arrow-right]:translate-x-0.5',
  {
    variants: {
      variant: {
        default:
          // Lecture keeps the accent rare: its main action is set in ink.
          'bg-primary-strong text-primary-foreground shadow-soft hover:bg-primary-strong/90 hover:shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.7)] lecture:bg-foreground lecture:text-background lecture:hover:bg-foreground/90 lecture:hover:shadow-none lab:hover:shadow-none',
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
