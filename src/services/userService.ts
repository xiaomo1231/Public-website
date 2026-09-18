import type { AppDatabase } from '@/infrastructure/db/database'
import { UserRepository } from '@/entities/user/repository'
import type { UpdateUserInput, UserProfile } from '@/entities/user/types'

export class UserService {
  private repo: UserRepository

  constructor(db?: AppDatabase) {
    this.repo = new UserRepository(db)
  }

  get(): Promise<UserProfile> {
    return this.repo.get()
  }

  update(patch: UpdateUserInput): Promise<UserProfile> {
    return this.repo.update(patch)
  }
}