import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'

export type User = {
  id: string
  createdAt: string
}

type UserRow = {
  id: string
  created_at: string
}

export class UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createUser(): User {
    const user = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    this.db.prepare(
      'INSERT INTO users (id, created_at) VALUES (?, ?)',
    ).run(user.id, user.createdAt)
    return user
  }

  findUserById(userId: string): User | null {
    const row = this.db.prepare(
      'SELECT id, created_at FROM users WHERE id = ?',
    ).get(userId) as UserRow | undefined
    return row ? { id: row.id, createdAt: row.created_at } : null
  }
}
