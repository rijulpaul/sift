import type { Question } from "./question";
import type { DecisionAnswer } from "./utils";

/** Decimal places kept for normalized scores. */
const PRECISION = 3;

/**
 * Rounds a normalized score (0-1) to three decimals.
 *
 * LangSmith rejects long floating point values produced by averaging, so every
 * score is normalized through this helper before it is displayed or uploaded.
 */
export const roundScore = (value: number): number =>
  Math.round(value * 10 ** PRECISION) / 10 ** PRECISION;

/** The answer value itself, independent of which field the provider used. */
export const answerValue = (answer: DecisionAnswer): unknown =>
  (answer.type ? answer[answer.type] : undefined) ??
  answer.score ??
  answer.value;

/**
 * Highest level a score answer can reach.
 *
 * Score answers are reported on their level scale (e.g. 3.59 on a 0-4 scale),
 * so normalizing to 0-1 needs that maximum instead of assuming a 0-1 range.
 */
const maxLevel = (answer: DecisionAnswer, question?: Question): number => {
  const keys = answer.legend ? Object.keys(answer.legend) : [];
  const levels = keys.map(Number);

  if (levels.length > 0 && levels.every((level) => Number.isFinite(level))) {
    return Math.max(...levels) || 1;
  }
  if (keys.length > 1) return keys.length - 1;
  if (question?.type === "score" && question.criteria.length > 1) {
    return question.criteria.length - 1;
  }
  return 1;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Converts a decision answer into a normalized score (0-1).
 *
 * - Score answers are divided by their top level (e.g. 2.8 / 4 = 0.7).
 * - Predicate answers become 0 (false) or 1 (true).
 * - Choice answers spread evenly across their categories.
 */
export const normalizedOf = (
  answer: DecisionAnswer,
  question?: Question,
): number | undefined => {
  const raw = answerValue(answer);

  if (typeof raw === "number") {
    const levels =
      question?.type === "score" || (question === undefined && answer.legend)
        ? maxLevel(answer, question)
        : 1;
    return roundScore(clamp(raw / levels));
  }

  if (typeof raw === "boolean") return raw ? 1 : 0;

  if (typeof raw === "string" && question?.type === "choice") {
    const labels = Object.keys(question.criteria);
    const index = labels.indexOf(raw);
    if (index < 0) return undefined;
    if (labels.length <= 1) return 1;
    return roundScore(index / (labels.length - 1));
  }

  return undefined;
};

/** Formats a normalized score, e.g. `0.7`, `0.898` or `0.333`. */
export const formatScore = (value: number): string =>
  `${parseFloat(roundScore(value).toFixed(PRECISION))}`;
