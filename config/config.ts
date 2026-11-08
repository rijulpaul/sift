import type { ModelProvider } from "../core/agent/model";

export interface Config {
  email: string | undefined;
  displayName: string | undefined;
  createEmail: boolean;
  markAsRead: boolean;
  summarize: boolean;
  llmProvider: ModelProvider | undefined;
  llmName: string | undefined;
  llmBaseUrl: string | undefined;
  processImages: boolean;
  vlmProvider: ModelProvider | undefined;
  vlmName: string | undefined;
  vlmBaseUrl: string | undefined;
}
