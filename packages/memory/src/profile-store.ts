import { MemoryDatabase } from './database.js';

export class ProfileStore {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase) {
    this.db = db;
  }

  set(userId: string, key: string, value: string): void {
    this.db.raw().prepare(`
      INSERT INTO user_profiles (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(userId, key, value, Date.now());
  }

  get(userId: string, key: string): string | undefined {
    const row = this.db.raw().prepare(
      'SELECT value FROM user_profiles WHERE user_id = ? AND key = ?'
    ).get(userId, key) as { value: string } | undefined;
    return row?.value;
  }

  getAll(userId: string): Record<string, string> {
    const rows = this.db.raw().prepare(
      'SELECT key, value FROM user_profiles WHERE user_id = ? ORDER BY key ASC'
    ).all(userId) as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  delete(userId: string, key: string): void {
    this.db.raw().prepare(
      'DELETE FROM user_profiles WHERE user_id = ? AND key = ?'
    ).run(userId, key);
  }

  getAsContext(userId: string): string {
    const all = this.getAll(userId);
    const entries = Object.entries(all);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  }
}
