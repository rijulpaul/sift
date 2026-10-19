import type { createAgent } from "langchain";

import { logger } from "../logger";

export abstract class BaseAgent<TInput, TOutput = string> {
  protected readonly name: string;

  protected agent!: ReturnType<typeof createAgent>;

  constructor({agentName}:{agentName:string}) {
    this.name = agentName;

    logger.info(`[${this.name} Agent] Initializing`);
  }
  /**
   * Public entry point for all agents.
   */
  async *invoke(input: TInput): AsyncIterable<string> {
    logger.info(`[${this.name} Agent] Invoking`);

    try {
      for await (const chunk of this.execute(input)) {
         yield chunk
       }

      logger.info(`[${this.name}] completed`);

    } catch (error: any) {
      logger.error({err: error},`[${this.name}] Agent failed`);
      throw error;
    }
  }

  /**
   * Agent-specific implementation.
   */
  protected abstract execute(
      input: TInput
    ): AsyncIterable<string>;
}
