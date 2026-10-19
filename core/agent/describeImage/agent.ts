import { createAgent } from "langchain";
import { BaseAgent } from "../BaseAgent";
import { getModel, type ModelInfo } from "../model";
import { describeImagePrompt } from "./prompt";

export class DescribeImageAgent extends BaseAgent<string, string | undefined> {
  constructor(modelInfo: ModelInfo) {
    super({ agentName: "Describe Image" });
    this.agent = createAgent({
      model: getModel(modelInfo),
      systemPrompt: describeImagePrompt,
    });
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
