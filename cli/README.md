# sift TUI

A mailbox-style terminal UI built on [OpenTUI](https://github.com/anomalyco/opentui).
Mail list on the left, message on the right. The TUI takes a `SiftCore` and uses
it for everything: listing, summaries, marking read and deleting.

## Start it

```ts
// index.ts
const core = await SiftCore.init(config);
await startTui(core, { onExit: () => process.exit(0) });
```

`startTui` returns once the screen is up. Mail appears as the core streams it in.

Try it without an account (a mock core with the same surface):

```sh
bun run cli/demo.ts                # summarize on demand
bun run cli/demo.ts --summarize    # summarize when a mail is opened
bun run cli/demo.ts --mark-as-read # mark mail read when it is opened
```

## Config flags

The TUI reads these from `core.config`. Each one is also a CLI flag.

| Setting      | Flag             | Effect in the TUI                                                                                      |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `markAsRead` | `--mark-as-read` | Opening an unread mail removes its `unread` label.                                                     |
| `summarize`  | `--summarize`    | Opening a mail streams its summary. Off: the text shows, and the Summarize button creates the summary. |

## Keys

| Key                       | List                                    | Preview                                     |
| ------------------------- | --------------------------------------- | ------------------------------------------- |
| `j` / `k` (`↓` / `↑`)     | move the cursor                         | scroll                                      |
| `enter`                   | open the highlighted mail               | –                                           |
| `l` (`→`) / `tab`         | open the highlighted mail and focus it  | –                                           |
| `h` (`←`) / `esc` / `tab` | –                                       | back to the list (cancels a pending delete) |
| `u`                       | toggle All / Unread                     | toggle All / Unread                         |
| `r`                       | full reload from the core               | full reload                                 |
| `m`                       | flip the highlighted mail read / unread | flip the open mail read / unread            |
| `s`                       | –                                       | summary ↔ text (summarizes on first use)    |
| `d`                       | –                                       | delete the open mail (asks first)           |
| `y` / `n`                 | –                                       | confirm / cancel a delete                   |
| `g` / `G`                 | first / last mail                       | top / bottom of the message                 |
| `ctrl+d` / `ctrl+u`       | page down / up                          | page down / up                              |
| `<` / `>`                 | move the pane divider                   | move the pane divider                       |
| `q` / `ctrl+c`            | quit                                    | quit                                        |

**Mouse:** click a row to open it · click a pane to focus it · wheel to scroll ·
the **All / Unread** control above the list · the **Summarize**, **Mark as read /
Mark as unread** and **Delete** buttons above the message (Delete asks first).
The read button flips the mail's state, so it works both ways. **Drag the border
between the list and the preview** to resize the list.

The divider shows a small bright mark in its middle: that is the grip. It is
centred on the seam of the two border columns — two half blocks, `▐` on the
list's border and `▌` on the preview's — so it straddles the line instead of
sitting on one side of it. It means the line can be moved: drag it, or press `<`
/ `>` to nudge it a few columns at a time.

**Looking at a picture.** Click any picture — in the summary or in the message,
they behave the same — and it opens as large as the screen allows. The mail
behind is veiled, not hidden: a translucent layer of the background colour lets
the terminal blend it with what is underneath, so the picture stands out while
the letter stays readable. While it is open the keyboard belongs to it:

| Input                   | Effect                              |
| ----------------------- | ----------------------------------- |
| `=` (`+`) / `-`         | zoom in / out (50%–600%, 50% steps) |
| `ctrl` + wheel          | the same                            |
| `0`                     | back to whole picture, centred      |
| `h` `j` `k` `l`, arrows | move up / down / sideways           |
| wheel                   | move up and down a row at a time    |
| `shift` + wheel         | move sideways a couple of columns   |
| `esc`, `q`, or the `×`  | close and go back to the mail       |

The `×` is a five-by-three button in the very top-right corner of the screen — a
space either side of the cross, an outline in the focused-border colour, the
theme's own background, and a white cross — so it is always in the same place
and never over the picture. Nothing behind the overlay takes clicks or keys
while it is open.

## What the preview shows

- Subject, sender, date, and the message's labels.
- The message by default, **rendered from its markdown** (headings, emphasis, lists,
  quotes, code and links), not as its source. With _summary_ on, the streamed
  summary instead. Loading, empty and error notes are drawn as plain text, so
  their punctuation is never read as markdown.
- **Pictures**, in the message and in the summary alike: a picture standing on its
  own line in the markdown is drawn by `ImageBlock` — scaled to fit, at most three
  quarters of the screen wide and half its height, centred, captioned with its
  address, and saying so when it cannot be loaded. Pictures inside a sentence stay
  in the prose. Clicking one opens `ImageOverlay`, which draws just that picture,
  zoomable and pannable, until it is closed.
- A failed summary says why and keeps any partial text. Press `s` to retry.
- A failed mark-as-read or delete shows a notice in the status bar and puts the mail back the way it was.

## Layout and behaviour

- **Split** at 80+ columns: list ≈ 36% (30–56 cols). **Stacked** below that: one pane
  at a time, `enter` opens the message, `h`/`esc` goes back. Resizing switches live.
  On a split screen the border between the panes can be **dragged** (or nudged with
  `<` / `>`) to move the split; the list stops at 30 columns and at 60% of the
  terminal. A width you chose survives a terminal resize.
- **Startup** shows unread mail. Press `u` for everything.
- Unread mail is marked with **●** in the list.
- **Streaming:** the list fills in as the core yields mail, so the first message
  shows early. `r` and the filter re-run the stream from scratch.
- **Summaries** are kept per message for the session, so a finished summary is
  never requested again. A summary in progress is not cancelled by moving to
  another mail.
- **Bodies** are fetched when a message is opened and remembered until the next
  reload: pressing `r` drops them, so `r` shows what the server has now rather
  than a cached copy.

## How it talks to the core

Only `cli/lib/mail.ts` knows the core's message shape. It maps a list row onto
the TUI's view model (`MailSummary`, metadata only) and a fetched message onto
`MailBody`. Everything else uses those.

| Core                                              | Used for                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `listMessages(request)`                           | the list (streamed rows, no bodies), `r`, the unread filter (`labels: ["unread"]`) |
| `getMessage(id)`                                  | the body of the message being read (fetched on open, then cached)                  |
|                                                   | its `text` is markdown, drawn by OpenTUI's markdown renderer                       |
| `summarize(content)`                              | summaries (streamed)                                                               |
| `setMessageLabel(id, { removeLabels: "unread" })` | mark as read                                                                       |
| `setMessageLabel(id, { addLabels: "unread" })`    | mark as unread                                                                     |
| `deleteMessage(id)`                               | delete (after confirmation)                                                        |
| `config.markAsRead` / `config.summarize`          | open behaviour                                                                     |

## Layout of this directory

```
cli/
  index.ts          startTui(core, opts) / mountTui(renderer, core, opts)
  app.ts            controller: store ⇄ components, input, core calls
  state.ts          State, actions, pure reducer, Store (no UI, no core)
  keymap.ts         key → Command (pure), footer hints
  layout.ts         terminal width → split | stacked (pure)
  theme.ts          the monotone palette
  types.ts          MailSummary (view model), TuiOptions, TuiHandle
  lib/mail.ts       core message → MailSummary, markdownOf (pure)
  lib/markdown.ts   markdown → prose and picture blocks (pure)
  lib/zoom.ts       overlay zoom, pan and placement (pure)
  lib/preview.ts    what the preview shows (pure)
  lib/format.ts     sender and time formatting (pure)
  lib/fit.ts        cell-aware truncation (pure)
  components/       Pane, MailList, MailListItem, MailPreview, StatusBar,
                    ImageBlock, ImageOverlay, DividerHandle, Button,
                    EllipsisText, primitives
  mock.ts, demo.ts  a mock SiftCore and a runnable demo
```

Data flows one way: input → `store.dispatch(action)` → reducer → `app.render(state)`
→ components. Components never call the core. `app.ts` is the only place that does.

## Tests

```sh
bun run test       # vitest: reducer, keymap, mail mapping, preview logic, config, core
bun run test:tui   # bun test: the whole TUI on OpenTUI's headless renderer
```

The TUI end-to-end file (`test/cli/app.bun.test.ts`) needs OpenTUI's native
renderer, which loads only under Bun, so it is excluded from vitest
(`vitest.config.ts`) and runs with `bun test`. It uses the mock core and checks
the rendered screen, the core calls, and the notices.
