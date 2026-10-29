import { AIMessageChunk, type createAgent } from "langchain";
import * as z from "zod";

import {
  MaskedUrlSchema,
  type MaskedContent,
  type MaskedUrl,
} from "../../process";
import { BaseAgent } from "../BaseAgent";
import {
  getModel,
  modelProviderSchema,
  type ModelInfo,
  type ModelProvider,
} from "../model";
import { summarizeNewsletterPrompt as systemPrompt } from "./prompt";

/**
 * `null`, `undefined` and blank strings all mean "not set" — defaults.json
 * stores unset settings as null, and empty strings are not supported values.
 */
const unsetToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "")
    ? undefined
    : value;

/**
 * The vision settings are only required when image processing is on:
 * process_images can be disabled with vlm_provider/vlm_name unset, and the
 * agent must still run. When it is on, both must be set.
 */
export const toolConfigSchema = z
  .object({
    vlmProvider: z.preprocess(unsetToUndefined, modelProviderSchema.optional()),
    vlmName: z.preprocess(unsetToUndefined, z.string().optional()),
    processImages: z.boolean(),
  })
  .refine(
    (toolConfig) =>
      !toolConfig.processImages ||
      (toolConfig.vlmProvider !== undefined &&
        toolConfig.vlmName !== undefined),
    {
      message:
        "process_images is enabled but the vision settings are missing: set vlm_provider and vlm_name, or disable process_images",
      path: ["processImages"],
    },
  );

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

  /**
   * Build the agent. Async because `langchain`, its tools and the provider SDK
   * are imported here rather than at module load, keeping ~600ms of module
   * loading off the startup path.
   */
  static async create(
    modelInfo: ModelInfo,
    toolConfig: ToolConfig,
  ): Promise<NewsletterSummarizationAgent> {
    const [{ createAgent }, { getUrlContext }, model] = await Promise.all([
      import("langchain"),
      import("./tools"),
      getModel(modelInfo),
    ]);

    return new NewsletterSummarizationAgent(
      toolConfig,
      createAgent({
        model,
        tools: toolConfig.processImages ? [getUrlContext] : [],
        systemPrompt,
        contextSchema,
      }),
    );
  }

  private constructor(
    toolConfig: ToolConfig,
    agent: ReturnType<typeof createAgent>,
  ) {
    super({ agentName: "Newsletter Summarization" });
    this.toolConfig = toolConfig;
    this.agent = agent;
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

    for await (const [message, metadata] of stream) {
      const ns = (metadata?.langgraph_checkpoint_ns as string) ?? "";

      // Subagent runs happen inside the tools node, so their namespace is nested,
      // e.g. "tools:abc|model_request:def". The main agent's is just "model_request:xyz".
      if (ns.includes("|")) continue;

      // Only the main agent's model node (not tool results)
      if (metadata?.langgraph_node !== "model_request") continue;

      if (AIMessageChunk.isInstance(message) && message.text) {
        process.stdout.write(message.text);
        yield message.text
      }
    }
  }
}
