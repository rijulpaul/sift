import type { Config } from "../config/config";
import { NewsletterSummarizationAgent } from "./agent";
import { logger } from "./logger";
import { Inbox, type Label } from "./mail";
import { processNewsletter, type MaskedContent } from "./process";

const log = logger.child({ module: "core" });

export class SiftCore {
  public inbox;
  public readonly config;
  private agent;

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
    if (config.processImages && (!config.vlmProvider || !config.vlmName)) {
      log.warn(
        { vlmProvider: config.vlmProvider, vlmName: config.vlmName },
        "processImages is enabled but vision settings are incomplete, image descriptions will fail",
      );
    }

    log.debug(
      {
        llm: `${config.llmProvider}/${config.llmName}`,
        processImages: config.processImages,
      },
      "configuring summarization agent",
    );

    this.agent = new NewsletterSummarizationAgent(
      {
        model: config.llmName!,
        modelProvider: config.llmProvider!,
      },
      {
        vlmProvider: config.vlmProvider,
        vlmName: config.vlmName,
        processImages: config.processImages,
      },
    );
  }

  async getMessages({ labels }: { labels?: string[] }) {
    const startedAt = Date.now();

    log.debug({ labels: labels ?? "(all)" }, "loading messages");

    const messages = await this.inbox.get({ labels });
    const cleanedMessages: any[] = [];

    for (const message of messages) {
      if (!message.html) {
        log.warn(
          { message_id: message.messageId },
          "message has no html content",
        );
      }

      const processedContent = processNewsletter(message.html);
      const cleanedMessage = {
        message_id: message.messageId,
        from: message.from,
        subject: message.subject,
        timestamp: message.timestamp,
        labels: message.labels,
        content: processedContent,
      };
      cleanedMessages.push(cleanedMessage);
    }

    log.info(
      {
        fetched: messages.length,
        processed: cleanedMessages.length,
        durationMs: Date.now() - startedAt,
      },
      "messages ready",
    );

    return cleanedMessages;
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

    // No try/catch here: BaseAgent.invoke already logs the failure with the
    // agent name, and a catch would also catch errors thrown by the caller
    // while consuming this generator, mislabelling them as agent failures.
    for await (const chunk of this.agent.invoke(message)) {
      chunks++;

      yield {
        done: false,
        chunk,
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
