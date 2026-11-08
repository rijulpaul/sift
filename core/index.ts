import type { ListMessagesRequest } from "agentmail/inboxes";
import type { Config } from "../config/config";
import { NewsletterSummarizationAgent } from "./agent";
import { logger } from "./logger";
import { createLinkResolver } from "./links";
import { Inbox, type Label } from "./mail";
import { processNewsletter, type MaskedContent } from "./process";

const log = logger.child({ module: "core" });

/** One row of the message list: everything the list needs, and no body. */
export interface MessageListItem {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  labels: string[];
}

/** A whole message, body included. */
export interface MessageDetail {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  labels: string[];
  text: string;
  html: string;
  body: MaskedContent;
}

export class SiftCore {
  public inbox;
  public readonly config;

  private agentPromise: Promise<NewsletterSummarizationAgent> | null = null;

  public static async init(config: Config) {
    log.debug({ config }, "starting sift core");

    // Inbox.init logs its own discovery/creation steps.
    const inbox = await Inbox.init(config);

    log.info("sift core ready");
    return new SiftCore({ config, inbox });
  }

  constructor({ config, inbox }: { config: Config; inbox: Inbox }) {
    this.inbox = inbox;
    this.config = config;

    // Missing vision settings only surface when the summarizer actually
    // requests an image description, so warn about it at startup instead.
    if (
      config.processImages &&
      (!config.vlmProvider || (!config.vlmName && !config.vlmBaseUrl))
    ) {
      log.warn(
        {
          vlmProvider: config.vlmProvider,
          vlmName: config.vlmName,
          vlmBaseUrl: config.vlmBaseUrl,
        },
        "processImages is enabled but vision settings are incomplete, image descriptions will fail",
      );
    }
  }

  /**
   * Load the agent ahead of the first summary, without blocking startup.
   * Call it once the UI is up and idle. Safe to call repeatedly.
   */
  public async warmup(): Promise<void> {
    try {
      await this.getAgent();
    } catch (error) {
      // Advisory only: report it, and let summarize() surface the real failure.
      log.warn({ err: error }, "agent warmup failed");
    }
  }

  private getAgent(): Promise<NewsletterSummarizationAgent> {
    this.agentPromise ??= NewsletterSummarizationAgent.create(
      {
        model: this.config.llmName ?? "",
        modelProvider: this.config.llmProvider!,
        baseUrl: this.config.llmBaseUrl,
      },
      {
        vlmProvider: this.config.vlmProvider,
        vlmName: this.config.vlmName,
        baseUrl: this.config.vlmBaseUrl,
        processImages: this.config.processImages,
      },
    ).catch((error: unknown) => {
      // Never cache a failure, so the next summarize() gets a fresh attempt.
      this.agentPromise = null;
      throw error;
    });

    return this.agentPromise;
  }

  /**
   * The message list: one row per message, streamed as the pages arrive, with
   * no bodies. A row is what the list needs; the body is fetched only when a
   * message is actually opened, by `getMessage`.
   */
  public async *listMessages(
    request?: ListMessagesRequest,
  ): AsyncGenerator<MessageListItem, void, void> {
    const startedAt = Date.now();
    let count = 0;

    log.debug({ labels: request?.labels ?? "(all)" }, "listing messages");

    for await (const message of this.inbox.listMessages(request)) {
      count++;

      yield {
        id: message.messageId,
        from: message.from,
        subject: message.subject ?? "",
        receivedAt: message.timestamp,
        labels: message.labels ?? [],
      };
    }

    log.info({ count, durationMs: Date.now() - startedAt }, "messages listed");
  }

  /** One whole message, processed and ready to read. */
  public async getMessage(message_id: string): Promise<MessageDetail> {
    const startedAt = Date.now();

    log.debug({ message_id }, "loading message");

    const message = await this.inbox.getMessage(message_id);

    if (!message.html) {
      log.warn({ message_id }, "message has no html content");
    }

    const detail: MessageDetail = {
      id: message.messageId,
      from: message.from ?? "",
      subject: message.subject ?? "",
      receivedAt: message.timestamp,
      labels: message.labels ?? [],
      text: processNewsletter(message.html ?? "", false).content,
      html: message.html ?? "",
      body: processNewsletter(message.html ?? "", true),
    };

    log.info(
      { message_id, durationMs: Date.now() - startedAt },
      "message loaded",
    );

    return detail;
  }

  async *summarize(message: MaskedContent) {
    const startedAt = Date.now();
    let chunks = 0;

    log.debug(
      {
        chars: message.content.length,
        links: Object.keys(message.links).length,
      },
      "summarizing newsletter",
    );

    const agent = await this.getAgent();

    // No try/catch here: BaseAgent.invoke already logs the failure with the
    // agent name, and a catch would also catch errors thrown by the caller
    // while consuming this generator, mislabelling them as agent failures.
    // The agent only ever saw placeholders; put the real URLs back for the
    // reader. A placeholder can be split across two chunks, so the resolver
    // carries the partial token between them and nothing else.
    const links = createLinkResolver(message.links);

    for await (const chunk of agent.invoke(message)) {
      const text = links.push(chunk);
      if (text === "") continue;

      chunks++;
      yield {
        done: false,
        chunk: text,
      };
    }

    const tail = links.flush();
    if (tail !== "") {
      chunks++;
      yield {
        done: false,
        chunk: tail,
      };
    }

    log.info(
      { chunks, durationMs: Date.now() - startedAt },
      "newsletter summarized",
    );

    yield {
      done: true,
      chunk: undefined,
    };
  }

  async setMessageLabel(
    message_id: string,
    { addLabels, removeLabels }: { addLabels: Label; removeLabels: Label },
  ) {
    return this.inbox.updateLabels(message_id, {
      addLabels,
      removeLabels,
    });
  }

  async deleteMessage(message_id: string) {
    return this.inbox.delete(message_id);
  }
}
