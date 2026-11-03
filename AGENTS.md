# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Gemini CLI, etc.) working in this repository.

## What this is

The personal site for [slin.ai](https://slin.ai): a single playful page where a shape-shifting blob (default name **虾米**) lives above a chat box. Visitors can drag it, throw it, poke it, dress it up (name, color, shape), or talk to it. Behind it, ASCII sharks and fish schools swim across the whole page. The page is deliberately minimal: the sLin logo (set in Fraunces, a serif, through `--serif`), a dress-up button, a GitHub link, a theme toggle, the bot and the chat box, with no other copy. Visible text is in Simplified Chinese (`lang="zh-CN"`); keep it that way, and don't add explanatory copy. It is one Cloudflare Worker (`wwwslin`):

- `public/` holds the static site, served as Worker assets. It is plain HTML, CSS and ES modules with no build step and no framework.
- `worker/index.js` runs only for requests that don't match a file. It handles `/api/chat` and passes everything else to `env.ASSETS`.

## Commands

```bash
npm install
npm run dev        # wrangler dev on :8787, site + /api/chat
npm run deploy     # wrangler deploy (publishes to slin.ai, ask first)
npx wrangler deploy --dry-run --outdir /tmp/build   # check the Worker bundles
```

`.dev.vars` (gitignored, see `.dev.vars.example`) holds `CHAT_TOKEN_SECRET` for local dev. The default provider is Workers AI, which needs `npx wrangler login` once. `wrangler dev` then calls the real models, and that usage counts toward the account's daily free Neurons. For the Anthropic or OpenAI-compatible providers, also put the API key in `.dev.vars`. Without a binding or key, `/api/chat` reports `online: false`. If the endpoint is unreachable, the page falls back to offline replies. To look at the front end without the Worker, `python3 -m http.server 8765 -d public` works; chat then runs offline. That is the `site` config in `.claude/launch.json`.

There are no tests and no linter.

## Configuring the bot

`public/bot.config.json` is the single source of truth, read by both the page and the Worker:

- `name`, `appearance` (`color`, `shape`): defaults. Visitors can override them in the dress-up panel; their choices are saved in their own browser's `localStorage` under `look`.
- `greetings`, `offlineReplies`, `unlockReply`: fixed lines, in Chinese. `poems`: the lines recited while chat is locked; their MD5s are the passphrases. `{name}` is replaced with the bot's current name, and lines may contain action tags.
- `personality`: the system prompt, in Chinese, with `{name}` replaced with the visitor's chosen name. The file is public, so the prompt is visible to anyone.
- `model`: `{ provider, model, maxTokens, effort?, baseURL?, apiKeyEnv? }`.
  - `provider: "workers-ai"` (the default, with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) calls `env.AI.run()` through the `[ai]` binding in `wrangler.toml`. On 2026-11-02 Llama 3.3 was the fastest model tested (1–5 s) and used the action tags reliably. Gemma 4 and GLM-4.7 Flash were slow and sometimes returned empty replies within `maxTokens: 400`. Qwen3 was fast but sometimes misused the bracket syntax. It needs no key and is billed in Neurons: 10,000 free per day on both plans. On the Free plan, requests fail once that runs out; the Worker turns that failure into an in-character "too tired" line.
  - `provider: "anthropic"` uses `@anthropic-ai/sdk` with the `ANTHROPIC_API_KEY` secret. For `claude-fable-5-1`, `claude-opus-5-5`, `claude-opus-5` and `claude-sonnet-5-5`, the Worker also sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
  - `provider: "openai"` uses any OpenAI-compatible `/chat/completions` endpoint, such as xAI with `baseURL: "https://api.x.ai/v1"` and `apiKeyEnv: "XAI_API_KEY"`.

Set secrets with `npx wrangler secret put ANTHROPIC_API_KEY`, or whichever name `apiKeyEnv` gives.

Streams from Workers AI and the OpenAI-compatible provider go through `readSSE()` and `dropThinking()`, which strips `<think>…</think>` reasoning that some open models emit.

## How the pieces fit together

- **Bot engine** (`public/bot.js`, framework-free):
  - The body is one SVG path built from 72 radii around a centre. Each shape in `SHAPES` is precomputed to equal area: some come from polar formulas, and some (heart, cloud) from bisecting an `inside()` test along rays.
  - Morphing eases the current radii toward the target each frame, so any shape blends into any other.
  - Eyes, mouth and blush are separate paths drawn per mood (`MOODS`).
  - The bot floats; there is no gravity or floor. `(x, y)` is its centre. `swimTo()` steers it toward a target with light drag. Without a target, heavier water drag and a faint current take over. `center()` adds a slow bob, `tilt` leans it into its motion, and the walls are soft (a hard throw makes it dizzy). `jump()` is an upward dart and `doSpin()` a twirl.
  - The bot never changes shape by itself: `setShape()` is only called with the visitor's choice. Life comes from moods, drifting, tilting and the breathing pulse of the squash spring.
- **Scene** (`public/main.js`):
  - Sets up the layout. The water (`bot.setBounds`) runs from under the header to just above the chat box and is recomputed on resize. The bot sinks in from above on load and greets once it arrives.
  - Runs the idle "brain": every 3.5–8.5 s it drifts somewhere nearby or back toward `home()` (lower middle), or shows a passing mood. Darts and spins are rare, by request. It falls asleep after 25 s without interaction.
  - The dress-up panel (`#dress`) sets `--bot` and `--bot-eye` on `:root` from `COLORS`, sets the home shape, and changes the name used in the placeholder, fixed lines and system prompt.
  - Handles pointer poke vs drag (6 px threshold), the speech bubble that follows `bot.head()`, and chat.
  - The bubble is selectable and has a copy button (Clipboard API, with an `execCommand` fallback). While the pointer is over it, it stays open and `bot.hold` keeps the bot still.
  - `window.bot` is exposed on purpose, as a console toy.
- **Action tags are a contract between the Worker and the page.**
  - `ACTIONS` in `worker/index.js` (written in Chinese) teaches the model `[jump]`, `[spin]`, `[sleep]` and `[mood:…]`, and tells it that it can't change shape. The tag names themselves stay in English.
  - `TAG`, `act()` and `visible()` in `main.js` apply those tags while the reply streams and strip them from the text. A stray `[shape:…]` is stripped but ignored.
  - Mood names must match `MOODS` in `bot.js`. Change both together.
- **Poem gate (cost protection):**
  - Until unlocked, every POST gets a random line from `poems` with `X-Chat-Locked: 1`, and no model is called.
  - The passphrase is the MD5 (32 hex characters, any case) of any line in `poems`, either exactly as shown or with spaces and punctuation removed. `isPassphrase()` precomputes the set once per isolate with `crypto.subtle.digest("MD5")`, which Workers supports.
  - A match returns `unlockReply` plus `X-Chat-Token: <expiry>.<HMAC-SHA256(CHAT_TOKEN_SECRET, "chat:"+expiry)>`. The expiry is the next midnight in Asia/Shanghai, so a browser has to unlock again each day.
  - The page stores the token in `localStorage` (`chat-token`), sends it back as `X-Chat-Token`, and drops it as soon as the server says it's locked again.
  - Rotating `CHAT_TOKEN_SECRET` (`npx wrangler secret put CHAT_TOKEN_SECRET`) revokes every token. If the secret is unset, chat stays locked for everyone.
  - This is a playful puzzle, not a secret: the poems are public. Real cost protection comes from `CHAT_LIMITER` and the Workers AI daily allocation.
  - The page clears its history on locked turns and on unlock, so poems and hashes never reach the model.
- **Chat protocol:**
  - `GET /api/chat` returns `{online, locked, model?}`, where `model` is shown only when unlocked.
  - `POST /api/chat {messages, name}` streams plain UTF-8 text.
  - The Worker drops malformed turns, caps history at 12 turns and 400 characters per message, sanitises `name` (12 characters, no brackets or newlines), and rejects cross-origin posts.
  - `CHAT_LIMITER` (in `wrangler.toml`) allows 20 POSTs per IP per 60 s, locked replies included.
  - Upstream errors come back as an in-character line with a `[mood:dizzy]` tag, so the page never shows a raw error.
- **Offline mode:** if the status check or a chat request fails, `offlineReply()` answers locally in Chinese. It understands jump, spin and sleep keywords in English and Chinese, and declines shape changes.
- **Ocean background** (`public/vendor/ascii-sharks.js`):
  - This is [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks) (MIT), bundled unmodified into one ES module. The license and source commit are in the file's header comment; keep them.
  - `main.js` loads it with a dynamic `import()` onto `canvas.ocean`, so a failure there never breaks the bot.
  - Its `OceanEngine` owns the canvas: resizing, pausing off-screen, and reduced motion. It listens to window pointer events, so fish react to the cursor, and any click (the bot included) makes a splash.
  - The renderer always paints a black sea. The `.ocean` CSS makes that fit both themes: in dark it uses `mix-blend-mode: screen`, so black becomes `--bg`; in light it uses `filter: invert(1) hue-rotate(180deg)` with `multiply` at a lower opacity.
  - Don't edit the vendored file. To update it, download the repo somewhere outside `public/`, then run `node_modules/.bin/esbuild <repo>/src/index.ts --bundle --format=esm --target=es2020 --legal-comments=none --banner:js="<license header>" --outfile=public/vendor/ascii-sharks.js`.
- **Theme:** OKLCH tokens on `:root`, with the dark set written twice: under `prefers-color-scheme` and under `[data-theme="dark"]`. Keep both copies identical. The bot's colors come from `--bot`, `--bot-eye` and `--blush`.
- **Reduced motion:** the bot appears in place, without bobbing, drifting, darting or spinning, and changes shape instantly when the visitor picks one.

## Deployment caution

`wrangler.toml` deploys to the existing `wwwslin` Worker. Its route or custom domain for slin.ai was set up in the Cloudflare dashboard and is not declared in `wrangler.toml`. Before the first `wrangler deploy` from this repo, check in the dashboard that the custom domain is still attached afterwards.
