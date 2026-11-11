type StateImage = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type State = string | StateImage;

export type Question =
  | {
      type: "noul";
      instructions: string;
      criteria: {
        true: string;
        false: string;
      };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

type Provider = "openai" | "openrouter" | "typesafe";

export interface EvaluateOptions {
  state: State[];
  questions: Record<string, Question>;
  provider: Provider;
  model: string;
}

export const Image = (url: string): StateImage => ({
  type: "image_url",
  image_url: { url },
});

export const evaluate = async ({
  state,
  questions,
  provider,
  model,
}: EvaluateOptions) => {
  switch (provider) {
    case "openai":
      return await requestOpenAIDecision({ state, questions, model });
    case "openrouter":
      return await requestOpenrouterDecision({ state, questions, model });
    case "typesafe":
      return await requestTypesafeDecision({ state, questions, model });
    default:
      throw new Error(
        `Invalid model provider ${provider as string}. Valid options: "openai", "openrouter", "typesafe"`,
      );
  }
};

const requestOpenAIDecision = async ({
  state,
  questions,
  model,
}: {
  state: State[];
  questions: Record<string, Question>;
  model: string;
}) => {
  const url = "https://api.openai.com/v1/decisions";

  // Convert OpenRouter-style state into OpenAI input.
  const input = state.map((item) =>
    typeof item === "string"
      ? { type: "input_text", text: item }
      : {
          type: "input_image",
          image_url: item.image_url.url,
        },
  );

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
        content: input,
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

const requestOpenrouterDecision = async ({
  state,
  questions,
  model,
}: {
  state: State[];
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

  return await getResponse({ url, headers, body, provider: "openrouter" });
};

const requestTypesafeDecision = async ({
  state,
  questions,
  model,
}: {
  state: State[];
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
  return response.json();
};
