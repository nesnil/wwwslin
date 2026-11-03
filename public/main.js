import { Bot, SHAPE_NAMES, MOODS, shapePath } from "./bot.js";

const root = document.documentElement;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

// localStorage can be missing or throw (private mode, blocked storage).
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  drop(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* —— theme —— */

const themeBtn = document.querySelector(".theme");
const currentTheme = () => root.dataset.theme || (darkQuery.matches ? "dark" : "light");
const syncTheme = () => themeBtn.setAttribute("aria-pressed", String(currentTheme() === "dark"));
syncTheme();
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
  syncTheme();
});
darkQuery.addEventListener("change", syncTheme);

/* —— config —— */

const DEFAULTS = {
  name: "虾米",
  appearance: { color: "ember", shape: "circle" },
  greetings: ["嗨，我是{name}！"],
  offlineReplies: ["我的脑子现在没插电，不过还能蹦！"],
};

const config = await fetch("bot.config.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((c) => ({ ...DEFAULTS, ...c }));

const pick = (list) => list[(Math.random() * list.length) | 0];
const fill = (line) => line.replaceAll("{name}", look.name);

/* —— stage —— */

const svg = document.querySelector(".stage");
const bubble = document.querySelector(".bubble");
const chat = document.querySelector(".chat");
const input = chat.querySelector("input");
const sendBtn = chat.querySelector("button");
const statusDot = chat.querySelector(".chat__status");

const bot = new Bot(svg, { size: botSize(), reduceMotion });

/* —— look: name, color, shape (per visitor, saved in localStorage) —— */

const EYES = { light: "oklch(0.99 0.004 85)", dark: "oklch(0.2 0.012 60)" };
const COLORS = {
  ember: { label: "橘", body: "oklch(0.67 0.2 38)", eye: "light" },
  red: { label: "红", body: "oklch(0.6 0.22 25)", eye: "light" },
  pink: { label: "粉", body: "oklch(0.8 0.12 0)", eye: "dark" },
  violet: { label: "紫", body: "oklch(0.58 0.2 295)", eye: "light" },
  blue: { label: "蓝", body: "oklch(0.6 0.17 255)", eye: "light" },
  teal: { label: "青", body: "oklch(0.75 0.12 195)", eye: "dark" },
  green: { label: "绿", body: "oklch(0.74 0.17 145)", eye: "dark" },
  yellow: { label: "黄", body: "oklch(0.87 0.16 95)", eye: "dark" },
  ink: { label: "墨", body: "oklch(0.3 0.012 60)", eye: "light" },
};
const SHAPE_ZH = {
  circle: "圆球", squircle: "圆角方块", square: "方块", blob: "一团", flower: "小花",
  star: "星星", drop: "水滴", egg: "鸡蛋", heart: "爱心", cloud: "云朵",
};

const defaultLook = () => ({ name: config.name, ...DEFAULTS.appearance, ...config.appearance });
let look = { ...defaultLook(), ...store.get("look") };

function applyLook() {
  if (!COLORS[look.color]) look.color = defaultLook().color;
  if (!SHAPE_NAMES.includes(look.shape)) look.shape = defaultLook().shape;
  look.name = String(look.name || "").trim().slice(0, 12) || config.name;
  const c = COLORS[look.color];
  root.style.setProperty("--bot", c.body);
  root.style.setProperty("--bot-eye", EYES[c.eye]);
  bot.setShape(look.shape);
  input.placeholder = `和 ${look.name} 说点什么…`;
  chat.querySelector("label").textContent = `和 ${look.name} 说点什么`;
}

applyLook();

const dress = document.getElementById("dress");
const dressBtn = document.querySelector(".dress-btn");
const nameInput = dress.querySelector(".dress__name");
const colorBox = dress.querySelector(".dress__colors");
const shapeBox = dress.querySelector(".dress__shapes");

for (const [key, c] of Object.entries(COLORS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.dataset.color = key;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", c.label);
  b.style.setProperty("--c", c.body);
  colorBox.append(b);
}

for (const key of SHAPE_NAMES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "shape-opt";
  b.dataset.shape = key;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", SHAPE_ZH[key]);
  b.title = SHAPE_ZH[key];
  b.innerHTML = `<svg viewBox="-14 -14 28 28" aria-hidden="true"><path d="${shapePath(key, 0, 0, 10)}"/></svg>`;
  shapeBox.append(b);
}

function syncDress() {
  nameInput.value = look.name;
  colorBox.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.color === look.color)));
  shapeBox.querySelectorAll(".shape-opt").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.shape === look.shape)));
}

function saveLook() {
  applyLook();
  syncDress();
  store.set("look", look);
}

function openDress(open) {
  dress.hidden = !open;
  dressBtn.setAttribute("aria-expanded", String(open));
  if (open) syncDress();
}

dressBtn.addEventListener("click", () => openDress(dress.hidden));
colorBox.addEventListener("click", (e) => {
  const b = e.target.closest(".swatch");
  if (!b) return;
  look.color = b.dataset.color;
  saveLook();
  bot.setMood("happy", 900);
  bot.jump(0.5);
});
shapeBox.addEventListener("click", (e) => {
  const b = e.target.closest(".shape-opt");
  if (!b) return;
  look.shape = b.dataset.shape;
  saveLook();
  bot.setMood("happy", 900);
  bot.jump(0.5);
});
nameInput.addEventListener("change", () => {
  look.name = nameInput.value;
  saveLook();
  say(`我现在叫${look.name}了！`, { hold: false });
});
dress.querySelector(".dress__reset").addEventListener("click", () => {
  look = defaultLook();
  store.drop("look");
  applyLook();
  syncDress();
});
document.addEventListener("pointerdown", (e) => {
  if (!dress.hidden && !dress.contains(e.target) && !dressBtn.contains(e.target)) openDress(false);
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dress.hidden) { openDress(false); dressBtn.focus(); }
});

function botSize() {
  return Math.round(Math.max(40, Math.min(64, innerWidth * 0.06)));
}

// The water the bot may float in: below the header, above the chat box.
function layout() {
  svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
  bot.R = botSize();
  bot.setBounds(8, document.querySelector(".top").getBoundingClientRect().bottom, innerWidth - 8, chat.getBoundingClientRect().top - 8);
  if (bot.target) bot.swimTo(bot.target.x, bot.target.y);
}

layout();
addEventListener("resize", layout);

// A spot in the lower middle of the water, where it likes to hang out.
function home() {
  return { x: innerWidth / 2, y: bot.minY + (bot.maxY - bot.minY) * 0.7 };
}

// Enter: sink in from above the page (or just be there, for reduced motion).
{
  const h = home();
  bot.x = h.x;
  if (reduceMotion) bot.y = h.y;
  else { bot.y = -bot.R * 2; bot.vy = 240; bot.swimTo(h.x, h.y); }
}

/* —— speech bubble —— */

const bubbleText = bubble.querySelector(".bubble__text");
const copyBtn = bubble.querySelector(".bubble__copy");
let bubbleTimer = 0;
let bubbleHovered = false;

function say(text, { hold = true, thinking = false } = {}) {
  clearTimeout(bubbleTimer);
  bubble.hidden = false;
  bubbleText.textContent = text;
  bubble.classList.toggle("is-thinking", thinking);
  copyBtn.classList.remove("is-done");
  if (!hold) hideBubbleSoon(text.length);
}

function hideBubbleSoon(chars) {
  clearTimeout(bubbleTimer);
  if (bubbleHovered) return; // pointerleave restarts it
  bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 4000 + chars * 70);
}

// While the pointer is on the bubble it stays open and the bot holds still,
// so the text can be selected or copied.
bubble.addEventListener("pointerenter", () => {
  bubbleHovered = true;
  bot.hold = true;
  clearTimeout(bubbleTimer);
});
bubble.addEventListener("pointerleave", () => {
  bubbleHovered = false;
  bot.hold = false;
  if (!busy) hideBubbleSoon(bubbleText.textContent.length);
});

copyBtn.addEventListener("click", async () => {
  const text = bubbleText.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // older browsers / insecure contexts: copy via a selection
    const range = document.createRange();
    range.selectNodeContents(bubbleText);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
  }
  copyBtn.classList.add("is-done");
  copyBtn.setAttribute("aria-label", "已复制");
  setTimeout(() => { copyBtn.classList.remove("is-done"); copyBtn.setAttribute("aria-label", "复制"); }, 1400);
});

function placeBubble() {
  if (bubble.hidden) return;
  const head = bot.head();
  const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const x = Math.max(12, Math.min(innerWidth - w - 12, head.x - w / 2));
  let y = head.y - h - 16;
  if (y < 12) y = head.y + bot.R * 2.2 + 12; // no room above: hang below
  y = Math.min(y, innerHeight - h - 12);
  bubble.style.transform = `translate(${x}px, ${y}px)`;
}

/* —— brain: idle behaviours —— */

let lastInteract = performance.now() / 1000;
let nextAct = lastInteract + 5;
let busy = false; // in a conversation turn

function interacted() {
  lastInteract = performance.now() / 1000;
  if (bot.baseMood === "sleepy") {
    bot.setMood("idle", Infinity);
    bot.setMood("surprised", 700);
    bot.jump(0.6);
  }
}

const IDLE_MOODS = ["curious", "happy", "surprised", "love", "shy", "curious", "happy"];

function think(now) {
  if (bot.dragging || busy || reduceMotion) return;
  if (now - lastInteract > 25 && bot.baseMood !== "sleepy") {
    bot.target = null;
    bot.setMood("sleepy", Infinity);
  }
  if (bot.baseMood === "sleepy" || now < nextAct) return;
  nextAct = now + 3.5 + Math.random() * 5;

  // Drift around the water and pull faces; darts and spins are rare.
  const r = Math.random();
  if (r < 0.5) {
    const span = Math.min(innerWidth * 0.5, 460);
    bot.swimTo(bot.x + (Math.random() - 0.5) * span, bot.y + (Math.random() - 0.5) * span * 0.6);
  } else if (r < 0.62) {
    const h = home();
    bot.swimTo(h.x + (Math.random() - 0.5) * 200, h.y + (Math.random() - 0.5) * 80);
  } else if (r < 0.9) {
    bot.setMood(pick(IDLE_MOODS), 1600 + Math.random() * 1600);
  } else if (r < 0.96) {
    bot.jump(0.4);
  } else {
    bot.doSpin();
  }
}

/* —— pointer: look, poke, drag, throw —— */

let press = null;

addEventListener("pointermove", (e) => {
  bot.lookAt(e.clientX, e.clientY);
  if (press) {
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (!bot.dragging && moved > 6) {
      bot.grab(e.clientX, e.clientY);
      document.body.classList.add("is-dragging");
    }
    if (bot.dragging) bot.dragTo(e.clientX, e.clientY);
  }
  if (e.pointerType === "mouse") interacted();
}, { passive: true });

document.addEventListener("pointerleave", () => bot.lookAt(null));

svg.addEventListener("pointerdown", (e) => {
  if (!bot.hit(e.clientX, e.clientY)) return;
  e.preventDefault();
  press = { x: e.clientX, y: e.clientY, t: performance.now() };
  interacted();
});

addEventListener("pointerup", () => {
  if (!press) return;
  if (bot.dragging) {
    bot.release();
    document.body.classList.remove("is-dragging");
  } else {
    poke();
  }
  press = null;
});

const POKES = [
  () => { bot.jump(0.7); bot.setMood("happy", 1200); },
  () => { bot.doSpin(); bot.setMood("happy", 1000); },
  () => { bot.setMood("surprised", 900); bot.jump(0.4); },
  () => { bot.setMood("love", 1600); },
  () => { bot.setMood("shy", 1500); },
  () => { bot.setMood("curious", 1400); },
];
const GIGGLES = ["嘿嘿", "咚！", "好痒", "再来！", "喂！", "呜呼～"];

function poke() {
  if (reduceMotion) { bot.setMood(pick(["happy", "love", "surprised"]), 1200); return; }
  pick(POKES)();
  if (!busy && Math.random() < 0.35) say(pick(GIGGLES), { hold: false });
}

addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    e.preventDefault();
    input.focus();
  }
});

/* —— chat —— */

const history = [];
// shape:… is still matched so a stray tag is hidden, but the shape is the visitor's choice.
const TAG = /\[(jump|spin|sleep|shape:[a-z]+|mood:[a-z]+)\]/gi;

function act(tag) {
  const [kind, arg] = tag.toLowerCase().split(":");
  if (kind === "jump") bot.jump(0.8);
  else if (kind === "spin") bot.doSpin();
  else if (kind === "sleep") bot.setMood("sleepy", 2500);
  else if (kind === "mood" && MOODS.includes(arg)) bot.setMood(arg, 2600);
}

// Strip action tags (and a half-received one at the end) from streamed text.
function visible(raw) {
  return raw.replace(TAG, "").replace(/\[[^\]\s]{0,20}$/, "").replace(/\s{2,}/g, " ").trim();
}

// Chat is locked until the visitor says the passphrase; the Worker then hands
// out a token (X-Chat-Token) that unlocks the model for a few days.
let online = false;
let token = store.get("chat-token");
let locked = true;

function authHeaders() {
  return token ? { "x-chat-token": token } : {};
}

function setLocked(value) {
  locked = value;
  if (locked && token) { token = null; store.drop("chat-token"); }
  statusDot.classList.toggle("is-online", online && !locked);
  statusDot.classList.toggle("is-locked", online && locked);
}

async function checkStatus() {
  try {
    const r = await fetch("/api/chat", { headers: { accept: "application/json", ...authHeaders() } });
    const s = r.ok ? await r.json() : null;
    online = !!s;
    setLocked(!s || s.locked);
  } catch (e) {
    online = false;
    setLocked(true);
  }
}

chat.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  busy = true;
  sendBtn.disabled = true;
  interacted();
  history.push({ role: "user", content: text });

  // drift up close to the chat box to listen
  bot.swimTo(innerWidth / 2 + (Math.random() - 0.5) * 160, bot.maxY - bot.R * 2.2);
  bot.setMood("thinking", 30000);
  say("", { thinking: true });

  let reply = "";
  try {
    reply = online ? await streamReply() : await offlineReply(text);
  } catch (err) {
    online = false;
    setLocked(locked);
    reply = await offlineReply(text);
  }

  bot.talking = false;
  if (bot.mood === "thinking") bot.setMood("idle", Infinity);
  // Locked turns (fixed lines, the passphrase itself) never reach the model's history.
  if (locked || reply === UNLOCKED) history.length = 0;
  else history.push({ role: "assistant", content: reply || "…" });
  hideBubbleSoon((reply === UNLOCKED ? lastShown : reply).length);
  busy = false;
  sendBtn.disabled = false;
});

const UNLOCKED = Symbol("unlocked");
let lastShown = "";

async function streamReply() {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messages: locked ? history.slice(-1) : history.slice(-12), name: look.name }),
  });
  // 429 carries an in-character line; anything else unexpected means offline
  if ((!res.ok && res.status !== 429) || !res.body) throw new Error(`chat ${res.status}`);

  const newToken = res.headers.get("x-chat-token");
  if (newToken) {
    token = newToken;
    store.set("chat-token", token);
    setLocked(false);
  } else if (res.headers.get("x-chat-locked")) {
    setLocked(true);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = "";
  let applied = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += value;
    const tags = [...raw.matchAll(TAG)];
    for (; applied < tags.length; applied++) act(tags[applied][1]);
    const text = visible(raw);
    if (text) {
      if (bot.mood === "thinking") bot.setMood("idle", Infinity);
      bot.talking = true;
      say(text);
    }
  }
  lastShown = visible(raw);
  return newToken ? UNLOCKED : lastShown;
}

async function offlineReply(text) {
  const t = text.toLowerCase();
  let reply;
  if (/jump|hop|跳/.test(t)) { bot.jump(0.8); reply = "嘿咻！"; }
  else if (/spin|turn|转/.test(t)) { bot.doSpin(); reply = "转圈圈～"; }
  else if (/sleep|tired|睡|困/.test(t)) { bot.setMood("sleepy", 2500); reply = "呼……骗你的。"; }
  else if (/shape|morph|变/.test(t)) { bot.setMood("shy", 1500); reply = "我就喜欢现在这个样子。"; }
  else reply = fill(pick(config.offlineReplies));

  // type it out so it feels the same as a streamed reply
  bot.setMood("idle", Infinity);
  bot.talking = true;
  for (let i = 1; i <= reply.length; i++) {
    say(reply.slice(0, i));
    await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 28));
  }
  return reply;
}

/* —— ocean: ASCII sharks and fish swimming behind everything —— */

// Loaded separately so a failure here never takes the bot down with it.
import("./vendor/ascii-sharks.js")
  .then(({ OceanEngine }) => new OceanEngine(document.querySelector(".ocean")))
  .catch((err) => console.warn("ocean unavailable", err));

/* —— loop —— */

let last = performance.now();
let greeted = false;
function frame(nowMs) {
  const dt = (nowMs - last) / 1000;
  last = nowMs;
  think(nowMs / 1000);
  bot.update(dt);
  // say hello once the bot has sunk into view and slowed down
  if (!greeted && bot.settled && (!bot.target || nowMs > 6000)) {
    greeted = true;
    setTimeout(() => { if (!busy) say(fill(pick(config.greetings)), { hold: false }); }, 350);
  }
  placeBubble();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

checkStatus();

// for the curious: play with the bot from the console
window.bot = bot;
console.log(
  `%c${look.name}%c 就在 window.bot 上。试试 bot.setShape("heart")、bot.setMood("love")、bot.doSpin()。`,
  "color:#f0643c;font-weight:700", ""
);
