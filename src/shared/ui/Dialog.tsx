import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  createContext,
  forwardRef,
  useContext,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'

/**
 * Whether the enclosing dialog is open. `undefined` for uncontrolled dialogs,
 * whose content never needs freezing (see DialogContent).
 */
const DialogOpenContext = createContext<boolean | undefined>(undefined)

export function Dialog(props: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>): JSX.Element {
  return (
    <DialogOpenContext.Provider value={props.open}>
      <DialogPrimitive.Root {...props} />
    </DialogOpenContext.Provider>
  )
}
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { t } = useTranslation()
  /*
   * Controlled dialogs usually derive their content from state that the page
   * clears the moment it closes (`open={item !== null}`). The close animation
   * would then show that half-cleared content (e.g. the wrong title), so while
   * closing we keep rendering what was last shown while open.
   */
  const open = useContext(DialogOpenContext)
  const shownChildren = useRef(children)
  if (open !== false) shownChildren.current = children
  const content = open === false ? shownChildren.current : children
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-3xl border border-border/70 bg-card p-6 shadow-lift data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          className,
        )}
        {...props}
      >
        {content}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1.5 opacity-70 ring-offset-background transition-[opacity,background-color,transform] duration-200 hover:bg-accent hover:opacity-100 focus-ring disabled:pointer-events-none motion-safe:hover:rotate-90">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  )
}
DialogHeader.displayName = 'DialogHeader'

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}
DialogFooter.displayName = 'DialogFooter'

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('break-words text-base font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('break-words text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName