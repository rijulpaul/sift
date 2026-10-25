import { describe, expect, it } from "vitest";

import { resolveCommand } from "../../cli/keymap";

describe("resolveCommand", () => {
  it.each([
    ["j", "down"],
    ["down", "down"],
    ["k", "up"],
    ["up", "up"],
    ["h", "left"],
    ["left", "left"],
    ["l", "right"],
    ["right", "right"],
    ["return", "open"],
    ["escape", "back"],
    ["tab", "toggleFocus"],
    ["g", "first"],
    ["home", "first"],
    ["end", "last"],
    ["pagedown", "pageDown"],
    ["pageup", "pageUp"],
    ["r", "refresh"],
    ["u", "toggleUnread"],
    ["m", "markRead"],
    ["s", "summarize"],
    ["d", "delete"],
    ["y", "confirm"],
    ["n", "deny"],
    ["q", "quit"],
  ])("maps %s to %s", (name, command) => {
    expect(resolveCommand({ name })).toBe(command);
  });

  it("maps shift+g (and a literal G) to last", () => {
    expect(resolveCommand({ name: "g", shift: true })).toBe("last");
    expect(resolveCommand({ name: "g", sequence: "G" })).toBe("last");
  });

  it("maps ctrl+d / ctrl+u to paging", () => {
    expect(resolveCommand({ name: "d", ctrl: true })).toBe("pageDown");
    expect(resolveCommand({ name: "u", ctrl: true })).toBe("pageUp");
  });

  it("ignores other ctrl and meta combinations", () => {
    expect(resolveCommand({ name: "j", ctrl: true })).toBeUndefined();
    expect(resolveCommand({ name: "q", meta: true })).toBeUndefined();
  });

  it("ignores unmapped keys", () => {
    expect(resolveCommand({ name: "z" })).toBeUndefined();
  });
});
