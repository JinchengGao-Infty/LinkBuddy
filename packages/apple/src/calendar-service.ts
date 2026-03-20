import type { SwiftBridge } from './swift-bridge.js';
import type { ToolDescription } from '@ccbuddy/core';

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  calendar: string;
  location: string;
  notes: string;
  isAllDay: boolean;
}

export interface CreateEventParams {
  title: string;
  start: string;
  end: string;
  calendar?: string;
  location?: string;
  notes?: string;
  allDay?: boolean;
}

export interface UpdateEventParams {
  title?: string;
  start?: string;
  end?: string;
  calendar?: string;
  location?: string;
  notes?: string;
}

export class AppleCalendarService {
  private readonly bridge: SwiftBridge;

  constructor(bridge: SwiftBridge) {
    this.bridge = bridge;
  }

  async listEvents(from: string, to: string): Promise<CalendarEvent[]> {
    const result = await this.bridge.exec(['calendar', 'list', '--from', from, '--to', to]);
    return (result as any).events ?? [];
  }

  async searchEvents(query: string, from?: string, to?: string): Promise<CalendarEvent[]> {
    const args = ['calendar', 'search', '--query', query];
    if (from && to) {
      args.push('--from', from, '--to', to);
    }
    const result = await this.bridge.exec(args);
    return (result as any).events ?? [];
  }

  async createEvent(params: CreateEventParams): Promise<CalendarEvent> {
    const args = [
      'calendar', 'create',
      '--title', params.title,
      '--start', params.start,
      '--end', params.end,
    ];
    if (params.calendar) args.push('--calendar', params.calendar);
    if (params.location) args.push('--location', params.location);
    if (params.notes) args.push('--notes', params.notes);
    if (params.allDay) args.push('--all-day');

    const result = await this.bridge.exec(args);
    this.assertSuccess(result);
    return (result as any).event;
  }

  async updateEvent(id: string, params: UpdateEventParams): Promise<CalendarEvent> {
    const args = ['calendar', 'update', '--id', id];
    if (params.title) args.push('--title', params.title);
    if (params.start) args.push('--start', params.start);
    if (params.end) args.push('--end', params.end);
    if (params.calendar) args.push('--calendar', params.calendar);
    if (params.location) args.push('--location', params.location);
    if (params.notes) args.push('--notes', params.notes);

    const result = await this.bridge.exec(args);
    this.assertSuccess(result);
    return (result as any).event;
  }

  async deleteEvent(id: string): Promise<void> {
    const result = await this.bridge.exec(['calendar', 'delete', '--id', id]);
    this.assertSuccess(result);
  }

  getToolDefinitions(): ToolDescription[] {
    return [
      {
        name: 'apple_calendar_list',
        description: 'List calendar events in a date range.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Start date/time (ISO 8601)' },
            to: { type: 'string', description: 'End date/time (ISO 8601)' },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'apple_calendar_search',
        description: 'Search calendar events by keyword.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            from: { type: 'string', description: 'Start date (ISO 8601, default: 1 year ago)' },
            to: { type: 'string', description: 'End date (ISO 8601, default: 1 year from now)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'apple_calendar_create',
        description: 'Create a new calendar event.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'Start date/time (ISO 8601)' },
            end: { type: 'string', description: 'End date/time (ISO 8601)' },
            calendar: { type: 'string', description: 'Calendar name (default: default calendar)' },
            location: { type: 'string', description: 'Event location' },
            notes: { type: 'string', description: 'Event notes' },
            allDay: { type: 'boolean', description: 'All-day event' },
          },
          required: ['title', 'start', 'end'],
        },
      },
      {
        name: 'apple_calendar_update',
        description: 'Update an existing calendar event.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Event ID' },
            title: { type: 'string', description: 'New title' },
            start: { type: 'string', description: 'New start date/time (ISO 8601)' },
            end: { type: 'string', description: 'New end date/time (ISO 8601)' },
            calendar: { type: 'string', description: 'New calendar name' },
            location: { type: 'string', description: 'New location' },
            notes: { type: 'string', description: 'New notes' },
          },
          required: ['id'],
        },
      },
      {
        name: 'apple_calendar_delete',
        description: 'Delete a calendar event.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Event ID to delete' },
          },
          required: ['id'],
        },
      },
    ];
  }

  private assertSuccess(result: { success: boolean; [key: string]: unknown }): void {
    if (!result.success) {
      throw new Error((result as any).error ?? 'Unknown calendar error');
    }
  }
}
