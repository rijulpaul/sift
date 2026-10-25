import type { createAgent } from "langchain";

import { logger } from "../logger";

const log = logger.child({ module: "agent" });

export abstract class BaseAgent<TInput, TOutput = string> {
  protected readonly name: string;

  protected agent!: ReturnType<typeof createAgent>;

  constructor({ agentName }: { agentName: string }) {
    this.name = agentName;

    log.info(`[${this.name} Agent] Initializing`);
  }
  /**
   * Public entry point for all agents.
   */
  async *invoke(input: TInput): AsyncIterable<string> {
    log.info(`[${this.name} Agent] Invoking`);

    try {
      for await (const chunk of this.execute(input)) {
        yield chunk;
      }

      log.info(`[${this.name}] completed`);
    } catch (error: any) {
      log.error({ err: error }, `[${this.name}] Agent failed`);
      throw error;
    }
  }

  /**
   * Agent-specific implementation.
   */
  protected abstract execute(input: TInput): AsyncIterable<string>;
}
