# wwwslin

Site for [slin.ai](https://slin.ai): a playful homepage where 虾米, a shape-shifting blob, lives above a chat box. You can drag it, throw it, poke it, dress it up, or talk to it once you've cracked its poem (the passphrase is a line's MD5).

A Cloudflare Worker (`wwwslin`) serves `public/` as static assets and answers `/api/chat` with Workers AI. The model and personality live in [`public/bot.config.json`](public/bot.config.json).

```bash
npm install
npx wrangler login   # once; Workers AI needs your account even in dev
cp .dev.vars.example .dev.vars   # set a local CHAT_TOKEN_SECRET
npm run dev          # http://localhost:8787

openssl rand -hex 32 | npx wrangler secret put CHAT_TOKEN_SECRET   # signs day-long chat tokens
npm run deploy
```
