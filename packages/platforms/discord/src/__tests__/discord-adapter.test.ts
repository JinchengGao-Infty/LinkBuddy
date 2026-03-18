import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockSendTyping = vi.fn().mockResolvedValue(undefined);
const mockChannel = {
  isTextBased: () => true,
  send: mockSend,
  sendTyping: mockSendTyping,
};

const eventHandlers = new Map<string, Function>();
const mockLogin = vi.fn().mockResolvedValue('token');
const mockDestroy = vi.fn();

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
    }),
    login: mockLogin,
    destroy: mockDestroy,
    user: { id: 'bot-user-id' },
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    DirectMessages: 4096,
    MessageContent: 32768,
  },
  ChannelType: { DM: 1, GuildText: 0 },
  Partials: { Channel: 2 },
}));

import { DiscordAdapter } from '../discord-adapter.js';
import type { IncomingMessage } from '@ccbuddy/core';

function fakeDiscordMessage(overrides: Record<string, unknown> = {}) {
  return {
    author: { id: '123', bot: false },
    channelId: 'ch1',
    channel: { type: 0 },
    content: 'Hello!',
    mentions: { has: vi.fn().mockReturnValue(false) },
    attachments: new Map(),
    reference: null,
    ...overrides,
  };
}

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter;
  let receivedMessages: IncomingMessage[];

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    receivedMessages = [];
    adapter = new DiscordAdapter({ token: 'test-token' });
    adapter.onMessage((msg) => receivedMessages.push(msg));
  });

  describe('start / stop', () => {
    it('logs in with token on start', async () => {
      await adapter.start();
      expect(mockLogin).toHaveBeenCalledWith('test-token');
    });

    it('destroys client on stop', async () => {
      await adapter.start();
      await adapter.stop();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('message normalization', () => {
    it('normalizes a guild text message', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage());

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(
        expect.objectContaining({
          platform: 'discord',
          platformUserId: '123',
          channelId: 'ch1',
          channelType: 'group',
          text: 'Hello!',
          isMention: false,
        }),
      );
    });

    it('detects DM channel type', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ channel: { type: 1 } }));

      expect(receivedMessages[0].channelType).toBe('dm');
      expect(receivedMessages[0].isMention).toBe(true);
    });

    it('detects bot mention', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({
        mentions: { has: vi.fn().mockReturnValue(true) },
      }));

      expect(receivedMessages[0].isMention).toBe(true);
    });

    it('ignores bot messages', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ author: { id: '999', bot: true } }));

      expect(receivedMessages).toHaveLength(0);
    });

    it('captures reply reference', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ reference: { messageId: 'ref-123' } }));

      expect(receivedMessages[0].replyToMessageId).toBe('ref-123');
    });

    it('normalizes attachments with metadata (data buffer deferred)', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      const attachments = new Map([
        ['att1', { contentType: 'image/png', name: 'photo.png' }],
        ['att2', { contentType: 'application/pdf', name: 'doc.pdf' }],
      ]);
      handler(fakeDiscordMessage({ attachments }));

      expect(receivedMessages[0].attachments).toHaveLength(2);
      expect(receivedMessages[0].attachments[0]).toEqual(
        expect.objectContaining({ type: 'image', mimeType: 'image/png', filename: 'photo.png' }),
      );
      expect(receivedMessages[0].attachments[1]).toEqual(
        expect.objectContaining({ type: 'file', mimeType: 'application/pdf', filename: 'doc.pdf' }),
      );
    });
  });

  describe('sending', () => {
    it('sends text to channel', async () => {
      await adapter.sendText('ch1', 'Reply');
      expect(mockSend).toHaveBeenCalledWith('Reply');
    });

    it('sends image with caption', async () => {
      const buf = Buffer.from('png');
      await adapter.sendImage('ch1', buf, 'My image');
      expect(mockSend).toHaveBeenCalledWith({
        content: 'My image',
        files: [{ attachment: buf, name: 'image.png' }],
      });
    });

    it('sends image without caption', async () => {
      const buf = Buffer.from('png');
      await adapter.sendImage('ch1', buf);
      expect(mockSend).toHaveBeenCalledWith({
        files: [{ attachment: buf, name: 'image.png' }],
      });
    });

    it('sends file', async () => {
      const buf = Buffer.from('data');
      await adapter.sendFile('ch1', buf, 'report.pdf');
      expect(mockSend).toHaveBeenCalledWith({
        files: [{ attachment: buf, name: 'report.pdf' }],
      });
    });

    it('sends typing indicator', async () => {
      await adapter.setTypingIndicator('ch1', true);
      expect(mockSendTyping).toHaveBeenCalled();
    });

    it('no-ops for typing indicator false', async () => {
      await adapter.setTypingIndicator('ch1', false);
      expect(mockSendTyping).not.toHaveBeenCalled();
    });
  });
});
