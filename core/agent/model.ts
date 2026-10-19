import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogle } from "@langchain/google";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";
import * as z from "zod"

export type ModelProvider = "anthropic" | "google" | "openai" | "openrouter";

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

export function getModel(modelInfo: ModelInfo) {
  switch (modelInfo.modelProvider) {
    case "anthropic":
      return new ChatAnthropic({
        model: modelInfo.model,
      });

    case "google":
      return new ChatGoogle({
        model: modelInfo.model,
      });

    case "openai":
      return new ChatOpenAI({
        model: modelInfo.model,
      });

    case "openrouter":
      return new ChatOpenRouter({
        model: modelInfo.model,
      });

    default:
      throw new Error(`Unsupported model provider: ${modelInfo.modelProvider as string}`);
  }
}
