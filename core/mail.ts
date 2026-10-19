import { AgentMailClient } from "agentmail";
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

export interface InboxConfig {
  email?: string;
  displayName?: string;
  createEmail: boolean;
}

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

  static init = async (inboxConfig: InboxConfig): Promise<Inbox> => {
    if (!process.env.AGENTMAIL_API_KEY) {
      log.warn("AGENTMAIL_API_KEY is not set, mail requests will fail");
    }

    log.info({ email: inboxConfig.email ?? "(none)" }, "initializing inbox");

    let inboxId: string | undefined;
    let email: string = "";
    let displayName: string | undefined;
    let next_page_token: string | undefined;

    // Given an email
    // 1. check if the email id exists
    // 2. get inboxId if yes
    if (inboxConfig.email) {
      // validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(inboxConfig.email)) {
        log.error({ email: inboxConfig.email }, "invalid email address");
        throw new Error(`Invalid email: ${inboxConfig.email}`);
      }

      log.debug({ email: inboxConfig.email }, "searching for existing inbox");

      let pages = 0;
      do {
        const res = await handleApiCall(
          "search inboxes",
          { email: inboxConfig.email, page: pages + 1 },
          () =>
            this.client.inboxes.search({
              q: inboxConfig.email!,
              pageToken: next_page_token,
            }),
        );
        next_page_token = res.nextPageToken || undefined;

        log.debug(
          { page: ++pages, results: res.inboxes.length },
          "searched inbox page",
        );

        for (const i of res.inboxes) {
          if (i.email == inboxConfig.email){
            inboxId = i.inboxId;
            email = i.email;
            displayName = i.displayName || undefined
            log.info({ inboxId: inboxId }, "existing inbox found");
          }
        }
      } while (next_page_token && !inboxId);
    }

    // create a new email and get inboxId (random if email not provided)
    if (!inboxId) {
      if (inboxConfig.createEmail) {
        const [username, domain] = inboxConfig.email?.split("@") || [];
        log.info(
          { username: username ?? "(random)", domain: domain ?? "(default)" },
          "creating new inbox",
        );
        const inbox = await handleApiCall(
          "create inbox",
          { email: inboxConfig.email },
          () =>
            this.client.inboxes.create({
              username: username,
              domain: domain,
              displayName: inboxConfig.displayName,
            }),
        );
        inboxId = inbox.inboxId
        displayName = inbox.displayName || undefined
        email = inbox.email
        log.info({ inbox_id: inboxId }, "inbox created");
      } else {
        log.error(
          { email: inboxConfig.email },
          "inbox not found and createEmail is disabled",
        );
        throw new Error(
          `Email ${inboxConfig.email} not found and createEmail is set to false` +
            " Set createEmail to true in config or add a valid email id",
        );
      }
    }

    return new Inbox({inboxId,email,displayName});
  };

  public get = async (request?: ListMessagesRequest) => {
    log.debug(
      { inbox_id: this.inbox_id, request: request ?? "(default)" },
      "fetching messages",
    );

    const messages: any[] = [];
    let next_page_token: string | undefined;
    let pages = 0;

    // Iterate over the list of messages and fetch the content.
    // Not using batchGet because it doesnt provide inner content
    do {
      const res = await handleApiCall(
        "list messages",
        { inbox_id: this.inbox_id, page: pages + 1 },
        () => Inbox.client.inboxes.messages.list(this.inbox_id, request),
      );
      log.debug(
        { page: ++pages, count: res.messages.length },
        "fetched message page",
      );
      for (const message of res.messages) {
        messages.push(
          await handleApiCall(
            "get message",
            { inbox_id: this.inbox_id, message_id: message.messageId },
            () =>
              Inbox.client.inboxes.messages.get(
                this.inbox_id,
                message.messageId,
              ),
          ),
        );
      }
      next_page_token = res?.nextPageToken || undefined;
    } while (next_page_token);

    log.info(
      { inbox_id: this.inbox_id, count: messages.length, pages },
      "fetched messages",
    );

    return messages;
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
      log.debug(
        { inbox_id: this.inbox_id, message_id },
        "message deleted",
      );
  }
}
