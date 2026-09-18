import { create } from 'zustand'
import { TOAST_DEFAULT_DURATION, TOAST_LIMIT } from '@/shared/config/config'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  createdAt: number
}

interface ToastState {
  toasts: Toast[]
}

interface ToastActions {
  push: (toast: Omit<Toast, 'id' | 'createdAt'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

export type ToastStore = ToastState & ToastActions

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push(toast) {
    const id = crypto.randomUUID()
    const full: Toast = {
      id,
      createdAt: Date.now(),
      variant: 'default',
      duration: TOAST_DEFAULT_DURATION,
      ...toast,
    }
    set((s) => {
      const next = [...s.toasts, full]
      if (next.length > TOAST_LIMIT) next.shift()
      return { toasts: next }
    })
    if (full.duration && full.duration > 0) {
      setTimeout(() => get().dismiss(id), full.duration)
    }
    return id
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  clear() {
    set({ toasts: [] })
  },
}))

export function toast(input: Omit<Toast, 'id' | 'createdAt'>): string {
  return useToastStore.getState().push(input)
}