import type { createAgent } from "langchain";

import { BaseAgent } from "../BaseAgent";
import { getModel, type ModelInfo } from "../model";
import { describeImagePrompt } from "./prompt";

export class DescribeImageAgent extends BaseAgent<string, string | undefined> {
  /**
   * Build the agent. Async because `langchain` and the provider SDK are
   * imported here rather than at module load, which keeps them off the
   * startup path.
   */
  static async create(modelInfo: ModelInfo): Promise<DescribeImageAgent> {
    const [{ createAgent }, model] = await Promise.all([
      import("langchain"),
      getModel(modelInfo),
    ]);

    return new DescribeImageAgent(
      createAgent({
        model,
        systemPrompt: describeImagePrompt,
      }),
    );
  }

  private constructor(agent: ReturnType<typeof createAgent>) {
    super({ agentName: "Describe Image" });
    this.agent = agent;
  }

  protected async *execute(url: string): AsyncGenerator<string, void, void> {
    const stream = await this.agent.stream(
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url },
              },
            ],
          },
        ],
      },
      {
        streamMode: "messages",
      },
    );

    for await (const [message, _] of stream) {
      if (typeof message.content === "string" && message.content.length > 0) {
        yield message.content;
      }
    }
  }
}
