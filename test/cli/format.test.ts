import { describe, expect, it } from "vitest";

import {
  formatFullDate,
  formatListTime,
  parseSender,
  senderLabel,
} from "../../cli/lib/format";

describe("parseSender", () => {
  it("splits `Name <address>`", () => {
    expect(parseSender("Ada Lovelace <ada@x.io>")).toEqual({
      name: "Ada Lovelace",
      address: "ada@x.io",
    });
  });

  it("strips quotes around the display name", () => {
    expect(parseSender('"Ada L." <ada@x.io>').name).toBe("Ada L.");
  });

  it("uses the address when there is no display name", () => {
    expect(parseSender("ada@x.io")).toEqual({
      name: "ada@x.io",
      address: "ada@x.io",
    });
    expect(parseSender("<ada@x.io>")).toEqual({
      name: "ada@x.io",
      address: "ada@x.io",
    });
  });
});

describe("senderLabel", () => {
  it("prefers the display name", () => {
    expect(senderLabel("Ada <ada@x.io>")).toBe("Ada");
  });

  it("never returns an empty label", () => {
    expect(senderLabel("")).toBe("(unknown sender)");
  });
});

describe("formatListTime", () => {
  const now = new Date(2024, 2, 4, 15, 0); // Mon 4 Mar 2024, 15:00 local

  it("shows the clock time for today", () => {
    expect(formatListTime(new Date(2024, 2, 4, 9, 5), now)).toBe("09:05");
  });

  it("shows Yesterday for the previous calendar day, even a few hours ago", () => {
    expect(formatListTime(new Date(2024, 2, 3, 23, 59), now)).toBe("Yesterday");
  });

  it("shows the weekday within the last week", () => {
    expect(formatListTime(new Date(2024, 2, 1, 12, 0), now)).toBe("Fri");
  });

  it("shows month and day within the same year", () => {
    expect(formatListTime(new Date(2024, 0, 29, 12, 0), now)).toBe("Jan 29");
  });

  it("adds the year for older mail", () => {
    expect(formatListTime(new Date(2023, 0, 29, 12, 0), now)).toBe(
      "Jan 29 2023",
    );
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatListTime(new Date("nope"), now)).toBe("");
  });
});

describe("formatFullDate", () => {
  it("includes weekday, date, year and time", () => {
    expect(formatFullDate(new Date(2024, 2, 4, 14, 32))).toBe(
      "Mon, Mar 4 2024 14:32",
    );
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatFullDate(new Date("nope"))).toBe("");
  });
});
