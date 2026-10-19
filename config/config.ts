import type { ModelProvider } from "../core/agent/model";

export interface Config {
  tui: boolean;
  webui: boolean;
  email: string | undefined;
  displayName: string | undefined;
  createEmail: boolean;
  autoMarkAsRead: boolean;
  llmProvider: ModelProvider | undefined;
  llmName: string | undefined;
  processImages: boolean;
  vlmProvider: ModelProvider | undefined;
  vlmName: string | undefined;
}
