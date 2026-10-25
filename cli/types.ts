/**
 * The TUI's view model: one mail as the screen needs it.
 *
 * It is built from the core's messages by `toMailSummary` (lib/mail.ts), which
 * is the only place that knows the core's message shape.
 */
import type { MaskedContent } from "../core/process";

export interface MailSummary {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  labels: string[];
  /** True when the message carries the `unread` label. */
  unread: boolean;
  /** Plain text of the message as received. */
  text: string;
  /** Processed body (markdown with masked links). Input to `core.summarize()`. */
  content: MaskedContent;
}

export interface TuiOptions {
  /** Called once when the TUI shuts down (q, Ctrl+C, or `handle.destroy()`). */
  onExit?: () => void;
  /** Clock override, mainly for tests. */
  now?: () => Date;
}

export interface TuiHandle {
  /** Reload the mail with the current filter (same as pressing `r`). */
  reload(): Promise<void>;
  /** Restore the terminal and stop the TUI. */
  destroy(): void;
}
