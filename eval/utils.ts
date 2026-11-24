import { type Question } from "./question";

export type Provider = "openai" | "openrouter" | "typesafe";

/** Configuration describing how an experiment was produced. */
export type ExperimentConfig = {
  llm_provider: string;
  llm_model: string;
  decision_provider: Provider;
  decision_model: string;
  use_images: boolean;
  prompt: string;
};

/** A single answer returned by the decision API for one question. */
export type DecisionAnswer = {
  type?: string;
  score?: unknown;
  value?: unknown;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
  [key: string]: unknown;
};

/** Response returned by the decision API. */
export type DecisionResult = {
  model?: string;
  provider?: string;
  id?: string;
  usage?: unknown;
  answers: Record<string, DecisionAnswer>;
};

export const requestOpenAIDecision = async ({
  state,
  questions,
  model,
}: {
  state: string;
  questions: Record<string, Question>;
  model: string;
}) => {
  const url = "https://api.openai.com/v1/decisions";

  // Convert common questions into OpenAI format.
  const openAIQuestions = Object.entries(questions).map(([name, question]) => {
    switch (question.type) {
      case "noul":
        return {
          name,
          type: "predicate",
          instructions: question.instructions,
        };

      case "choice":
        return {
          name,
          type: "choice",
          instructions: question.instructions,
          choices: Object.entries(question.criteria).map(
            ([value, description]) => ({
              value,
              description,
            }),
          ),
        };

      case "score":
        return {
          name,
          type: "score",
          instructions: question.instructions,
          levels: question.criteria,
        };
    }
  });

  const body = {
    model,
    input: [
      {
        role: "user",
        content: state,
      },
    ],
    questions: openAIQuestions,
  };

  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  return await getResponse({ url, headers, body, provider: "openai" });
};

export const requestOpenrouterDecision = async ({
  state,
  questions,
  model,
}: {
  state: string;
  questions: Record<string, Question>;
  model: string;
}) => {
  const url = "https://openrouter.ai/api/alpha/decisions";

  const body = {
    model,
    state,
    questions,
  };

  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };

  return await getResponse({
    url,
    headers,
    body,
    provider: "openrouter",
  });
};

export const requestTypesafeDecision = async ({
  state,
  questions,
  model,
}: {
  state: string;
  questions: Record<string, Question>;
  model: string;
}) => {
  const url = "https://api.typesafe.ai/v1/systemone";

  const body = {
    model,
    state,
    questions,
  };

  const headers = {
    Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
    "Content-Type": "application/json",
  };

  return await getResponse({ url, headers, body, provider: "typesafe" });
};

const getResponse = async ({
  url,
  headers,
  body,
  provider,
}: {
  url: string;
  headers: Record<string, string>;
  body: any;
  provider: Provider;
}) => {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider} API error (${response.status}): ${error}`);
  }
  return (await response.json()) as DecisionResult;
};
