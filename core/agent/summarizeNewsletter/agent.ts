import { createAgent } from "langchain";
import { getUrlContext } from "./tools";
import { summarizeNewsletterPrompt as systemPrompt } from "./prompt";
import {
  MaskedUrlSchema,
  type MaskedContent,
  type MaskedUrl,
} from "../../process";
import * as z from "zod";
import {
  getModel,
  modelProviderSchema,
  type ModelInfo,
  type ModelProvider,
} from "../model";
import { BaseAgent } from "../BaseAgent";

const toolConfigSchema = z.object({
  vlmProvider: modelProviderSchema,
  vlmName: z.string(),
  processImages: z.boolean(),
});

export interface ToolConfig {
  vlmProvider: ModelProvider | undefined;
  vlmName: string | undefined;
  processImages: boolean;
}

const contextSchema = z.object({
  maskedUrls: z.record(z.number(), MaskedUrlSchema),
  toolConfig: toolConfigSchema,
});

export type context = {
  maskedUrls: Record<number, MaskedUrl>;
  toolConfig: ToolConfig;
};

export class NewsletterSummarizationAgent extends BaseAgent<
  MaskedContent,
  string | undefined
> {
  private readonly toolConfig: ToolConfig;
  constructor(modelInfo: ModelInfo, toolConfig: ToolConfig) {
    super({ agentName: "Newsletter Summarization" });
    this.toolConfig = toolConfig;
    this.agent = createAgent({
      model: getModel(modelInfo),
      tools: [getUrlContext],
      systemPrompt,
      contextSchema,
    });
  }

  protected async *execute(
    context: MaskedContent,
  ): AsyncGenerator<string, void, void> {
    const stream = await this.agent.stream(
      {
        messages: [{ role: "user", content: context.content }],
      },
      {
        streamMode: "messages",
        context: {
          maskedUrls: context.links,
          toolConfig: this.toolConfig,
        },
      },
    );

    for await (const [message, _] of stream) {
      if (typeof message.content === "string" && message.content.length > 0) {
        yield message.content;
      }
    }
  }
}
