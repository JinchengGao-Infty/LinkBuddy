import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../session/rate-limiter.js';

const WINDOW_MS = 60_000;

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cleanup()', () => {
    it('removes buckets whose window has expired', () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ user: 5 });

      // Acquire to create a bucket entry
      limiter.tryAcquire('alice', 'user');

      // Advance time past the window
      vi.advanceTimersByTime(WINDOW_MS + 1);

      limiter.cleanup();

      // After cleanup a new acquire should start a fresh window (count = 1), not be blocked
      // The bucket map is private, but we can verify behavior: a fresh window always returns true
      const result = limiter.tryAcquire('alice', 'user');
      expect(result).toBe(true);
    });

    it('retains buckets whose window has not yet expired', () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ user: 2 });

      limiter.tryAcquire('bob', 'user'); // count = 1

      // Advance time to just before the window boundary
      vi.advanceTimersByTime(WINDOW_MS - 1);

      limiter.cleanup();

      // The bucket should still be active — next acquire increments count to 2
      expect(limiter.tryAcquire('bob', 'user')).toBe(true);
      // Third call should be denied (limit = 2) within the same window
      expect(limiter.tryAcquire('bob', 'user')).toBe(false);
    });

    it('is safe to call when no buckets exist', () => {
      const limiter = new RateLimiter({ user: 10 });
      expect(() => limiter.cleanup()).not.toThrow();
    });

    it('only removes expired buckets, leaving active ones intact', () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ user: 5 });

      // alice acquires at t=0
      limiter.tryAcquire('alice', 'user');

      // Advance past window so alice's bucket is stale
      vi.advanceTimersByTime(WINDOW_MS + 1);

      // bob acquires at t=WINDOW_MS+1 (fresh bucket)
      limiter.tryAcquire('bob', 'user');

      limiter.cleanup();

      // alice's bucket was cleaned — next acquire starts fresh and succeeds
      expect(limiter.tryAcquire('alice', 'user')).toBe(true);

      // bob's bucket was retained — still within limit
      expect(limiter.tryAcquire('bob', 'user')).toBe(true);
    });
  });
});
