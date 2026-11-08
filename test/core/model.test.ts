// Tests for `getModel`, focused on the OpenAI provider.
//
// OpenAI is the one provider that can be pointed at a custom endpoint, so its
// rules differ: the hosted API needs `OPENAI_API_KEY`, a self-hosted
// OpenAI-compatible endpoint usually has no key at all.
//
// Constructing a `ChatOpenAI` never touches the network, so these run offline.

import { afterEach, describe, expect, it } from "vitest";

import { getModel } from "../../core/agent/model";

/** The environment as the test found it, restored after each case. */
const originalKey = process.env.OPENAI_API_KEY;

const givenApiKey = (value: string | undefined) => {
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
};

afterEach(() => {
  givenApiKey(originalKey);
});

/** What `ChatOpenAI` remembers about the key and the endpoint. */
const clientOf = (model: unknown) => {
  const openAi = model as {
    apiKey?: string;
    clientConfig: { apiKey?: string; baseURL?: string };
  };
  return {
    apiKey: openAi.apiKey,
    clientApiKey: openAi.clientConfig.apiKey,
    baseUrl: openAi.clientConfig.baseURL,
  };
};

const openAi = (baseUrl?: string) =>
  getModel({ model: "gpt-oss-20b", modelProvider: "openai", baseUrl });

describe("getModel — OpenAI, hosted API", () => {
  it("fails with a clear message when no key is configured", async () => {
    givenApiKey(undefined);

    await expect(openAi()).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it("treats a blank key as no key", async () => {
    givenApiKey("   ");

    await expect(openAi()).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it("registers the configured key and stays on the hosted endpoint", async () => {
    givenApiKey("  sk-test-key  ");

    const { apiKey, clientApiKey, baseUrl } = clientOf(await openAi());

    expect(apiKey).toBe("sk-test-key"); // trimmed
    expect(clientApiKey).toBe("sk-test-key");
    expect(baseUrl).toBeUndefined();
  });
});

describe("getModel — OpenAI, custom endpoint", () => {
  it("registers the key and points the client at the base URL", async () => {
    givenApiKey("sk-endpoint-key");

    const { apiKey, clientApiKey, baseUrl } = clientOf(
      await openAi("http://localhost:11434/v1"),
    );

    expect(apiKey).toBe("sk-endpoint-key");
    expect(clientApiKey).toBe("sk-endpoint-key");
    expect(baseUrl).toBe("http://localhost:11434/v1");
  });

  it("starts without a key rather than failing", async () => {
    givenApiKey(undefined);

    const { apiKey, clientApiKey, baseUrl } = clientOf(
      await openAi("http://localhost:11434/v1"),
    );

    // Left blank: a self-hosted endpoint may not check it at all.
    expect(apiKey).toBe("placeholder");
    expect(clientApiKey).toBe("");
    expect(baseUrl).toBe("http://localhost:11434/v1");
  });

  it("passes the base URL through untouched", async () => {
    givenApiKey("sk-endpoint-key");

    const { baseUrl } = clientOf(
      await openAi("https://gateway.example.com/openai/v1"),
    );

    expect(baseUrl).toBe("https://gateway.example.com/openai/v1");
  });
});
