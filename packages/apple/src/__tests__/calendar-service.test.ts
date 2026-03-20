import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppleCalendarService } from '../calendar-service.js';
import type { SwiftBridge } from '../swift-bridge.js';

function createMockBridge(): SwiftBridge & { exec: ReturnType<typeof vi.fn> } {
  return { exec: vi.fn() } as any;
}

describe('AppleCalendarService', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let service: AppleCalendarService;

  beforeEach(() => {
    bridge = createMockBridge();
    service = new AppleCalendarService(bridge);
  });

  describe('listEvents()', () => {
    it('calls bridge with calendar list args', async () => {
      bridge.exec.mockResolvedValue({ success: true, events: [] });

      const result = await service.listEvents('2026-03-19T00:00:00Z', '2026-03-20T00:00:00Z');

      expect(bridge.exec).toHaveBeenCalledWith([
        'calendar', 'list', '--from', '2026-03-19T00:00:00Z', '--to', '2026-03-20T00:00:00Z',
      ]);
      expect(result).toEqual([]);
    });
  });

  describe('searchEvents()', () => {
    it('calls bridge with calendar search args', async () => {
      bridge.exec.mockResolvedValue({ success: true, events: [{ id: '1', title: 'Dentist' }] });

      const result = await service.searchEvents('dentist');

      expect(bridge.exec).toHaveBeenCalledWith([
        'calendar', 'search', '--query', 'dentist',
      ]);
      expect(result).toHaveLength(1);
    });

    it('passes optional date range', async () => {
      bridge.exec.mockResolvedValue({ success: true, events: [] });

      await service.searchEvents('meeting', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');

      expect(bridge.exec).toHaveBeenCalledWith([
        'calendar', 'search', '--query', 'meeting',
        '--from', '2026-01-01T00:00:00Z', '--to', '2026-06-01T00:00:00Z',
      ]);
    });
  });

  describe('createEvent()', () => {
    it('calls bridge with create args', async () => {
      bridge.exec.mockResolvedValue({
        success: true,
        event: { id: 'new1', title: 'Meeting', startDate: '2026-03-20T14:00:00Z', endDate: '2026-03-20T15:00:00Z', calendar: 'Work', location: '', notes: '', isAllDay: false },
      });

      const result = await service.createEvent({
        title: 'Meeting',
        start: '2026-03-20T14:00:00Z',
        end: '2026-03-20T15:00:00Z',
        calendar: 'Work',
      });

      expect(bridge.exec).toHaveBeenCalledWith([
        'calendar', 'create',
        '--title', 'Meeting',
        '--start', '2026-03-20T14:00:00Z',
        '--end', '2026-03-20T15:00:00Z',
        '--calendar', 'Work',
      ]);
      expect(result.id).toBe('new1');
    });

    it('includes optional fields when provided', async () => {
      bridge.exec.mockResolvedValue({
        success: true,
        event: { id: 'new2', title: 'Birthday', startDate: '', endDate: '', calendar: '', location: 'Home', notes: 'Party', isAllDay: true },
      });

      await service.createEvent({
        title: 'Birthday',
        start: '2026-04-01T00:00:00Z',
        end: '2026-04-02T00:00:00Z',
        location: 'Home',
        notes: 'Party',
        allDay: true,
      });

      const args = bridge.exec.mock.calls[0][0] as string[];
      expect(args).toContain('--location');
      expect(args).toContain('--notes');
      expect(args).toContain('--all-day');
    });
  });

  describe('updateEvent()', () => {
    it('calls bridge with update args', async () => {
      bridge.exec.mockResolvedValue({
        success: true,
        event: { id: 'abc', title: 'Updated', startDate: '', endDate: '', calendar: '', location: '', notes: '', isAllDay: false },
      });

      await service.updateEvent('abc', { title: 'Updated' });

      expect(bridge.exec).toHaveBeenCalledWith([
        'calendar', 'update', '--id', 'abc', '--title', 'Updated',
      ]);
    });
  });

  describe('deleteEvent()', () => {
    it('calls bridge with delete args', async () => {
      bridge.exec.mockResolvedValue({ success: true });

      await service.deleteEvent('abc');

      expect(bridge.exec).toHaveBeenCalledWith(['calendar', 'delete', '--id', 'abc']);
    });

    it('throws when bridge returns error', async () => {
      bridge.exec.mockResolvedValue({ success: false, error: 'Event not found' });

      await expect(service.deleteEvent('bad')).rejects.toThrow('Event not found');
    });
  });

  describe('getToolDefinitions()', () => {
    it('returns 5 tool definitions', () => {
      const tools = service.getToolDefinitions();
      expect(tools).toHaveLength(5);
      const names = tools.map(t => t.name);
      expect(names).toContain('apple_calendar_list');
      expect(names).toContain('apple_calendar_search');
      expect(names).toContain('apple_calendar_create');
      expect(names).toContain('apple_calendar_update');
      expect(names).toContain('apple_calendar_delete');
    });
  });
});
