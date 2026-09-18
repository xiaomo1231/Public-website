export type UserLanguage = 'auto' | 'zh' | 'en'
export type UserTheme = 'light' | 'dark' | 'system'

export interface UserProfile {
  id: 'singleton'
  name: string
  language: UserLanguage
  theme: UserTheme
  unlockedAt?: number
  inviteCode?: string
}

export interface UpdateUserInput {
  name?: string
  language?: UserLanguage
  theme?: UserTheme
}