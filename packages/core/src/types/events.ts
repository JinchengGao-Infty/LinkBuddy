export interface Disposable {
  dispose(): void;
}

export interface IncomingMessageEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  text: string;
  attachments: import('./agent.js').Attachment[];
  isMention: boolean;
  replyToMessageId?: string;
  timestamp: number;
}

export interface OutgoingMessageEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  text: string;
  attachments?: import('./agent.js').Attachment[];
}

export interface SessionConflictEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  workingDirectory: string;
  conflictingPid: number;
}

export interface HealthAlertEvent {
  module: string;
  status: 'degraded' | 'down';
  message: string;
  timestamp: number;
}

export interface HeartbeatStatusEvent {
  modules: Record<string, 'healthy' | 'degraded' | 'down'>;
  system: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
  };
  timestamp: number;
}

export interface WebhookEvent {
  handler: string;
  userId: string;
  payload: unknown;
  promptTemplate: string;
  timestamp: number;
}

export interface AgentProgressEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  type: 'text' | 'tool_use';
  content: string;
}

export interface EventMap {
  'message.incoming': IncomingMessageEvent;
  'message.outgoing': OutgoingMessageEvent;
  'session.conflict': SessionConflictEvent;
  'alert.health': HealthAlertEvent;
  'heartbeat.status': HeartbeatStatusEvent;
  'webhook.received': WebhookEvent;
  'agent.progress': AgentProgressEvent;
}

export interface EventBus {
  publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void>;
  subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Disposable;
}
