import { describe, it, expect } from 'vitest';
import type {
  EventMap,
  EventBus,
  Disposable,
  AgentBackend,
  AgentRequest,
  AgentEvent,
  AgentEventBase,
  Attachment,
  PlatformAdapter,
  IncomingMessage,
  User,
  UserRole,
} from '../index.js';

describe('Core Types', () => {
  it('Attachment discriminated union narrows by type', () => {
    const attachments: Attachment[] = [
      { type: 'image', mimeType: 'image/png', data: Buffer.from('img') },
      { type: 'voice', mimeType: 'audio/ogg', data: Buffer.from('audio'), transcript: 'hello' },
      { type: 'file', mimeType: 'application/pdf', data: Buffer.from('pdf'), filename: 'doc.pdf' },
    ];
    const voices = attachments.filter((a) => a.type === 'voice');
    expect(voices).toHaveLength(1);
    expect(voices[0].transcript).toBe('hello');
  });

  it('User platformIds supports arbitrary platforms', () => {
    const user: User = {
      name: 'Dad',
      role: 'admin',
      platformIds: { discord: '123', telegram: '456', whatsapp: '789' },
    };
    expect(Object.keys(user.platformIds)).toHaveLength(3);
  });
});
