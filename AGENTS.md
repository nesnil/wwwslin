# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Gemini CLI, etc.) working in this repository.

## What this is

The personal site for [slin.ai](https://slin.ai): one static page made of `index.html`, `styles.css` and `main.js`. There is no build step, no package manager, no tests and no linter. The files are served exactly as committed.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Any static file server works.

## Deployment

The site is served by the Cloudflare Worker `wwwslin` (see README). The Worker and wrangler config are **not** in this repo. Deploys happen outside it, so pushing to `main` does not by itself prove the site has changed. To check what is live, diff it against the repo:

```bash
for f in index.html main.js styles.css; do curl -s https://slin.ai/$f | diff -q - $f; done
```

Responses carry `cache-control: max-age=600`, so a fresh deploy can take up to 10 minutes to appear.

## How the pieces fit together

- **Background field** (`main.js`): an IIFE draws a 14×10 grid of jittered points on the fixed `#field` canvas. The grid waves over time and bends away from the pointer. The loop pauses on `visibilitychange`. Under `prefers-reduced-motion` it calls `drawStatic()` once and never starts the animation loop.
- **Reduced motion is handled in two places.** The JS switches to the static drawing, and the CSS `@media (prefers-reduced-motion)` block turns off `.reveal` animations and dims `#field`. Keep the two in sync.
- **Colors are duplicated between CSS and JS.** `--accent: #9db4a0` and `--fg: #e8e6e1` in `:root` also appear as hard-coded RGB in `main.js` (`ACCENT` and `rgba(232,230,225,…)`), in `::selection`, and as `--bg` in `<meta name="theme-color">`. A palette change has to touch all of them.
- **Entrance stagger is hand-numbered.** `.reveal` items get their `animation-delay` from per-`nth-child` rules in `styles.css`, written out for items 1–8 of `.index__list`. Adding a ninth item needs a new rule, or it will animate with no delay.
- **Fonts** (IBM Plex Mono, Instrument Serif) load from Google Fonts in `index.html` and are used through `--mono` and `--serif`.

## Known placeholders

All eight entries under "Selected" in `index.html` link to `https://github.com/nesnil` rather than to individual projects.
