import { MemoryDatabase } from './database.js';
import { estimateTokens } from './token-counter.js';

export interface StoredMessage {
  id: number;
  userId: string;
  sessionId: string;
  platform: string;
  content: string;
  role: 'user' | 'assistant';
  attachments: string | null;
  timestamp: number;
  tokens: number;
}

export interface AddMessageParams {
  userId: string;
  sessionId: string;
  platform: string;
  content: string;
  role: 'user' | 'assistant';
  attachments?: string;
  timestamp?: number;
  tokens?: number;
}

export class MessageStore {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase) {
    this.db = db;
  }

  add(params: AddMessageParams): number {
    const timestamp = params.timestamp ?? Date.now();
    const tokens = params.tokens ?? estimateTokens(params.content);

    const result = this.db.raw().prepare(`
      INSERT INTO messages (user_id, session_id, platform, content, role, attachments, timestamp, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId,
      params.sessionId,
      params.platform,
      params.content,
      params.role,
      params.attachments ?? null,
      timestamp,
      tokens,
    );

    return result.lastInsertRowid as number;
  }

  getById(id: number): StoredMessage | undefined {
    const row = this.db.raw().prepare(
      'SELECT * FROM messages WHERE id = ?'
    ).get(id);
    if (!row) return undefined;
    return this.toMessage(row as any);
  }

  getFreshTail(userId: string, sessionId: string, limit: number): StoredMessage[] {
    // Fetch the last `limit` rows by timestamp DESC, then reverse to get chronological order
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages
      WHERE user_id = ? AND session_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(userId, sessionId, limit);
    return rows.reverse().map((r: any) => this.toMessage(r));
  }

  getByUser(userId: string, limit?: number): StoredMessage[] {
    if (limit !== undefined) {
      const rows = this.db.raw().prepare(`
        SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?
      `).all(userId, limit);
      return rows.map((r: any) => this.toMessage(r));
    }
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp ASC, id ASC
    `).all(userId);
    return rows.map((r: any) => this.toMessage(r));
  }

  getByTimeRange(userId: string, startMs: number, endMs: number): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages
      WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC, id ASC
    `).all(userId, startMs, endMs);
    return rows.map((r: any) => this.toMessage(r));
  }

  getTotalTokens(userId: string): number {
    const row = this.db.raw().prepare(
      'SELECT COALESCE(SUM(tokens), 0) as total FROM messages WHERE user_id = ?'
    ).get(userId) as { total: number };
    return row.total;
  }

  search(userId: string, query: string): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages
      WHERE user_id = ? AND content LIKE ?
      ORDER BY timestamp ASC, id ASC
    `).all(userId, `%${query}%`);
    return rows.map((r: any) => this.toMessage(r));
  }

  getMessageCount(userId: string): number {
    const row = this.db.raw().prepare(
      'SELECT COUNT(*) as count FROM messages WHERE user_id = ?'
    ).get(userId) as { count: number };
    return row.count;
  }

  private toMessage(row: any): StoredMessage {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      platform: row.platform,
      content: row.content,
      role: row.role as 'user' | 'assistant',
      attachments: row.attachments,
      timestamp: row.timestamp,
      tokens: row.tokens,
    };
  }
}
