/** Pure presentation helpers: no renderer imports, trivially testable. */

export interface Sender {
  name: string;
  address: string;
}

/** `"Ada L." <ada@x.io>`, `Ada <ada@x.io>` or `ada@x.io` → `{ name, address }`. */
export function parseSender(raw: string): Sender {
  const input = raw.trim();
  const match = input.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1]!.replace(/^["']|["']$/g, "").trim();
    const address = match[2]!.trim();
    return { name: name || address, address };
  }
  return { name: input, address: input };
}

/** The label shown in the list: the display name, falling back to the address. */
export function senderLabel(raw: string): string {
  return parseSender(raw).name || "(unknown sender)";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const isValid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Compact timestamp for the list column (local time):
 * today → `14:32`, yesterday → `Yesterday`, this week → `Mon`,
 * this year → `Mar 4`, older → `Mar 4 2024`.
 */
export function formatListTime(date: Date, now: Date = new Date()): string {
  if (!isValid(date)) return "";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (days === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return WEEKDAYS[date.getDay()]!;

  const md = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? md
    : `${md} ${date.getFullYear()}`;
}

/** Full timestamp for the preview header, e.g. `Mon, Mar 4 2024 14:32`. */
export function formatFullDate(date: Date): string {
  if (!isValid(date)) return "";
  return (
    `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()} ` +
    `${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
