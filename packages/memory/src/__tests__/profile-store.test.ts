import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryDatabase } from '../database.js';
import { ProfileStore } from '../profile-store.js';

describe('ProfileStore', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let store: ProfileStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccbuddy-ps-test-'));
    db = new MemoryDatabase(join(tmpDir, 'test.db'));
    db.init();
    store = new ProfileStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('set() and get()', () => {
    it('stores and retrieves a key-value pair', () => {
      store.set('u1', 'language', 'English');
      expect(store.get('u1', 'language')).toBe('English');
    });

    it('updates an existing key with new value', () => {
      store.set('u1', 'timezone', 'UTC');
      store.set('u1', 'timezone', 'America/New_York');
      expect(store.get('u1', 'timezone')).toBe('America/New_York');
    });

    it('returns undefined for a missing key', () => {
      expect(store.get('u1', 'nonexistent')).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('returns all key-value pairs for a user as a Record', () => {
      store.set('u1', 'language', 'French');
      store.set('u1', 'timezone', 'Europe/Paris');
      store.set('u1', 'style', 'concise');

      const all = store.getAll('u1');
      expect(all).toEqual({
        language: 'French',
        timezone: 'Europe/Paris',
        style: 'concise',
      });
    });

    it('returns empty object when user has no profile entries', () => {
      expect(store.getAll('unknown')).toEqual({});
    });
  });

  describe('delete()', () => {
    it('removes a specific key', () => {
      store.set('u1', 'language', 'Spanish');
      store.set('u1', 'timezone', 'UTC');

      store.delete('u1', 'language');

      expect(store.get('u1', 'language')).toBeUndefined();
      expect(store.get('u1', 'timezone')).toBe('UTC');
    });

    it('does not throw when deleting a non-existent key', () => {
      expect(() => store.delete('u1', 'ghost')).not.toThrow();
    });
  });

  describe('user isolation', () => {
    it('does not return entries from other users', () => {
      store.set('u1', 'language', 'English');
      store.set('u2', 'language', 'German');

      expect(store.get('u1', 'language')).toBe('English');
      expect(store.get('u2', 'language')).toBe('German');

      const u1All = store.getAll('u1');
      expect(Object.keys(u1All)).toHaveLength(1);
      expect(u1All['language']).toBe('English');
    });
  });

  describe('getAsContext()', () => {
    it('formats entries as "key: value" lines for prompt injection', () => {
      store.set('u1', 'language', 'English');
      store.set('u1', 'style', 'concise');
      store.set('u1', 'timezone', 'UTC');

      const ctx = store.getAsContext('u1');
      // Keys are returned alphabetically from getAll
      expect(ctx).toBe('language: English\nstyle: concise\ntimezone: UTC');
    });

    it('returns empty string when user has no profile entries', () => {
      expect(store.getAsContext('unknown')).toBe('');
    });
  });
});
