import { answerValue, formatScore, normalizedOf } from "./score";
import type { Question } from "./question";
import type { DecisionAnswer } from "./utils";

// ---------------------------------------------------------------------------
// Styling (disabled when the terminal does not support it)
// ---------------------------------------------------------------------------

const NO_COLOR =
  process.env.NO_COLOR !== undefined ||
  process.env.TERM === "dumb" ||
  process.stdout.isTTY !== true;

const paint = (code: string, text: string) =>
  NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`;

const dim = (text: string) => paint("2", text);
const bold = (text: string) => paint("1", text);
const green = (text: string) => paint("32", text);
const red = (text: string) => paint("31", text);

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = process.stdout.isTTY === true;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
};

export const formatCount = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export const asUsage = (usage: unknown): Usage =>
  usage && typeof usage === "object" ? (usage as Usage) : {};

/** Compact token/cost line, e.g. `4.3k→18 tok · $0.000182`. */
export const formatUsage = (usage: unknown): string => {
  const { input_tokens, output_tokens, cost } = asUsage(usage);
  const parts: string[] = [];
  if (input_tokens != null || output_tokens != null) {
    parts.push(
      `${formatCount(input_tokens ?? 0)}→${formatCount(output_tokens ?? 0)} tok`,
    );
  }
  if (cost != null) parts.push(`$${Number(cost.toFixed(6))}`);
  return parts.join(" · ");
};

/** Compact score line, e.g. `summary_accuracy=0.898 · hallucination_free=true`. */
export const formatScores = (
  answers: Record<string, DecisionAnswer> | undefined,
  questions?: Record<string, Question>,
): string => {
  if (!answers) return "";
  return Object.entries(answers)
    .map(([key, answer]) => {
      const value = answerValue(answer);
      if (typeof value === "number") {
        const score = normalizedOf(answer, questions?.[key]);
        return `${key}=${score === undefined ? "?" : formatScore(score)}`;
      }
      if (typeof value === "string") return `${key}=${value}`;
      if (typeof value === "boolean") return `${key}=${value}`;
      return `${key}=?`;
    })
    .join(" · ");
};

const oneLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split("\n")[0] ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
};

// ---------------------------------------------------------------------------
// Single-line spinner + stage reporting
// ---------------------------------------------------------------------------

class Progress {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private label = "";
  private active = false;
  private concurrent = false;

  /** With more than one in-flight stage, the spinner would be overwritten. */
  setConcurrency(value: number) {
    this.concurrent = value > 1;
  }

  private draw = () => {
    const frame = FRAMES[this.frame++ % FRAMES.length]!;
    process.stdout.write(`\r\x1b[K  ${dim(frame)} ${this.label}`);
  };

  private begin(label: string) {
    this.label = label;
    if (!isTTY) return;
    this.active = true;
    this.frame = 0;
    this.draw();
    this.timer = setInterval(this.draw, 90);
  }

  private end() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.active) return;
    process.stdout.write("\r\x1b[K");
    this.active = false;
  }

  /**
   * Runs `fn` while showing it as an active stage, then reports its duration
   * and an optional short detail. Never prints the arguments or results.
   */
  stage = async <T>(
    label: string,
    fn: () => Promise<T>,
    detail?: (value: T) => string | undefined,
    prefix?: string,
  ): Promise<T> => {
    if (!this.concurrent) this.begin(label);
    const started = performance.now();
    const tag = this.concurrent && prefix ? `${dim(prefix)} ` : "";
    try {
      const value = await fn();
      this.end();
      const time = dim(formatDuration(performance.now() - started));
      const extra = detail?.(value);
      console.log(
        `  ${green("✓")} ${tag}${label.padEnd(16)} ${time}${extra ? `  ${extra}` : ""}`,
      );
      return value;
    } catch (error) {
      this.end();
      const time = dim(formatDuration(performance.now() - started));
      console.log(`  ${red("✗")} ${tag}${label.padEnd(16)} ${time}`);
      console.log(`    ${red(oneLine(error))}`);
      throw error;
    }
  };
}

const progress = new Progress();

// ---------------------------------------------------------------------------
// Public logger
// ---------------------------------------------------------------------------

export const log = {
  /** Switches stage reporting between the single spinner and plain lines. */
  setConcurrency(value: number) {
    progress.setConcurrency(value);
  },

  /** Prints the run configuration as a short key/value block. */
  header(entries: [string, string][]) {
    console.log(bold("sift eval"));
    const width = Math.max(...entries.map(([key]) => key.length));
    for (const [key, value] of entries) {
      console.log(`  ${dim(key.padEnd(width))}  ${value}`);
    }
    console.log();
  },

  /** Marks the start of one dataset item. */
  item(index: number, total: number) {
    if (index > 1) console.log();
    console.log(bold(`[${index}/${total}]`));
  },

  stage: progress.stage,

  blank() {
    console.log();
  },

  section(title: string) {
    console.log();
    console.log(bold(title));
  },

  /** A summary line, e.g. `items  2/2`. */
  line(key: string, value: string) {
    console.log(`  ${dim(key.padEnd(12))}  ${value}`);
  },

  fail(message: string) {
    console.log(`  ${red("✗")} ${message}`);
  },
};
