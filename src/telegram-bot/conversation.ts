import type { ExtractedIntent } from "../llm/types.js";
import { extractIntent } from "../llm/extractor.js";

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000;

interface ConversationState {
  command: string;
  intent: Partial<ExtractedIntent>;
  lastActivity: number;
}

export interface ProcessMessageResult {
  action: "execute" | "ask" | "expired";
  command?: string;
  intent?: ExtractedIntent;
  question?: string;
}

export class ConversationManager {
  private conversations: Map<number, ConversationState> = new Map();

  start(chatId: number, command: string): void {
    this.conversations.set(chatId, {
      command,
      intent: {},
      lastActivity: Date.now(),
    });
  }

  has(chatId: number): boolean {
    return this.get(chatId) !== undefined;
  }

  delete(chatId: number): void {
    this.conversations.delete(chatId);
  }

  getQuestion(chatId: number): string | null {
    const state = this.get(chatId);
    if (!state) return null;
    return this.getNextQuestion(state);
  }

  async processMessage(
    chatId: number,
    text: string,
    apiUrl: string,
  ): Promise<ProcessMessageResult> {
    const state = this.get(chatId);
    if (!state) return { action: "expired" };

    state.lastActivity = Date.now();

    const newFields = await extractIntent(text, apiUrl, {
      existingIntent: { ...state.intent },
      command: state.command,
    });

    const safeKeys: (keyof ExtractedIntent)[] = [
      "park", "startDate", "endDate", "partySize", "interval", "nights",
    ];
    for (const key of safeKeys) {
      if (newFields[key] !== undefined && state.intent[key] === undefined) {
        (state.intent as Record<string, unknown>)[key] = newFields[key];
      }
    }

    const reply = newFields.reply;
    const question = this.getNextQuestion(state);
    const allCollected = question === null;

    if (allCollected) {
      this.conversations.delete(chatId);
      return {
        action: "execute",
        command: state.command,
        intent: state.intent as ExtractedIntent,
        question: reply,
      };
    }

    return { action: "ask", question: reply || question };
  }

  private get(chatId: number): ConversationState | undefined {
    const state = this.conversations.get(chatId);
    if (!state) return undefined;
    if (Date.now() - state.lastActivity > CONVERSATION_TIMEOUT_MS) {
      this.conversations.delete(chatId);
      return undefined;
    }
    return state;
  }

  private getNextQuestion(state: ConversationState): string | null {
    const intent = state.intent;
    const actionWord =
      state.command === "hunt" ? "hunt for"
      : state.command === "monitor" ? "monitor"
      : "check";

    if (!intent.park) return `Which park would you like to ${actionWord}?`;
    if (!intent.startDate) return "What date do you want to check in?";
    if (!intent.endDate) return "What date do you want to check out?";
    if (intent.partySize === undefined) return "How many people?";
    return null;
  }
}
