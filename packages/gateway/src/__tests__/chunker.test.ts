import { describe, it, expect } from 'vitest';
import { chunkMessage } from '../chunker.js';

describe('chunkMessage', () => {
  it('returns empty array for empty string', () => {
    expect(chunkMessage('', 100)).toEqual([]);
  });

  it('returns single chunk when text fits', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits on newline boundaries', () => {
    const text = 'line one\nline two\nline three';
    const chunks = chunkMessage(text, 18);
    expect(chunks).toEqual(['line one\nline two', 'line three']);
  });

  it('hard-splits lines exceeding max length', () => {
    const text = 'a'.repeat(15);
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(5)]);
  });

  it('combines short lines after hard split remainder when combined fits', () => {
    const text = 'a'.repeat(15) + '\nhello';
    // 'aaaaa' (5) + '\n' + 'hello' (5) = 11 chars > 10, so they become separate chunks
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(5), 'hello']);
  });

  it('combines short lines after hard split remainder when combined fits within maxLength', () => {
    const text = 'a'.repeat(13) + '\nhi';
    // remainder 'aaa' (3) + '\n' + 'hi' (2) = 6 chars <= 10, so they combine
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'aaa\nhi']);
  });

  it('handles multiple newlines correctly', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 11);
    expect(chunks).toEqual(['line0\nline1', 'line2\nline3', 'line4']);
  });

  it('handles exact boundary fit', () => {
    const text = 'ab\ncd';
    expect(chunkMessage(text, 5)).toEqual(['ab\ncd']);
  });

  it('does not exceed maxLength when remainder + next line is too long', () => {
    const text = 'a'.repeat(15) + '\n' + 'b'.repeat(8);
    const chunks = chunkMessage(text, 10);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });

  it('handles discord 2000 char limit', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(2000);
    expect(chunks[1].length).toBe(500);
  });
});
