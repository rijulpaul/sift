import { AgentMailClient, type AgentMail } from "agentmail";
import type { ListMessagesRequest } from "agentmail/inboxes";

import { logger } from "./logger";

const log = logger.child({ module: "mail" });

// Runs a mail API call. If the promise rejects, the error is logged with the
// operation context and rethrown with a descriptive message. The original
// error is preserved as `cause`.
async function handleApiCall<T>(
  operation: string,
  context: Record<string, unknown>,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    log.error({ err, operation, ...context }, `${operation} failed`);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${operation} failed: ${reason}`, { cause: err });
  }
}

export type Label = string | Array<string> | undefined;

export class Inbox {
  private static client: AgentMailClient = new AgentMailClient({
    apiKey: process.env.AGENTMAIL_API_KEY,
  });
  public readonly inbox_id: string;
  public readonly email: string;
  public readonly displayName: string | undefined;

  constructor({
    inboxId,
    email,
    displayName,
  }: {
    inboxId: string;
    email: string;
    displayName?: string;
  }) {
    this.inbox_id = inboxId;
    this.email = email;
    this.displayName = displayName;
  }

  static init = async (email: string): Promise<Inbox> => {
    if (!process.env.AGENTMAIL_API_KEY) {
      log.warn("AGENTMAIL_API_KEY is not set, mail requests will fail");
    }

    log.info({ email }, "initializing inbox");

    let inboxId: string = "";
    let displayName: string | undefined;
    let next_page_token: string | undefined;

    // Given an email
    // 1. check if the email id exists
    // 2. get inboxId if yes
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        log.error({ email }, "invalid email address");
        throw new Error(`Invalid email: ${email}`);
      }

      log.debug({ email: email }, "searching for existing inbox");

      let pages = 0;
      do {
        const res = await handleApiCall(
          "search inboxes",
          { email, page: pages + 1 },
          () =>
            this.client.inboxes.list({
              pageToken: next_page_token,
            }),
        );
        next_page_token = res.nextPageToken || undefined;

        log.debug(
          { page: ++pages, results: res.inboxes.length },
          "searched inbox page",
        );

        for (const i of res.inboxes) {
          if (i.email == email) {
            inboxId = i.inboxId;
            email = i.email;
            displayName = i.displayName || undefined;
            log.info({ inboxId: inboxId }, "existing inbox found");
          }
        }
      } while (next_page_token && !inboxId);

    // create a new email and get inboxId (random if email not provided)
    if (!inboxId) {
        log.error(
          { email: email },
          "inbox not found and createEmail is disabled",
        );
        throw new Error(
          `Email ${email} not found and createEmail is set to false` +
            " Set createEmail to true in config or add a valid email id",
        );
    }

    return new Inbox({ inboxId, email, displayName });
  };

  /**
   * The inbox list: message summaries, page by page, without bodies.
   * This is what builds a message list; fetch a body with `getMessage` when one
   * is actually opened.
   */
  public async *listMessages(
    request: ListMessagesRequest = {},
  ): AsyncGenerator<AgentMail.MessageItem, void, void> {
    log.debug({ inbox_id: this.inbox_id, request }, "listing messages");

    let pageToken = request.pageToken;
    let pages = 0;
    let count = 0;

    do {
      const page = await handleApiCall(
        "list messages",
        { inbox_id: this.inbox_id, page: pages + 1 },
        () =>
          Inbox.client.inboxes.messages.list(this.inbox_id, {
            ...request,
            pageToken,
          }),
      );

      pages++;
      count += page.messages.length;
      log.debug(
        { page: pages, count: page.messages.length },
        "listed message page",
      );

      for (const message of page.messages) yield message;

      pageToken = page.nextPageToken || undefined;
    } while (pageToken);

    log.info({ inbox_id: this.inbox_id, count, pages }, "listed messages");
  }

  /** One whole message, for reading it. */
  public getMessage = async (
    message_id: string,
  ): Promise<AgentMail.Message> => {
    log.debug({ inbox_id: this.inbox_id, message_id }, "getting message");

    const message = await handleApiCall(
      "get message",
      { inbox_id: this.inbox_id, message_id },
      () => Inbox.client.inboxes.messages.get(this.inbox_id, message_id),
    );

    log.debug({ inbox_id: this.inbox_id, message_id }, "got message");

    return message;
  };

  public updateLabels = async (
    message_id: string,
    { addLabels, removeLabels }: { addLabels: Label; removeLabels: Label },
  ) => {
    log.info(
      {
        inbox_id: this.inbox_id,
        message_id,
        addLabels,
        removeLabels,
      },
      "updating message labels",
    );

    await handleApiCall(
      "update message labels",
      { inbox_id: this.inbox_id, message_id },
      () =>
        Inbox.client.inboxes.messages.update(this.inbox_id, message_id, {
          addLabels: addLabels,
          removeLabels: removeLabels,
        }),
    );

    log.debug(
      { inbox_id: this.inbox_id, message_id },
      "message labels updated",
    );
  };

  public delete = async (message_id: string) => {
    await handleApiCall(
      "delete message",
      { inbox_id: this.inbox_id, message_id },
      () => Inbox.client.inboxes.messages.delete(this.inbox_id, message_id),
    );
    log.debug({ inbox_id: this.inbox_id, message_id }, "message deleted");
  };
}
