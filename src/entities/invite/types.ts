export interface InviteKeyRecord {
  code: string
  usedAt?: number
  usedBy?: string
  expiresAt?: number
}