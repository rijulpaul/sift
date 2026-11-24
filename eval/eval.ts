import { type Question } from "./question";
import { answerValue, normalizedOf, roundScore } from "./score";
import type {
  DecisionAnswer,
  DecisionResult,
  ExperimentConfig,
  Provider,
} from "./utils";
import {
  requestOpenAIDecision,
  requestOpenrouterDecision,
  requestTypesafeDecision,
} from "./utils";

export type FeedbackConfig = {
  type: "continuous" | "categorical" | "freeform";
  min?: number;
  max?: number;
  categories?: { value: number; label?: string }[];
};

export type FeedbackScore = {
  key: string;
  score?: number;
  value?: string;
  comment?: string;
  feedback_source?: { type: string };
  feedback_config?: FeedbackConfig;
  created_at?: string;
  modified_at?: string;
  correction?: Record<string, unknown> | string;
};

export type ExperimentRow = {
  row_id: string;
  inputs: Record<string, unknown>;
  expected_outputs?: Record<string, unknown>;
  actual_outputs?: Record<string, unknown>;
  evaluation_scores?: FeedbackScore[];
  start_time: string;
  end_time: string;
  run_metadata?: Record<string, unknown>;
};

export type UploadExperimentBody = {
  dataset_name: string;
  experiment_name: string;
  experiment_start_time: string;
  experiment_end_time: string;
  experiment_metadata?: Record<string, unknown>;
  summary_experiment_scores?: FeedbackScore[];
  results: ExperimentRow[];
};

// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  state: {
    input: string;
    output: string;
    prompt: string;
  };
  questions: Record<string, Question>;
  provider: Provider;
  model: string;
  uploadEval: boolean;
  /** Timing of the summarize generation that produced `state.output`. */
  generation?: {
    ttft_ms: number;
    total_ms: number;
    started_at: string;
    ended_at: string;
  };
}

const feedbackSource = { type: "model" };

/** Describes the allowed values of a question in LangSmith's feedback_config format. */
const toFeedbackConfig = (
  question: Question | undefined,
  answer: DecisionAnswer,
): FeedbackConfig => {
  const type = question?.type ?? answer.type;
  switch (type) {
    case "score":
      // Scores are uploaded normalized to 0-1.
      return { type: "continuous", min: 0, max: 1 };
    case "noul":
    case "predicate": {
      // Predicates usually arrive as a probability of `true` (0-1), which is
      // already normalized; booleans stay categorical.
      const raw = answerValue(answer);
      if (typeof raw !== "boolean") {
        return { type: "continuous", min: 0, max: 1 };
      }
      return {
        type: "categorical",
        categories: [
          {
            value: 1,
            label: question?.type === "noul" ? question.criteria.true : "true",
          },
          {
            value: 0,
            label:
              question?.type === "noul" ? question.criteria.false : "false",
          },
        ],
      };
    }
    case "choice": {
      const labels = Object.keys(
        question?.type === "choice" ? question.criteria : {},
      );
      return {
        type: "categorical",
        // Categories are spread over 0-1 so choice answers share the same scale.
        categories: labels.map((label, index) => ({
          value:
            labels.length <= 1 ? 1 : roundScore(index / (labels.length - 1)),
          label,
        })),
      };
    }
    default:
      return { type: "freeform" };
  }
};

/** Converts one decision answer into a LangSmith evaluation score object. */
const toFeedback = (
  key: string,
  answer: DecisionAnswer,
  question: Question | undefined,
): FeedbackScore => {
  const raw = answerValue(answer) ?? answer.choice;

  // Probabilities / confidence are kept as human-readable context.
  const details: string[] = [];
  if (answer.probabilities) {
    const probs = Object.entries(answer.probabilities)
      .map(([index, p]) => `${answer.legend?.[index] ?? index}=${p}`)
      .join(", ");
    details.push(`probabilities: ${probs}`);
  }
  if (typeof answer.confidence === "number") {
    details.push(`confidence: ${answer.confidence}`);
  }

  const feedback: FeedbackScore = {
    key,
    feedback_source: feedbackSource,
    feedback_config: toFeedbackConfig(question, answer),
    ...(details.length > 0 && { comment: details.join("; ") }),
  };

  // Every score is uploaded normalized to 0-1.
  const score = normalizedOf(answer, question);
  if (score !== undefined) feedback.score = score;

  if (typeof raw === "boolean" || typeof raw === "string") {
    feedback.value = String(raw);
  }

  return feedback;
};

/**
 * Metadata describing how the experiment was produced. Kept flat so
 * individual keys stay filterable in LangSmith.
 */
const toMetadata = (config: ExperimentConfig): Record<string, unknown> => ({
  llm_provider: config.llm_provider,
  llm_model: config.llm_model,
  decision_provider: config.decision_provider,
  decision_model: config.decision_model,
  use_images: config.use_images,
  prompt: config.prompt,
});

/** Mean of every numeric score per key, across all rows. */
const summarize = (rows: ExperimentRow[]): FeedbackScore[] => {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    for (const s of row.evaluation_scores ?? []) {
      if (typeof s.score !== "number") continue;
      byKey.set(s.key, [...(byKey.get(s.key) ?? []), s.score]);
    }
  }
  return [...byKey].map(([key, scores]) => ({
    key,
    // Mean of normalized scores, rounded to avoid LangSmith float errors.
    score: roundScore(scores.reduce((a, b) => a + b, 0) / scores.length),
    comment: `mean over ${scores.length} run(s)`,
    feedback_source: feedbackSource,
  }));
};

export class Evaluator {
  private rows: ExperimentRow[] = [];

  constructor(
    readonly experimentName: string,
    readonly datasetName: string,
    private readonly config: ExperimentConfig,
  ) {}

  evaluate = async ({
    state,
    questions,
    uploadEval,
    generation,
  }: EvaluateOptions): Promise<{ result: DecisionResult }> => {
    const startTime = new Date();
    const result = await this.decide({
      state,
      questions,
      provider: this.config.decision_provider,
      model: this.config.decision_model,
    });
    const endTime = new Date();

    if (uploadEval) {
      this.rows.push({
        row_id: Bun.randomUUIDv7(),
        inputs: { input: state.input, prompt: state.prompt },
        actual_outputs: { output: state.output },
        evaluation_scores: Object.entries(result.answers ?? {}).map(
          ([key, answer]) => toFeedback(key, answer, questions[key]),
        ),
        start_time: generation?.started_at ?? startTime.toISOString(),
        end_time: generation?.ended_at ?? endTime.toISOString(),
        run_metadata: {
          ...toMetadata(this.config),
          ...(generation && {
            ttft_ms: Math.round(generation.ttft_ms),
            generation_ms: Math.round(generation.total_ms),
          }),
          decision_id: result.id,
          decision_model_used: result.model,
          decision_provider_used: result.provider,
          usage: result.usage,
          decision_answers: result.answers,
        },
      });
    }

    return { result };
  };

  /** Sends every collected row as a single LangSmith experiment. */
  upload = async (): Promise<unknown> => {
    if (this.rows.length === 0) {
      console.log("No eval results to upload.");
      return undefined;
    }

    const apiKey = process.env.LANGSMITH_API_KEY;
    if (!apiKey) {
      throw new Error("LANGSMITH_API_KEY is not set; cannot upload eval.");
    }
    const endpoint = (
      process.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com"
    ).replace(/\/+$/, "");

    const starts = this.rows.map((r) => r.start_time).sort();
    const ends = this.rows.map((r) => r.end_time).sort();

    const body: UploadExperimentBody = {
      dataset_name: this.datasetName,
      experiment_name: this.experimentName,
      experiment_start_time: starts[0]!,
      experiment_end_time: ends[ends.length - 1]!,
      experiment_metadata: toMetadata(this.config),
      summary_experiment_scores: summarize(this.rows),
      results: this.rows,
    };

    const response = await fetch(
      `${endpoint}/api/v1/datasets/upload-experiment`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LangSmith upload failed (${response.status}): ${error}`);
    }
    return response.json();
  };

  private decide = async ({
    state,
    questions,
    provider,
    model,
  }: Omit<EvaluateOptions, "uploadEval">): Promise<DecisionResult> => {
    const mergedState =
      "<input>\n" +
      state.input +
      "\n</input>\n<prompt>\n" +
      state.prompt +
      "\n</prompt>\n<output>\n" +
      state.output +
      "\n</output>";
    switch (provider) {
      case "openai":
        return requestOpenAIDecision({ state: mergedState, questions, model });
      case "openrouter":
        return requestOpenrouterDecision({
          state: mergedState,
          questions,
          model,
        });
      case "typesafe":
        return requestTypesafeDecision({
          state: mergedState,
          questions,
          model,
        });
      default:
        throw new Error(
          `Invalid model provider ${provider as string}. Valid options: "openai", "openrouter", "typesafe"`,
        );
    }
  };
}
