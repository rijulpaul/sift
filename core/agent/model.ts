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
  /** Where an OpenAI-compatible endpoint lives; unset for the hosted APIs. */
  baseUrl?: string;
}

/**
 * The key to hand the OpenAI client.
 *
 * The hosted API is useless without one, so a missing key is an error the
 * reader can act on. A self-hosted OpenAI-compatible endpoint often has no key
 * at all, so there the key is set as placeholder if empty.
 */
const openAiApiKey = (baseUrl: string | undefined): string => {
  const configured = process.env.OPENAI_API_KEY?.trim();
  if (configured) return configured;

  if (baseUrl !== undefined) return configured ?? "placeholder";

  throw new Error(
    "OPENAI_API_KEY is not set. Set it, or point sift at a custom " +
      "OpenAI-compatible endpoint with llm_base_url / vlm_base_url.",
  );
};

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
      // Resolved before the import: a missing key is a configuration problem,
      // and there is no reason to load the SDK to report it.
      const apiKey = openAiApiKey(modelInfo.baseUrl);
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model: modelInfo.model,
        apiKey,
        configuration: { baseURL: modelInfo.baseUrl },
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
