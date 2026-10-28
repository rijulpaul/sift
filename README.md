# sift

**A dedicated inbox for your newsletters, so they stop disappearing into your main one.**

Hundreds of messages land in your inbox every day, and newsletters are the first
thing to get skipped. They end up buried between receipts, work threads and
personal mail, which makes them hard to find again when you finally have time to
read. Signing up with your personal address also hands every mailing list your
real identity, and folds your reading habits into everything else you receive.

Sift gives newsletters an address of their own. Subscribe with it, and every
issue lands in one place built for reading them: a terminal or browser inbox that
turns each newsletter into a short summary you can skim in seconds.

[![CI](https://github.com/rijulpaul/sift/actions/workflows/ci.yml/badge.svg)](https://github.com/rijulpaul/sift/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **An inbox of its own.** Newsletters get a dedicated AgentMail address,
  separate from your personal mail. Nothing else lands there, your real address
  stays out of every mailing list, and the address is saved to
  `config/defaults.json` so later runs reuse it.
- **Built for reading newsletters, not clearing a queue.** Two panes: mail on the
  left, the message on the right. Keyboard and mouse, an All / Unread filter, and
  a list that fills in as messages stream in.
- **Terminal or browser.** A terminal inbox for quick triage, and a web inbox for
  when you want a proper window. Both run on the same engine, so your mail,
  summaries and actions are the same either way.
- **Streaming summaries.** Summaries arrive token by token instead of after a
  pause, so the first words are on screen almost immediately.
- **Newsletter-aware processing.** Tracking pixels, scripts and inline styling are
  stripped, the HTML is converted to Markdown, and every URL is replaced by an
  identifier before the model sees it — the agent asks for a link through a tool
  instead of inventing one.
- **Mailbox actions.** Mark read or unread, and delete with a confirmation step.
- **Configurable, interactively or by flag.** An interactive launcher writes a
  validated `config/defaults.json`; every setting can also be overridden per run.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer — Sift runs on Bun (it is also what loads
  `.env` and runs the TUI tests).
- An [AgentMail](https://agentmail.to) API key.
- An API key for one supported model provider: OpenRouter, Anthropic, OpenAI or
  Google.

## Getting started

```sh
git clone https://github.com/rijulpaul/sift.git
cd sift
bun install
```

Create a `.env` with your AgentMail key:

```sh
cp .env.example .env
```

```ini
AGENTMAIL_API_KEY="your-agentmail-api-key"
```

Add the key for the provider you plan to use (Bun loads `.env` automatically):

```ini
OPENROUTER_API_KEY="..."
# or ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY
```

Then run it:

```sh
bun run dev
```

On the first run there is no `config/defaults.json` yet, so Sift walks you
through the settings it needs and saves them. After that the launcher offers
**Start**, **Configure** and **Exit**.

To skip the prompts and run with the saved configuration:

```sh
bun run dev --no-launcher
```

### Trying the interface without an account

The TUI can run against a mock core, which is handy for working on the UI:

```sh
bun run cli/demo.ts                 # summarize on demand
bun run cli/demo.ts --summarize     # summarize each message as it is opened
bun run cli/demo.ts --mark-as-read  # mark messages read when opened
```

Next: [subscribe your newsletters](#subscribing-your-newsletters) to the address
Sift gave you, otherwise the inbox stays empty.

## Subscribing your newsletters

Sift only sees mail addressed to its own inbox, so this is the step that makes
it work: point your newsletters at the address Sift gave you, not at your
personal one.

**1. Find your address.** It is the `email` value in `config/defaults.json`:

```json
{
  "email": "you@agentmail.to"
}
```

The terminal interface also shows it in the bottom right corner, next to the
message counts (it is left out when the window is too narrow). If you never chose
an address, Sift created one on the first run and saved it there for you.

**2. Sign up with it.** Every newsletter you subscribe to from now on should be
signed up with this address.

**3. Move the ones you already get.** Most senders have a subscription
preferences or account page where the address can be changed. For the ones that
do not, forward an issue to your Sift address instead: Sift reads whatever
arrives, so it shows up and can be summarized like any other message. The
summary will include the forwarding header, since that is part of the message.

New mail appears on the next refresh (`r`).

## Configuration

Settings live in `config/defaults.json`, written by the launcher.
`config/completions.json` is the single source of truth for what exists: the
launcher prompts for those keys, the CLI generates its flags from them, and a
config file that is missing any of them is rejected with an error naming what is
absent. A key that is `null` or blank counts as unset.

Every setting can be overridden for a single run:

```sh
bun run dev --no-launcher --email me@agentmail.to --llm-provider anthropic --llm-name claude-sonnet-4-5
```

| Setting          | Flag                     | Description                                                            |
| ---------------- | ------------------------ | ---------------------------------------------------------------------- |
| `tui`            | `--tui` / `--no-tui`     | Run the terminal interface.                                            |
| `webui`          | `--webui` / `--no-webui` | Run the web interface in your browser.                                 |
| `email`          | `--email`                | The inbox address to use. Unset means create one.                      |
| `create_email`   | `--create-email`         | Create the inbox when the address does not exist yet.                  |
| `mark_as_read`   | `--mark-as-read`         | Remove the `unread` label when a message is opened.                    |
| `summarize`      | `--summarize`            | Summarize a message when it is opened.                                 |
| `llm_provider`   | `--llm-provider`         | `anthropic`, `google`, `openai` or `openrouter`.                       |
| `llm_name`       | `--llm-name`             | Model name passed to the provider.                                     |
| `process_images` | `--process-images`       | Let the agent describe images with a vision model.                     |
| `vlm_provider`   | `--vlm-provider`         | Provider for image descriptions. Required when `process_images` is on. |
| `vlm_name`       | `--vlm-name`             | Model for image descriptions. Required when `process_images` is on.    |

### Environment variables

| Variable                                                                      | Purpose                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `AGENTMAIL_API_KEY`                                                           | **Required.** Authenticates the AgentMail SDK.          |
| `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | The key for whichever provider you configured.          |
| `LOG_LEVEL`                                                                   | `trace` … `fatal`, or `silent` (the default).           |
| `PRETTY_LOG`                                                                  | `true` prints human-readable log lines instead of JSON. |

Logs go to `./logs/<timestamp>.log`, and the path is printed on startup unless
logging is silent. The default level is `silent`, so Sift writes nothing unless
you ask it to with `LOG_LEVEL`; this keeps the terminal interface clean.

## Using the interface

### Terminal

The terminal interface is the one Sift starts by default (`tui: true`).

| Key                       | List                                       | Message                                     |
| ------------------------- | ------------------------------------------ | ------------------------------------------- |
| `j` / `k` (`↓` / `↑`)     | move the cursor                            | scroll                                      |
| `enter`                   | open the highlighted message               | –                                           |
| `l` (`→`) / `tab`         | open and focus the message                 | –                                           |
| `h` (`←`) / `esc` / `tab` | –                                          | back to the list (cancels a pending delete) |
| `u`                       | toggle All / Unread                        | toggle All / Unread                         |
| `r`                       | reload from AgentMail                      | reload from AgentMail                       |
| `m`                       | flip the highlighted message read / unread | flip the open message read / unread         |
| `s`                       | –                                          | switch between the summary and the text     |
| `d`                       | –                                          | delete the open message (asks first)        |
| `y` / `n`                 | –                                          | confirm / cancel the delete                 |
| `g` / `G`                 | first / last message                       | top / bottom                                |
| `ctrl+d` / `ctrl+u`       | page down / up                             | page down / up                              |
| `q` / `ctrl+c`            | quit                                       | quit                                        |

**Mouse:** click a row to open it, click a pane to focus it, scroll with the
wheel, and use the **All / Unread** control, the **Summarize**, **Mark as
read / Mark as unread** and **Delete** buttons.

**Layout.** Above 80 columns the panes sit side by side; below that only one is
shown at a time and `enter` / `h` move between them. Resizing switches live.

### Web

Turn it on with `webui: true` (or `--webui`), and Sift starts the web app
alongside the engine and opens it in your browser:

```sh
bun run dev --no-launcher --webui
```

The same inbox, summaries and actions, in a browser window instead of a terminal.
It is served by Vite on `http://localhost:5173` by default, and picks up changes
as you edit.

## How it works

```
AgentMail inbox
      │  list messages, fetch each one
      ▼
core/mail.ts ──► core/process.ts ──► core/agent ──► core/index.ts ──► cli/  web/
  AgentMail         HTML → Markdown      LangChain      SiftCore       terminal  browser
  SDK wrapper       links masked         agent          the API        OpenTUI   React
```

1. **Fetch.** `SiftCore.getMessagesStream()` walks the inbox a page at a time and
   yields each message as it arrives, which is what lets the list fill in
   progressively.
2. **Process.** `processNewsletter()` removes tracking pixels, scripts and
   presentational markup, converts the result to Markdown, and replaces every
   link and image URL with a `LINK_<n>` placeholder. The real URLs stay in a
   lookup table on our side.
3. **Summarize.** A LangChain agent receives the processed Markdown. Because it
   only ever sees placeholders, it cannot hallucinate a URL: when it needs the
   content behind a link it calls a tool, and image links can be described by a
   vision model when `process_images` is on. Output streams back chunk by chunk.
4. **Present.** `SiftCore` exposes the whole surface — listing, summaries, labels,
   deletion — and both interfaces are consumers of it.

Two deliberate choices keep startup and the first summary fast:

- **The agent stack is loaded lazily.** Importing `langchain` and the provider
  SDKs costs roughly 600ms, so it happens on first use rather than at startup
  (`SiftCore.warmup()` can preload it in the background). Only the configured
  provider is ever imported.
- **Nothing is fetched twice.** A summary is kept per message for the session, so
  a finished summary is never requested again.

## Project layout

```
sift/
├── core/                 # the engine, no UI
│   ├── index.ts          # SiftCore: the API the interfaces consume
│   ├── mail.ts           # AgentMail wrapper: inboxes, messages, labels
│   ├── process.ts        # newsletter HTML → Markdown with masked links
│   ├── logger.ts         # pino, writing to ./logs
│   └── agent/            # LangChain agents
│       ├── summarizeNewsletter/   # the summarizer, its prompt and tools
│       ├── describeImage/         # vision model for image links
│       ├── model.ts               # provider selection (imported lazily)
│       └── BaseAgent.ts           # shared streaming plumbing
├── cli/                  # terminal interface (OpenTUI)
│   ├── index.ts          # startTui(core) / mountTui(renderer, core)
│   ├── app.ts            # controller: input, core calls, rendering
│   ├── state.ts          # pure reducer and store
│   ├── components/       # panes, list, preview, buttons, status bar
│   └── lib/              # pure helpers: formatting, text fitting, mapping
├── config/               # settings, flags and validation
├── web/                  # web interface (Vite + React)
├── launcher.ts           # interactive configuration
└── index.ts              # entry point
```

Neither interface talks to AgentMail or the model directly. Both consume
`SiftCore`, which keeps the engine testable and the interfaces interchangeable.

## Development

```sh
bun run test        # unit tests (vitest)
bun run test:tui    # end-to-end tests for the terminal UI (bun test)
bun run test:watch  # unit tests in watch mode
bun run lint        # oxlint
bun run format      # prettier
```

The unit tests cover the reducer, keymap, configuration validation, the
newsletter processing pipeline and the message mapping. The end-to-end suite
drives the real terminal UI on OpenTUI's headless renderer — keys, clicks,
resizes, streaming and failures — and asserts on the rendered screen and on what
the core was asked to do.

`bun run test:tui` uses Bun's test runner because OpenTUI's native renderer only
loads under Bun; `vitest.config.ts` excludes those files so `bun run test` stays
green.

## License

[MIT](LICENSE) © Rijul Paul
