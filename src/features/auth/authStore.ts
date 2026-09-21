import { create } from 'zustand'
import type { UserProfile, UserTheme } from '@/entities/user/types'
import type { ColorThemeId } from '@/features/theme/colorThemes'
import type { UILanguage } from '@/i18n/types'
import { t } from '@/i18n'
import { UserService } from '@/services/userService'
import { InviteService } from '@/services/inviteService'
import { logger } from '@/infrastructure/logger/logger'

interface AuthState {
  profile: UserProfile | null
  loaded: boolean
  loading: boolean
  error: string | null
}

interface AuthActions {
  load: () => Promise<void>
  unlock: (code: string) => Promise<void>
  lock: () => Promise<void>
  setTheme: (theme: UserTheme) => Promise<void>
  setColorTheme: (theme: ColorThemeId) => Promise<void>
  setName: (name: string) => Promise<void>
  setLanguage: (language: UserProfile['language']) => Promise<void>
  setUILanguage: (language: UILanguage) => Promise<void>
}

export type AuthStore = AuthState & AuthActions

const users = new UserService()
let inviteService: InviteService = new InviteService()

export function setInviteServiceForTesting(svc: InviteService | null): void {
  inviteService = svc ?? new InviteService()
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  profile: null,
  loaded: false,
  loading: false,
  error: null,

  async load() {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const profile = await users.get()
      set({ profile, loaded: true, loading: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToLoadProfile')
      logger.error('AuthStore.load failed', undefined, err)
      set({ error: msg, loaded: true, loading: false })
    }
  },

  async unlock(code) {
    set({ error: null })
    await inviteService.ensureSeeded()
    await inviteService.unlock(code)
    const profile = await users.get()
    set({ profile })
  },

  async lock() {
    await inviteService.lock()
    const profile = await users.get()
    set({ profile })
  },

  async setTheme(theme) {
    const next = await users.update({ theme })
    set({ profile: next })
  },

  async setColorTheme(colorTheme) {
    const next = await users.update({ colorTheme })
    set({ profile: next })
  },

  async setName(name) {
    const next = await users.update({ name })
    set({ profile: next })
  },

  async setLanguage(language) {
    const next = await users.update({ language })
    set({ profile: next })
  },

  async setUILanguage(uiLanguage) {
    const next = await users.update({ uiLanguage })
    set({ profile: next })
  },
}))