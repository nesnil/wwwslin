// slin.ai Worker: serves public/ as static assets and answers /api/chat for the bot.
// The model and personality live in public/bot.config.json. Workers AI goes
// through the AI binding; other providers read a Worker secret
// (ANTHROPIC_API_KEY, or whatever apiKeyEnv names).
//
// Chat is locked behind a puzzle. Until unlocked, every reply is a random line
// of poetry from config.poems and no model is called. The passphrase is the
// MD5 of a line; saying it returns a token in X-Chat-Token, signed with the
// CHAT_TOKEN_SECRET secret and valid until the next midnight in Beijing.
// Requests carrying a valid token reach the model.

import Anthropic from "@anthropic-ai/sdk";
import config from "../public/bot.config.json";

const MAX_TURNS = 12;
const MAX_CHARS = 400;
const MAX_NAME = 12;
const TZ_OFFSET = 8 * 3600e3; // tokens expire at midnight Asia/Shanghai (UTC+8)

// Models that accept server-side refusal fallbacks (fallbacks: "default").
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// The page parses these tags out of the reply to move the bot's body.
const ACTIONS = `
你有一个身体：漂在访客屏幕上那片海里的一团软软的小家伙。在回复里写标签就能让身体动起来，标签不会显示给访客。
- 动作：[jump]（往上一窜）[spin]（转个圈）[sleep]
- 表情：[mood:happy|surprised|sleepy|love|shy|curious|dizzy]
你的形状是访客选的，你自己变不了形；有人让你变形，就说可以点右上角的装扮按钮。
每条回复最多两个标签，合适时才用，一般放在开头。标签必须原样写英文，不要翻译，也不要解释标签。
Latency-sensitive; begin your visible answer immediately.`;

// Visitors can rename the bot; the personality refers to it as {name}.
function systemPrompt(name) {
  return `${config.personality.replaceAll("{name}", name)}\n${ACTIONS}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return env.ASSETS.fetch(request);

    const unlocked = await checkToken(env, request.headers.get("X-Chat-Token"));
    if (request.method === "GET") return status(env, unlocked);
    if (request.method !== "POST") return text("Method not allowed", 405);

    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).host !== url.host) return text("Forbidden", 403);

    if (env.CHAT_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const { success } = await env.CHAT_LIMITER.limit({ key: ip });
      if (!success) return text("[mood:dizzy] 说得太快啦，歇一会儿再来。", 429);
    }

    let messages, name;
    try {
      const body = await request.json();
      messages = clean(body.messages);
      name = cleanName(body.name);
    } catch (e) {
      return text("Bad request", 400);
    }
    if (!messages) return text("Bad request", 400);

    // Locked: recite a line of poetry, or hand out a token if this is a line's MD5.
    if (!unlocked) {
      const said = messages[messages.length - 1].content;
      if (env.CHAT_TOKEN_SECRET && (await isPassphrase(said))) {
        return text(fill(config.unlockReply, name), 200, { "X-Chat-Token": await makeToken(env) });
      }
      return text(pickOne(config.poems), 200, { "X-Chat-Locked": "1" });
    }

    if (!ready(env)) return text("Chat is not configured.", 503);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const write = (s) => writer.write(enc.encode(s));

    const provider = PROVIDERS[config.model.provider] || streamAnthropic;
    ctx.waitUntil(
      provider(env, systemPrompt(name), messages, write)
        .catch((err) => {
          const msg = String((err && (err.message || err.status)) || err);
          console.error("chat failed", msg);
          if (/neuron|allocation|quota|4006/i.test(msg)) return write(" [mood:sleepy] 今天说了太多话，脑袋转不动了，明天再来找我玩吧。");
          if (err && err.status === 429) return write(" [mood:dizzy] 一下子太多人跟我说话啦，等一会儿再试试？");
          return write(" [mood:dizzy] 哎呀，脑袋短路了，再说一次？");
        })
        .finally(() => writer.close())
    );

    return new Response(readable, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  },
};

// Cloudflare Workers AI through the AI binding: no key, billed in Neurons.
async function streamWorkersAI(env, system, messages, write) {
  const m = config.model;
  const body = await env.AI.run(m.model, {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: m.maxTokens || 400,
    stream: true,
  });
  const out = dropThinking(write);
  // Older models stream {response}; OpenAI-style ones stream {choices[].delta}.
  await readSSE(body, (j) => out(j.response ?? j.choices?.[0]?.delta?.content));
}

async function streamAnthropic(env, system, messages, write) {
  const client = new Anthropic({ apiKey: apiKey(env) });
  const m = config.model;
  const params = {
    model: m.model,
    max_tokens: m.maxTokens || 4000,
    system,
    messages,
    ...(m.effort ? { output_config: { effort: m.effort } } : {}),
  };
  const stream = FALLBACK_MODELS.has(m.model)
    ? client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : client.messages.stream(params);

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      await write(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") await write(" [mood:shy] 嗯……这个我不太想聊。");
}

// Any OpenAI-compatible chat completions API (OpenAI, xAI, DeepSeek, …).
async function streamOpenAI(env, system, messages, write) {
  const m = config.model;
  const base = (m.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey(env)}` },
    body: JSON.stringify({
      model: m.model,
      max_tokens: m.maxTokens || 4000,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok || !res.body) throw Object.assign(new Error(`upstream ${res.status}`), { status: res.status });
  const out = dropThinking(write);
  await readSSE(res.body, (j) => out(j.choices?.[0]?.delta?.content));
}

const PROVIDERS = { "workers-ai": streamWorkersAI, anthropic: streamAnthropic, openai: streamOpenAI };

// Call onJSON for every `data:` line of a server-sent-events byte stream.
async function readSSE(stream, onJSON) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let j;
      try { j = JSON.parse(data); } catch (e) { continue; }
      await onJSON(j);
    }
  }
}

// Some open models think out loud in <think>…</think>; keep that off the page.
function dropThinking(write) {
  let thinking = false;
  let pending = "";
  return async (chunk) => {
    if (!chunk) return;
    let s = pending + chunk;
    pending = "";
    let out = "";
    while (s) {
      const tag = thinking ? "</think>" : "<think>";
      const i = s.indexOf(tag);
      if (i >= 0) {
        if (!thinking) out += s.slice(0, i);
        s = s.slice(i + tag.length);
        thinking = !thinking;
        continue;
      }
      // hold back a possible partial tag at the end
      const keep = s.lastIndexOf("<");
      if (keep >= 0 && tag.startsWith(s.slice(keep))) { pending = s.slice(keep); s = s.slice(0, keep); }
      if (!thinking) out += s;
      s = "";
    }
    if (out) await write(out);
  };
}

// Keep only well-formed, alternating user/assistant turns, newest last.
function clean(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const m of input.slice(-MAX_TURNS)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim().slice(0, MAX_CHARS);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += `\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

function cleanName(input) {
  const n = typeof input === "string" ? input.replace(/[\[\]{}<>\n\r]/g, "").trim().slice(0, MAX_NAME) : "";
  return n || config.name;
}

const fill = (line, name) => String(line || "").replaceAll("{name}", name);
const pickOne = (list) => (list && list.length ? list[(Math.random() * list.length) | 0] : "……");

/* —— passphrase and token —— */

// Punctuation and spaces don't count, so a line hashes the same however it is copied.
function normalise(s) {
  return String(s).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const md5 = async (s) => hex(await crypto.subtle.digest("MD5", new TextEncoder().encode(s)));

// MD5s of every poem line, both exactly as shown and without punctuation.
let passphrases;
async function isPassphrase(said) {
  const guess = said.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(guess)) return false;
  if (!passphrases) {
    const lines = config.poems || [];
    passphrases = new Set(await Promise.all(lines.flatMap((l) => [md5(l), md5(normalise(l))])));
  }
  return passphrases.has(guess);
}

async function sign(env, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.CHAT_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The next midnight in Beijing, as a UTC timestamp.
function nextMidnight(now = Date.now()) {
  const day = 86400e3;
  return Math.floor((now + TZ_OFFSET) / day) * day + day - TZ_OFFSET;
}

// <expiry ms>.<HMAC(secret, "chat:" + expiry)>; rotating the secret revokes every token.
async function makeToken(env) {
  const exp = nextMidnight();
  return `${exp}.${await sign(env, `chat:${exp}`)}`;
}

async function checkToken(env, token) {
  if (!token || !env.CHAT_TOKEN_SECRET) return false;
  const [exp, sig] = token.split(".");
  if (!sig || !(Number(exp) > Date.now())) return false;
  const good = new TextEncoder().encode(await sign(env, `chat:${exp}`));
  const given = new TextEncoder().encode(sig);
  return given.length === good.length && crypto.subtle.timingSafeEqual(given, good);
}

function ready(env) {
  return config.model.provider === "workers-ai" ? !!env.AI : !!apiKey(env);
}

function apiKey(env) {
  const name = config.model.apiKeyEnv || (config.model.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  return env[name];
}

function status(env, unlocked) {
  return Response.json(
    { online: ready(env), locked: !unlocked, model: unlocked ? config.model.model : undefined },
    { headers: { "cache-control": "no-store" } }
  );
}

function text(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
