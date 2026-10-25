/**
 * A stand-in for SiftCore, for the demo and the TUI tests. It implements the
 * same methods with the same shapes, so the TUI cannot tell it apart from the
 * real core. Nothing here touches the network.
 */
import type { Config } from "../config/config";
import type { SiftCore } from "../core";
import type { MaskedContent } from "../core/process";

export interface MockMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  labels: string[];
  text: string;
}

export interface MockCoreOptions {
  messages?: MockMessage[];
  config?: Partial<Config>;
  /** Delay before each streamed message, summary chunk and label/delete call. */
  delayMs?: number;
  summaryChunks?: string[];
  failList?: string;
  failSummary?: string;
  failLabel?: string;
  failDelete?: string;
}

export interface MockCalls {
  /** Each `getMessagesStream` request, in order. */
  lists: Array<{ labels?: string[] }>;
  /** Each `summarize` call, by message content. */
  summaries: number;
  labels: Array<{ id: string; addLabels: unknown; removeLabels: unknown }>;
  deleted: string[];
}

const hoursAgo = (hours: number, now: Date) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);

const lorem = (paragraphs: number) =>
  Array.from(
    { length: paragraphs },
    (_, i) =>
      `Paragraph ${i + 1}. Sift keeps every newsletter out of your personal inbox ` +
      "and turns the noise into short summaries, so you can decide in seconds " +
      "what deserves your attention and what can wait for the weekend.",
  ).join("\n\n");

/** Sample mail, newest first. */
export function createMockMessages(now = new Date()): MockMessage[] {
  return [
    {
      id: "1",
      from: "The Pragmatic Engineer <hello@pragmaticengineer.com>",
      subject: "The Pulse: how AI is changing hiring at big tech",
      receivedAt: hoursAgo(0.5, now),
      labels: ["unread", "inbox", "newsletter"],
      text: `Hi there,\n\n${lorem(6)}\n\n— Gergely`,
    },
    {
      id: "2",
      from: "Stratechery <email@stratechery.com>",
      subject: "Aggregators and the long tail of attention",
      receivedAt: hoursAgo(5, now),
      labels: ["unread", "inbox"],
      text: lorem(10),
    },
    {
      id: "3",
      from: "Morning Brew <crew@morningbrew.com>",
      subject: "Markets rally as rate-cut hopes return",
      receivedAt: hoursAgo(30, now),
      labels: ["inbox"],
      text: lorem(4),
    },
    {
      id: "4",
      from: "bytes@ui.dev",
      subject: "Bytes #412: the one about signals",
      receivedAt: hoursAgo(24 * 3, now),
      labels: ["inbox"],
      text: "Short and sweet. Nothing to see here.",
    },
    {
      id: "5",
      from: '"Lenny Rachitsky" <lenny@substack.com>',
      subject:
        "How the best product teams run their weekly planning (templates inside), a very long subject that must be truncated gracefully",
      receivedAt: hoursAgo(24 * 9, now),
      labels: ["inbox", "starred"],
      text: lorem(8),
    },
    {
      id: "6",
      from: "Hacker Newsletter <kale@hackernewsletter.com>",
      subject: "",
      receivedAt: hoursAgo(24 * 400, now),
      labels: [],
      text: "",
    },
  ];
}

const DEFAULT_CONFIG: Config = {
  tui: true,
  webui: false,
  email: "news@example.com",
  displayName: undefined,
  createEmail: false,
  markAsRead: false,
  summarize: false,
  llmProvider: "openrouter",
  llmName: "openai/gpt-oss-120b",
  processImages: false,
  vlmProvider: undefined,
  vlmName: undefined,
};

const toContent = (text: string): MaskedContent => ({
  content: text,
  links: {},
});

/**
 * Build a SiftCore stand-in. The returned `calls` records what the TUI asked
 * the core to do, so tests can check it.
 */
export function createMockCore(options: MockCoreOptions = {}): {
  core: SiftCore;
  calls: MockCalls;
} {
  const now = new Date();
  const delay = () =>
    new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0));

  // The "server" state. Labels and deletes change it, as they would for AgentMail.
  let messages = (options.messages ?? createMockMessages(now)).map((m) => ({
    ...m,
    labels: [...m.labels],
  }));
  const calls: MockCalls = {
    lists: [],
    summaries: 0,
    labels: [],
    deleted: [],
  };
  const config: Config = { ...DEFAULT_CONFIG, ...options.config };
  const summaryChunks = options.summaryChunks ?? [
    "Summary: ",
    "this newsletter covers ",
    "AI hiring.",
  ];

  const fake = {
    config,

    async *getMessagesStream(request?: { labels?: string[] }) {
      calls.lists.push({ ...request });
      if (options.failList) throw new Error(options.failList);

      const wanted = request?.labels ?? [];
      for (const message of messages) {
        await delay();
        if (wanted.some((label) => !message.labels.includes(label))) continue;
        yield {
          id: message.id,
          from: message.from,
          subject: message.subject,
          recievedAt: message.receivedAt,
          labels: [...message.labels],
          text: message.text,
          body: toContent(message.text),
        };
      }
    },

    async *summarize(_content: MaskedContent) {
      calls.summaries++;
      if (options.failSummary) throw new Error(options.failSummary);
      for (const chunk of summaryChunks) {
        await delay();
        yield { done: false, chunk };
      }
      yield { done: true, chunk: undefined };
    },

    async setMessageLabel(
      id: string,
      {
        addLabels,
        removeLabels,
      }: { addLabels: unknown; removeLabels: unknown },
    ) {
      calls.labels.push({ id, addLabels, removeLabels });
      await delay();
      if (options.failLabel) throw new Error(options.failLabel);
      messages = messages.map((m) => {
        if (m.id !== id) return m;
        if (removeLabels === "unread") {
          return { ...m, labels: m.labels.filter((l) => l !== "unread") };
        }
        if (addLabels === "unread" && !m.labels.includes("unread")) {
          return { ...m, labels: [...m.labels, "unread"] };
        }
        return m;
      });
    },

    async deleteMessage(id: string) {
      await delay();
      if (options.failDelete) throw new Error(options.failDelete);
      calls.deleted.push(id);
      messages = messages.filter((m) => m.id !== id);
    },
  };

  // The mock implements the core's public surface only. The cast is the one
  // place the stand-in meets the real class type.
  return { core: fake as unknown as SiftCore, calls };
}
