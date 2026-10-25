/**
 * Key → command translation. Pure, so the whole keymap is unit-tested without
 * a terminal. What a command *does* depends on focus and state, and is decided
 * in app.ts.
 */
export type Command =
  | "down"
  | "up"
  | "left"
  | "right"
  | "first"
  | "last"
  | "pageDown"
  | "pageUp"
  | "open"
  | "back"
  | "toggleFocus"
  | "refresh"
  | "toggleUnread"
  | "markRead"
  | "summarize"
  | "delete"
  | "confirm"
  | "deny"
  | "quit";

/** The subset of OpenTUI's `KeyEvent` the keymap reads. */
export interface KeyLike {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

const PLAIN: Record<string, Command> = {
  j: "down",
  down: "down",
  k: "up",
  up: "up",
  h: "left",
  left: "left",
  l: "right",
  right: "right",
  g: "first",
  home: "first",
  end: "last",
  pagedown: "pageDown",
  pageup: "pageUp",
  return: "open",
  enter: "open",
  linefeed: "open",
  escape: "back",
  tab: "toggleFocus",
  r: "refresh",
  u: "toggleUnread",
  m: "markRead",
  s: "summarize",
  d: "delete",
  y: "confirm",
  n: "deny",
  q: "quit",
};

export function resolveCommand(key: KeyLike): Command | undefined {
  if (key.meta) return undefined;

  if (key.ctrl) {
    if (key.name === "d") return "pageDown";
    if (key.name === "u") return "pageUp";
    return undefined;
  }

  // `G` (shift+g) jumps to the end; plain `g` jumps to the start.
  if (key.name === "g" && (key.shift || key.sequence === "G")) return "last";

  return PLAIN[key.name];
}

/** Footer hints, most important first. The status bar drops the ones that don't fit. */
export const HINTS = {
  list: [
    ["j/k", "move"],
    ["enter", "open"],
    ["u", "all/unread"],
    ["r", "refresh"],
    ["q", "quit"],
  ],
  preview: [
    ["j/k", "scroll"],
    ["s", "summary/text"],
    ["m", "mark read"],
    ["d", "delete"],
    ["h", "back"],
    ["q", "quit"],
  ],
  confirm: [
    ["y", "delete"],
    ["n", "cancel"],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>;
