// Tests for the vision-settings rule in the summarization agent's context
// schema. The rule: the vision settings are optional while image processing is
// off, and required as soon as it is on — this is what used to fail with a zod
// error on any run that left vlm_provider/vlm_name unset.

import { describe, expect, it } from "vitest";

import { toolConfigSchema } from "../../core/agent/summarizeNewsletter/agent";

const parse = (toolConfig: unknown) => toolConfigSchema.safeParse(toolConfig);

const failureMessages = (toolConfig: unknown) => {
  const result = parse(toolConfig);
  if (result.success) throw new Error("expected validation to fail");
  return result.error.issues.map((issue) => issue.message).join(" | ");
};

describe("toolConfigSchema — image processing off", () => {
  it("accepts settings that are undefined", () => {
    const result = parse({
      vlmProvider: undefined,
      vlmName: undefined,
      processImages: false,
    });

    expect(result.success).toBe(true);
  });

  it("accepts settings stored as null", () => {
    // defaults.json writes unset settings as null.
    const result = parse({
      vlmProvider: null,
      vlmName: null,
      processImages: false,
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty and whitespace-only strings as unset", () => {
    expect(
      parse({ vlmProvider: "", vlmName: "  ", processImages: false }).success,
    ).toBe(true);
  });

  it("still accepts configured vision settings", () => {
    const result = parse({
      vlmProvider: "openai",
      vlmName: "gpt-4o-mini",
      processImages: false,
    });

    expect(result.success).toBe(true);
  });
});

describe("toolConfigSchema — image processing on", () => {
  it("requires the vision settings to be set", () => {
    const message = failureMessages({
      vlmProvider: undefined,
      vlmName: undefined,
      processImages: true,
    });

    expect(message).toMatch(/process_images is enabled/);
    expect(message).toMatch(/vlm_provider and vlm_name/);
  });

  it.each([
    ["empty strings", ""],
    ["null", null],
  ])("rejects %s as not set", (_label, value) => {
    expect(
      parse({ vlmProvider: value, vlmName: value, processImages: true })
        .success,
    ).toBe(false);
  });

  it("rejects a provider without a name", () => {
    expect(
      parse({
        vlmProvider: "openai",
        vlmName: undefined,
        processImages: true,
      }).success,
    ).toBe(false);
  });

  it("accepts both settings", () => {
    const result = parse({
      vlmProvider: "openai",
      vlmName: "gpt-4o-mini",
      processImages: true,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.vlmProvider).toBe("openai");
  });

  it("still rejects an unknown provider", () => {
    expect(
      parse({
        vlmProvider: "not-a-provider",
        vlmName: "gpt-4o-mini",
        processImages: true,
      }).success,
    ).toBe(false);
  });
});
