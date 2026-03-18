import { MessageStore, type StoredMessage } from './message-store.js';
import { SummaryStore, type SummaryNode } from './summary-store.js';
import { ProfileStore } from './profile-store.js';

export interface ContextAssemblerConfig {
  maxContextTokens: number;
  freshTailCount: number;
  contextThreshold: number; // 0.0 - 1.0
}

export interface AssembledContext {
  profile: string;
  messages: StoredMessage[];
  summaries: SummaryNode[];
  totalTokens: number;
  needsCompaction: boolean;
}

export class ContextAssembler {
  private messages: MessageStore;
  private summaries: SummaryStore;
  private profiles: ProfileStore;
  private config: ContextAssemblerConfig;

  constructor(
    messages: MessageStore,
    summaries: SummaryStore,
    profiles: ProfileStore,
    config: ContextAssemblerConfig,
  ) {
    this.messages = messages;
    this.summaries = summaries;
    this.profiles = profiles;
    this.config = config;
  }

  assemble(userId: string, sessionId: string): AssembledContext {
    const { maxContextTokens, freshTailCount, contextThreshold } = this.config;

    // 1. Get user profile text
    const profile = this.profiles.getAsContext(userId);
    const profileTokens = profile.length > 0 ? Math.ceil(profile.length / 4) : 0;

    // 2. Get fresh tail (last N messages for this session)
    const freshMessages = this.messages.getFreshTail(userId, sessionId, freshTailCount);
    const freshTokens = freshMessages.reduce((sum, m) => sum + m.tokens, 0);

    // 3. Fill remaining token budget with summaries (prioritize higher depth = more condensed)
    let remainingBudget = maxContextTokens - profileTokens - freshTokens;

    // Get all summaries sorted by depth DESC (higher depth = more condensed, higher priority)
    // then by timestamp DESC (newer = higher priority within same depth)
    const allSummaries = this.getAllSummariesByPriority(userId);
    const selectedSummaries: SummaryNode[] = [];

    for (const node of allSummaries) {
      if (remainingBudget <= 0) break;
      if (node.tokens <= remainingBudget) {
        selectedSummaries.push(node);
        remainingBudget -= node.tokens;
      }
    }

    // 4. Calculate totalTokens
    const summaryTokens = selectedSummaries.reduce((sum, s) => sum + s.tokens, 0);
    const totalTokens = profileTokens + freshTokens + summaryTokens;

    // 5. Calculate needsCompaction: true when stored tokens exceed maxContextTokens * contextThreshold
    const storedMessageTokens = this.messages.getTotalTokens(userId);
    const storedSummaryTokens = this.summaries.getTotalTokens(userId);
    const totalStoredTokens = storedMessageTokens + storedSummaryTokens;
    const needsCompaction = totalStoredTokens > maxContextTokens * contextThreshold;

    return {
      profile,
      messages: freshMessages,
      summaries: selectedSummaries,
      totalTokens,
      needsCompaction,
    };
  }

  formatAsPrompt(context: AssembledContext): string {
    const parts: string[] = [];

    if (context.profile.length > 0) {
      parts.push(`<user_profile>\n${context.profile}\n</user_profile>`);
    } else {
      parts.push(`<user_profile>\n</user_profile>`);
    }

    if (context.summaries.length > 0) {
      const summaryText = context.summaries
        .map(s => s.content)
        .join('\n\n');
      parts.push(`<conversation_history_summary>\n${summaryText}\n</conversation_history_summary>`);
    } else {
      parts.push(`<conversation_history_summary>\n</conversation_history_summary>`);
    }

    if (context.messages.length > 0) {
      const messageText = context.messages
        .map(m => `[${m.role}]: ${m.content}`)
        .join('\n');
      parts.push(`<recent_messages>\n${messageText}\n</recent_messages>`);
    } else {
      parts.push(`<recent_messages>\n</recent_messages>`);
    }

    return parts.join('\n\n');
  }

  private getAllSummariesByPriority(userId: string): SummaryNode[] {
    // Get all summary nodes, sort by depth DESC then timestamp DESC
    const allNodes: SummaryNode[] = [];

    // Collect all nodes by iterating depth levels starting from highest
    // We use a direct query approach via getRecent with a large limit and re-sort
    const raw = this.summaries.getRecent(userId, 10000);

    // Sort by depth DESC (higher = more condensed = higher priority),
    // then by timestamp DESC (newer first within same depth)
    raw.sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      return b.timestamp - a.timestamp;
    });

    return raw;
  }
}
