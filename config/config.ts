import type { ModelProvider } from "../core/agent/model";

export interface Config {
  email: string;
  displayName: string | undefined;
  markAsRead: boolean;
  llmProvider: ModelProvider | undefined;
  llmName: string | undefined;
  llmBaseUrl: string | undefined;
  processImages: boolean;
  vlmProvider: ModelProvider | undefined;
  vlmName: string | undefined;
  vlmBaseUrl: string | undefined;
}
