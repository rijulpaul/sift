import { AgentMailClient } from "agentmail";
import type { ListMessagesRequest } from "agentmail/inboxes";

type Label = string | Array<string> | undefined;

export class Inbox {
  private static client: AgentMailClient = new AgentMailClient({
    apiKey: process.env.AGENTMAIL_API_KEY,
  });

  constructor(private inbox_id: string) {}

  static init = async ({
    email,
    displayName,
  }: {
    email?: string;
    displayName?: string;
  }): Promise<Inbox> => {
    let inbox_id: string | undefined;
    let next_page_token: string | undefined;

    // Given an email
    // 1. check if the email id exists
    // 2. get inboxId if yes
    if (email) {
      do {
        const res = await this.client.inboxes.search({
          q: email,
          pageToken: next_page_token,
        });
        next_page_token = res.nextPageToken || undefined;

        for (const i of res.inboxes) {
          if (i.email == email) inbox_id = i.inboxId;
        }
      } while (next_page_token && !inbox_id);
    }

    // create a new email and get inboxId (random if email not provided)
    if (!inbox_id) {
      const [username, domain] = email?.split("@") || [];
      inbox_id = (
        await this.client.inboxes.create({
          username: username,
          domain: domain,
          displayName: displayName,
        })
      ).inboxId;
    }

    return new Inbox(inbox_id);
  };

  public get = async (request?: ListMessagesRequest) => {
    const messages: any[] = [];
    let next_page_token: string | undefined;

    // Iterate over the list of messages and fetch the content.
    // Not using batchGet because it doesnt provide inner content
    do {
      const res = await Inbox.client.inboxes.messages.list(
        this.inbox_id,
        request,
      );
      for (const message of res.messages) {
        messages.push(
          await Inbox.client.inboxes.messages.get(
            this.inbox_id,
            message.messageId,
          ),
        );
      }
      next_page_token = res?.nextPageToken || undefined;
    } while (next_page_token);

    return messages;
  };

  public update = async (
    message_id: string,
    { addLabels, removeLabels }: { addLabels: Label; removeLabels: Label },
  ) => {
    await Inbox.client.inboxes.messages.update(this.inbox_id, message_id, {
      addLabels: addLabels,
      removeLabels: removeLabels,
    });
  };
}
