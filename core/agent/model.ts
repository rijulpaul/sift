import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import * as z from "zod";

export type ModelProvider = "anthropic" | "google" | "openai" | "openrouter";

/** The model instance `createAgent` expects, without importing `langchain` at runtime. */
export type AgentModel = BaseChatModel;

export const modelProviderSchema = z.enum([
  "anthropic",
  "google",
  "openai",
  "openrouter",
]);

export interface ModelInfo {
  model: string;
  modelProvider: ModelProvider;
}

/**
 * Instantiate the configured provider's chat model.
 *
 * The provider SDKs are imported lazily and individually: importing all four
 * at module load costs ~200ms of startup for three providers that are never
 * used, and pulls `langchain` in with them.
 */
export async function getModel(modelInfo: ModelInfo): Promise<BaseChatModel> {
  switch (modelInfo.modelProvider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({
        model: modelInfo.model,
      });
    }

    case "google": {
      const { ChatGoogle } = await import("@langchain/google");
      return new ChatGoogle({
        model: modelInfo.model,
      });
    }

    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model: modelInfo.model,
      });
    }

    case "openrouter": {
      const { ChatOpenRouter } = await import("@langchain/openrouter");
      return new ChatOpenRouter({
        model: modelInfo.model,
      });
    }

    default:
      throw new Error(
        `Unsupported model provider: ${modelInfo.modelProvider as string}`,
      );
  }
}
