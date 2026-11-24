import { ArgumentParser } from "argparse";
import pLimit from "p-limit";

import { Evaluator } from "./eval";
import { questions } from "./question";
import type { DecisionResult, ExperimentConfig } from "./utils";
import {
  asUsage,
  formatCount,
  formatDuration,
  formatScores,
  formatUsage,
  log,
} from "./log";
import { formatScore, normalizedOf } from "./score";

import data from "./test.json";

import { NewsletterSummarizationAgent } from "../core/agent";
import { DescribeImageAgent } from "../core/agent/describeImage/agent";
import type { MaskedContent } from "../core/process";
import { summarizeNewsletterPrompt as prompt } from "../core/agent/summarizeNewsletter/prompt";

const parser = new ArgumentParser();

parser.add_argument("--experiment-name", {
  help: "Experiment Run Name",
  default: "experiment-" + Bun.randomUUIDv7(),
});
parser.add_argument("--dataset-name", {
  help: "Dataset Name",
  default: "unnamed",
});
parser.add_argument("--decision-provider", {
  help: "Decision Model Provider to use for AI Agent Eval. (openai, openrouter, typesafe)",
  required: true,
});
parser.add_argument("--decision-model", {
  help: "Decision Model to use (provier/model_name)",
  required: true,
});
parser.add_argument("--model-provider", {
  help: "Model Provider to use for AI Agent Eval. (openai, openrouter, anthropic, google)",
  required: true,
});
parser.add_argument("--model", {
  help: "LLM Model to use (provier/model_name)",
  required: true,
});
parser.add_argument("--use-images", {
  help: "Summarize Images for evaluations",
  default: false,
  action: "store_true",
});
parser.add_argument("--upload-eval", {
  help: "Uploads the Evals to Langsmith",
  default: false,
  action: "store_true",
});
parser.add_argument("--plimit", {
  help: "Number of parallel eval processes",
  default: 25,
  type: "int",
});

const args = parser.parse_args();

const decision_provider = args.decision_provider;
const decision_model = args.decision_model;
const model_provider = args.model_provider;
const model = args.model;
const experiment_name = args.experiment_name;
const dataset_name = args.dataset_name;
const use_images = args.use_images;
const upload_eval = args.upload_eval;
const concurrency = Number(args.plimit);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error(`--plimit must be a positive integer, got ${args.plimit}`);
}

const limit = pLimit(concurrency);

const summaryAgent = await NewsletterSummarizationAgent.create(
  { modelProvider: model_provider, model },
  {
    vlmProvider: model_provider,
    vlmName: model,
    processImages: use_images,
  },
);

const imageAgent = await DescribeImageAgent.create(
  {
    modelProvider: model_provider,
    model,
  },
  "describe the image content briefly in one line",
);

const experimentConfig: ExperimentConfig = {
  llm_provider: model_provider,
  llm_model: model,
  decision_provider,
  decision_model,
  use_images,
  prompt,
};

const evaluator = new Evaluator(
  experiment_name,
  dataset_name,
  experimentConfig,
);

log.header([
  ["experiment", experiment_name],
  ["dataset", `${dataset_name} · ${data.length} items`],
  ["llm", `${model_provider} · ${model}`],
  ["decision", `${decision_provider} · ${decision_model}`],
  ["images", use_images ? "on" : "off"],
  ["upload", upload_eval ? "on" : "off"],
  ["parallel", String(concurrency)],
]);

log.setConcurrency(concurrency);

type EvalRow = {
  prompt: string;
  input: string;
  output: string;
  use_images: boolean;
  ttft_ms: number;
  generation_ms: number;
  result: DecisionResult;
};

const results: (EvalRow | undefined)[] = Array.from<EvalRow | undefined>({
  length: data.length,
});
const totals = { input: 0, output: 0, cost: 0 };
const scoresByKey = new Map<string, number[]>();
const ttfts: number[] = [];
const generationTimes: number[] = [];
let failures = 0;
const startedAt = performance.now();

// Run the dataset with bounded concurrency.
const tasks = data.map((item, position) =>
  limit(async () => {
    const prefix = `[${position + 1}/${data.length}]`;
    if (concurrency === 1) log.item(position + 1, data.length);

    try {
      let input = item.content;

      // Generate summary
      const generation = await log.stage(
        "summarize",
        async () => {
          const startedAt = new Date();
          const started = performance.now();
          let text = "";
          let ttftMs: number | undefined;
          for await (const chunk of summaryAgent.invoke(
            item as MaskedContent,
          )) {
            if (ttftMs === undefined && chunk.length > 0) {
              ttftMs = performance.now() - started;
            }
            text += chunk;
          }
          const totalMs = performance.now() - started;
          return {
            text,
            ttftMs: ttftMs ?? totalMs,
            totalMs,
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
          };
        },
        (run) =>
          `ttft ${formatDuration(run.ttftMs)} · total ${formatDuration(run.totalMs)} · ${formatCount(run.text.length)} chars`,
        prefix,
      );

      ttfts.push(generation.ttftMs);
      generationTimes.push(generation.totalMs);

      let output = generation.text;

      // Handle links
      const imageLinks = Object.values(item.links).filter(
        (link) => link.isImage,
      );

      if (use_images && imageLinks.length > 0) {
        await log.stage(
          "describe images",
          async () => {
            let described = 0;
            for (const link of Object.values(item.links)) {
              if (link.isImage) {
                let description = "";
                for await (const chunk of imageAgent.invoke(link.url)) {
                  description += chunk;
                }
                input = input.replaceAll(
                  `LINK_${link.id}`,
                  "Image about" + description,
                );
                output = output.replaceAll(
                  `LINK_${link.id}`,
                  "Image about" + description,
                );
                described++;
              } else {
                input = input.replaceAll(`LINK_${link.id}`, "");
                output = output.replaceAll(`LINK_${link.id}`, "");
              }
            }
            return described;
          },
          (count) => `${count} image${count === 1 ? "" : "s"}`,
          prefix,
        );
      } else {
        for (const link of Object.values(item.links)) {
          input = input.replaceAll(`LINK_${link.id}`, "");
          output = output.replaceAll(`LINK_${link.id}`, "");
        }
      }

      // Evaluate
      const state = {
        prompt,
        input,
        output,
      };

      const { result } = await log.stage(
        "evaluate",
        () =>
          evaluator.evaluate({
            state,
            questions,
            provider: decision_provider,
            model: decision_model,
            uploadEval: upload_eval,
            generation: {
              ttft_ms: generation.ttftMs,
              total_ms: generation.totalMs,
              started_at: generation.startedAt,
              ended_at: generation.endedAt,
            },
          }),
        ({ result }) =>
          [formatScores(result.answers, questions), formatUsage(result.usage)]
            .filter(Boolean)
            .join(" · "),
        prefix,
      );

      const usage = asUsage(result.usage);
      totals.input += usage.input_tokens ?? 0;
      totals.output += usage.output_tokens ?? 0;
      totals.cost += usage.cost ?? 0;

      for (const [key, answer] of Object.entries(result.answers ?? {})) {
        const score = normalizedOf(answer, questions[key]);
        if (score === undefined) continue;
        scoresByKey.set(key, [...(scoresByKey.get(key) ?? []), score]);
      }

      results[position] = {
        ...state,
        use_images,
        ttft_ms: Math.round(generation.ttftMs),
        generation_ms: Math.round(generation.totalMs),
        result,
      };
    } catch {
      // The failing stage already reported the error; keep going.
      failures++;
    }
  }),
);

await Promise.all(tasks);
log.setConcurrency(1);

const completed = results.filter((row): row is EvalRow => row !== undefined);

await Bun.write("./results.json", JSON.stringify(completed, null, 2));

if (upload_eval) {
  log.blank();
  try {
    await log.stage(
      "upload",
      () => evaluator.upload(),
      (response) => {
        if (response === undefined) return "nothing to upload";
        const record = response as Record<string, unknown>;
        const id = record.experiment_id ?? record.id;
        return typeof id === "string"
          ? `experiment ${id}`
          : `dataset ${dataset_name}`;
      },
    );
  } catch {
    failures++;
  }
}

log.section("summary");
log.line(
  "items",
  failures === 0
    ? `${completed.length}/${data.length}`
    : `${completed.length}/${data.length} (${failures} failed)`,
);
log.line("duration", formatDuration(performance.now() - startedAt));
if (ttfts.length > 0) {
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  log.line("ttft", formatDuration(mean(ttfts)));
  log.line("generation", formatDuration(mean(generationTimes)));
}
for (const [key, scores] of scoresByKey) {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  log.line("score", `${key}  ${formatScore(mean)}  (n=${scores.length})`);
}
log.line(
  "tokens",
  `${formatCount(totals.input)} in · ${formatCount(totals.output)} out · $${Number(totals.cost.toFixed(6))}`,
);
log.line("results", "./results.json");

if (failures > 0) process.exitCode = 1;
