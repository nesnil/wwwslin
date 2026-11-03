// The bot: a soft blob floating in the page's ocean. Its body is one filled
// path built from a radial profile (the visitor's chosen shape); eyes and
// mouth are separate paths drawn on top. Everything is recomputed per frame
// from a handful of springs, so any state blends into any other.

const SVG_NS = "http://www.w3.org/2000/svg";
const N = 72;
const TAU = Math.PI * 2;

/* —— shapes: each becomes N radii around the centre, normalised to equal area —— */

function radial(fn) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = fn((i / N) * TAU);
  return normalise(out);
}

// Cast a ray from the centre and bisect to the edge of an inside() test.
function implicit(inside) {
  return radial((a) => {
    const c = Math.cos(a), s = Math.sin(a);
    let lo = 0, hi = 3;
    for (let k = 0; k < 26; k++) {
      const m = (lo + hi) / 2;
      if (inside(c * m, s * m)) lo = m; else hi = m;
    }
    return lo;
  });
}

function normalise(r) {
  let sum = 0;
  for (const v of r) sum += v * v;
  const k = 1 / Math.sqrt(sum / r.length);
  for (let i = 0; i < r.length; i++) r[i] *= k;
  return r;
}

const superellipse = (n) => (a) =>
  Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), -1 / n);

// Angles are in screen space: +y points down, so a = -π/2 is the top.
export const SHAPES = {
  circle: radial(() => 1),
  squircle: radial(superellipse(4)),
  square: radial(superellipse(9)),
  blob: radial((a) => 1 + 0.09 * Math.sin(3 * a + 0.6) + 0.05 * Math.sin(5 * a - 1.2)),
  flower: radial((a) => 1 + 0.13 * Math.cos(6 * a)),
  star: radial((a) => 0.72 + 0.42 * Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 3)),
  drop: radial((a) => 0.86 + 0.5 * Math.pow(Math.max(0, -Math.sin(a)), 5)),
  egg: radial((a) => 1 + 0.12 * Math.sin(a)),
  heart: implicit((x, y) => {
    const X = x * 1.05, Y = -y * 1.05 + 0.15;
    const q = X * X + Y * Y - 1;
    return q * q * q - X * X * Y * Y * Y <= 0;
  }),
  cloud: implicit((x, y) =>
    [[0, 0.12, 0.62], [-0.58, 0.3, 0.46], [0.58, 0.3, 0.46], [-0.26, -0.32, 0.5], [0.3, -0.26, 0.46]]
      .some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
  ),
};

export const SHAPE_NAMES = Object.keys(SHAPES);

// A static outline of a shape, for previews (e.g. the customizer).
export function shapePath(name, cx, cy, r) {
  const radii = SHAPES[name] || SHAPES.circle;
  const pts = Array.from(radii, (v, i) => {
    const a = (i / N) * TAU;
    return [cx + Math.cos(a) * v * r, cy + Math.sin(a) * v * r];
  });
  return spline(pts);
}
export const MOODS = ["idle", "happy", "surprised", "sleepy", "love", "shy", "curious", "dizzy", "thinking"];

/* —— the bot —— */

export class Bot {
  constructor(svg, { size = 64, reduceMotion = false } = {}) {
    this.svg = svg;
    this.R = size;
    this.reduceMotion = reduceMotion;

    this.group = el("g", { class: "bot" });
    this.body = el("path", { class: "bot-body" });
    this.blushL = el("ellipse", { class: "bot-blush" });
    this.blushR = el("ellipse", { class: "bot-blush" });
    this.eyeL = el("path", { class: "bot-eye" });
    this.eyeR = el("path", { class: "bot-eye" });
    this.mouth = el("path", { class: "bot-mouth" });
    this.zzz = el("text", { class: "bot-zzz" });
    this.group.append(this.body, this.blushL, this.blushR, this.eyeL, this.eyeR, this.mouth);
    svg.append(this.group, this.zzz);

    this.radii = new Float32Array(SHAPES.circle);
    this.shapeName = "circle";

    // physics: (x, y) is the centre; it floats, so there is no gravity or floor
    this.x = 200; this.y = 200;
    this.vx = 0; this.vy = 0;
    this.minX = 0; this.minY = 0; this.maxX = 800; this.maxY = 600;
    this.target = null;     // where it is drifting to, or null
    this.swimSpeed = 36;    // px/s cruising
    this.hold = false;      // stay put (e.g. while its speech bubble is hovered)
    this.dragging = false;

    // springs
    this.sy = 1; this.syV = 0;          // vertical squash (sx follows to keep area)
    this.spin = 0; this.spinV = 0;      // rotation in degrees
    this.tilt = 0;                      // gentle lean in the direction of travel
    this.blink = 1; this.nextBlink = 2;
    this.gaze = { x: 0, y: 0 }; this.gazeTarget = { x: 0, y: 0 };
    this.look = null;                   // a point to look at, or null
    this.mood = "idle"; this.baseMood = "idle"; this.moodUntil = 0;
    this.talking = false; this.mouthOpen = 0;
    this.t = 0;
  }

  /* —— commands —— */

  setShape(name) {
    if (SHAPES[name]) this.shapeName = name;
  }

  setMood(mood, ms = 1800) {
    if (!MOODS.includes(mood)) return;
    if (ms === Infinity) { this.baseMood = mood; this.mood = mood; this.moodUntil = 0; return; }
    this.mood = mood;
    this.moodUntil = this.t + ms / 1000;
  }

  setBounds(minX, minY, maxX, maxY) {
    Object.assign(this, { minX, minY, maxX, maxY });
  }

  // Keep a point inside the water, a body-width from every edge.
  clampToWater(x, y) {
    const r = this.R * 1.2;
    return { x: clamp(x, this.minX + r, this.maxX - r), y: clamp(y, this.minY + r, this.maxY - r) };
  }

  swimTo(x, y) {
    if (this.reduceMotion) return;
    this.target = this.clampToWater(x, y);
  }

  // A quick upward dart, the water version of a jump.
  jump(power = 1) {
    if (this.dragging || this.reduceMotion) return;
    this.vy -= 360 * power;
    this.sy = 0.84;
  }

  doSpin() {
    if (this.reduceMotion) return;
    this.spinV += 720;
  }

  lookAt(x, y) { this.look = x == null ? null : { x, y }; }

  get settled() {
    return !this.dragging && Math.hypot(this.vx, this.vy) < 30 && this.y > this.minY;
  }

  grab(x, y) {
    this.dragging = true;
    this.target = null;
    this.dragPrev = { x, y, t: performance.now() };
    this.vx = this.vy = 0;
    this.setMood("surprised", 600);
  }

  dragTo(x, y) {
    const now = performance.now();
    const dt = Math.max(0.008, (now - this.dragPrev.t) / 1000);
    // smooth the throw velocity a little
    this.vx = this.vx * 0.5 + ((x - this.dragPrev.x) / dt) * 0.5;
    this.vy = this.vy * 0.5 + ((y - this.dragPrev.y) / dt) * 0.5;
    this.dragPrev = { x, y, t: now };
    const p = this.clampToWater(x, y);
    this.x = p.x;
    this.y = p.y;
  }

  release() {
    this.dragging = false;
    this.vx = clamp(this.vx, -1800, 1800);
    this.vy = clamp(this.vy, -1800, 1800);
    if (Math.hypot(this.vx, this.vy) > 1200) this.doSpin();
  }

  // Is a viewport point on the body? (cheap: compare against the radius at that angle)
  hit(px, py) {
    const c = this.center();
    const dx = px - c.x, dy = py - c.y;
    const a = (Math.atan2(dy, dx) + TAU) % TAU;
    const r = this.radii[Math.round((a / TAU) * N) % N] * this.R * 1.1;
    return dx * dx + dy * dy <= r * r;
  }

  // Drawn centre: the physics position plus a slow bob.
  center() {
    const bob = this.reduceMotion || this.dragging ? 0 : Math.sin(this.t * 1.3) * this.R * 0.07;
    return { x: this.x, y: this.y + bob, sx: 1 / Math.sqrt(this.sy) };
  }

  // Where a speech bubble should anchor (top of the head).
  head() {
    const c = this.center();
    return { x: c.x, y: c.y - this.radii[(3 * N) / 4] * this.R * this.sy };
  }

  /* —— simulation —— */

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const t = this.t;

    if (this.moodUntil && t > this.moodUntil) { this.mood = this.baseMood; this.moodUntil = 0; }

    // morph: exponential ease toward the chosen shape (no overshoot)
    const target = SHAPES[this.shapeName];
    const k = this.reduceMotion ? 1 : 1 - Math.exp(-dt * 9);
    for (let i = 0; i < N; i++) this.radii[i] += (target[i] - this.radii[i]) * k;

    if (!this.dragging) this.physics(dt);

    // squash spring: a slow jellyfish pulse, stretched a little by fast motion
    let rest = 1 + Math.sin(t * (this.mood === "sleepy" ? 1.1 : 1.8)) * 0.035;
    if (this.dragging) rest = 1.1;
    else rest += clamp(-this.vy / 3000, -0.08, 0.12);
    const f = (rest - this.sy) * 160 - this.syV * 12;
    this.syV += f * dt;
    this.sy = clamp(this.sy + this.syV * dt, 0.6, 1.4);

    // lean into the direction of travel, plus a lazy sway
    const lean = this.reduceMotion ? 0 : clamp(this.vx * 0.06, -12, 12) + Math.sin(t * 0.8) * 3;
    this.tilt += (lean - this.tilt) * (1 - Math.exp(-dt * 3));

    // spin decays toward the nearest full turn
    if (this.spinV !== 0 || this.spin % 360 !== 0) {
      this.spin += this.spinV * dt;
      this.spinV *= Math.exp(-dt * 2.2);
      if (Math.abs(this.spinV) < 40) {
        const goal = Math.round(this.spin / 360) * 360;
        this.spin += (goal - this.spin) * (1 - Math.exp(-dt * 8));
        if (Math.abs(goal - this.spin) < 0.5) { this.spin = 0; this.spinV = 0; }
      }
    }

    this.updateFace(dt);
    this.render();
  }

  physics(dt) {
    if (this.hold) {
      this.target = null;
      const d = Math.exp(-dt * 6);
      this.vx *= d; this.vy *= d;
    } else if (this.target) {
      // steer toward the target, slowing as it arrives
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) this.target = null;
      else {
        // cruise slowly on short hops, a little faster across the page
        const speed = Math.min(this.swimSpeed + dist * 0.12, dist * 0.6);
        const steer = 1 - Math.exp(-dt * 1.2);
        this.vx += ((dx / dist) * speed - this.vx) * steer;
        this.vy += ((dy / dist) * speed - this.vy) * steer;
      }
    }

    // water drag (lighter while swimming on purpose), plus a faint current
    // so it never sits perfectly still
    const drag = Math.exp(-dt * (this.target ? 0.4 : 1.6));
    this.vx = this.vx * drag + Math.sin(this.t * 0.37) * 4 * dt;
    this.vy = this.vy * drag + Math.cos(this.t * 0.29) * 3 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // soft walls: bounce gently, and get dizzy if thrown hard into one
    const r = this.R * 1.05;
    const bounce = (v) => { if (Math.abs(v) > 900) this.setMood("dizzy", 1500); return -v * 0.45; };
    if (this.x < this.minX + r) { this.x = this.minX + r; if (this.vx < 0) this.vx = bounce(this.vx); }
    if (this.x > this.maxX - r) { this.x = this.maxX - r; if (this.vx > 0) this.vx = bounce(this.vx); }
    if (this.y < this.minY + r) { this.y += (this.minY + r - this.y) * Math.min(1, dt * 3); if (this.vy < 0) this.vy = bounce(this.vy); }
    if (this.y > this.maxY - r) { this.y = this.maxY - r; if (this.vy > 0) this.vy = bounce(this.vy); }
  }

  updateFace(dt) {
    const t = this.t;
    // blinking
    if (t > this.nextBlink && this.mood !== "sleepy") {
      this.blinkStart = t;
      this.nextBlink = t + 2 + Math.random() * 3.5;
    }
    const since = t - (this.blinkStart ?? -10);
    this.blink = since < 0.16 ? Math.abs(Math.cos((since / 0.16) * Math.PI)) : 1;

    // gaze: at a point, or idle drift
    const c = this.center();
    if (this.look) {
      const dx = this.look.x - c.x, dy = this.look.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 260);
      this.gazeTarget = { x: (dx / d) * m, y: (dy / d) * m };
    } else if (this.target) {
      this.gazeTarget = { x: clamp((this.target.x - this.x) / 120, -0.8, 0.8), y: clamp((this.target.y - this.y) / 160, -0.6, 0.6) };
    } else if (Math.random() < dt * 0.6) {
      this.gazeTarget = { x: (Math.random() - 0.5) * 1.4, y: (Math.random() - 0.5) * 0.8 };
    }
    if (this.mood === "thinking") this.gazeTarget = { x: 0.5 * Math.sin(t * 1.5), y: -0.9 };
    if (this.mood === "shy") this.gazeTarget = { x: 0.6, y: 0.8 };
    const g = 1 - Math.exp(-dt * 10);
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * g;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * g;

    // mouth flaps while talking
    const goal = this.talking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 17) * Math.sin(t * 6.3)) : 0;
    this.mouthOpen += (goal - this.mouthOpen) * (1 - Math.exp(-dt * 25));
  }

  /* —— drawing —— */

  render() {
    const R = this.R;
    const c = this.center();
    const sy = this.sy, sx = c.sx;
    const t = this.t;
    const moving = this.dragging || Math.hypot(this.vx, this.vy) > 60;
    const wob = this.reduceMotion ? 0 : (moving ? 0.035 : this.talking ? 0.03 : 0.02);

    // body outline: radii → points → closed Catmull-Rom spline
    const pts = new Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const w = 1 + wob * (Math.sin(3 * a + t * 2.3) * 0.6 + Math.sin(5 * a - t * 1.9) * 0.4);
      const r = this.radii[i] * R * w;
      pts[i] = [c.x + Math.cos(a) * r * sx, c.y + Math.sin(a) * r * sy];
    }
    this.body.setAttribute("d", spline(pts));
    const angle = this.spin + this.tilt;
    this.group.setAttribute("transform", Math.abs(angle) > 0.05 ? `rotate(${angle.toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)})` : "");

    // face
    const gx = this.gaze.x * R * 0.16, gy = this.gaze.y * R * 0.12;
    const ey = c.y - R * 0.12 * sy + gy;
    const ex = R * 0.3 * sx;
    const left = { x: c.x - ex + gx, y: ey }, right = { x: c.x + ex + gx, y: ey };
    const mood = this.mood;
    drawEye(this.eyeL, left, R, mood, this.blink, false);
    drawEye(this.eyeR, right, R, mood, this.blink, true);

    const blush = mood === "shy" || mood === "love" || mood === "happy";
    for (const [b, p] of [[this.blushL, left], [this.blushR, right]]) {
      attrs(b, { cx: p.x, cy: p.y + R * 0.3, rx: R * 0.13, ry: R * 0.07, opacity: blush ? 0.55 : 0 });
    }

    const my = c.y + R * 0.22 * sy + gy * 0.5, mx = c.x + gx * 0.7;
    let d = "";
    if (this.mouthOpen > 0.04) {
      const w = R * 0.12, hgt = R * 0.16 * this.mouthOpen;
      d = `M${mx - w},${my} Q${mx},${my - hgt * 0.3} ${mx + w},${my} Q${mx},${my + hgt * 1.6} ${mx - w},${my}Z`;
    } else if (mood === "happy" || mood === "love") {
      d = `M${mx - R * 0.12},${my - R * 0.02} Q${mx},${my + R * 0.12} ${mx + R * 0.12},${my - R * 0.02}`;
    } else if (mood === "surprised") {
      d = circlePath(mx, my + R * 0.02, R * 0.06);
    }
    this.mouth.setAttribute("d", d);
    this.mouth.classList.toggle("is-open", this.mouthOpen > 0.04 || mood === "surprised");

    // zzz while asleep
    if (mood === "sleepy" && !this.reduceMotion) {
      const p = (t * 0.5) % 1;
      attrs(this.zzz, { x: c.x + R * (0.7 + p * 0.4), y: c.y - R * (0.6 + p * 0.8), opacity: 1 - p, "font-size": R * (0.3 + p * 0.2) });
      this.zzz.textContent = "z";
    } else {
      this.zzz.setAttribute("opacity", 0);
    }
  }
}

/* —— helpers —— */

function drawEye(path, p, R, mood, blink, isRight) {
  const w = R * 0.14;
  let h = R * 0.34;
  let d, stroke = false;
  switch (mood) {
    case "happy":
      d = `M${p.x - w * 0.9},${p.y + R * 0.05} Q${p.x},${p.y - R * 0.16} ${p.x + w * 0.9},${p.y + R * 0.05}`;
      stroke = true; break;
    case "sleepy":
      d = `M${p.x - w * 0.9},${p.y + R * 0.04} Q${p.x},${p.y + R * 0.1} ${p.x + w * 0.9},${p.y + R * 0.04}`;
      stroke = true; break;
    case "dizzy": {
      const s = R * 0.09;
      d = `M${p.x - s},${p.y - s} L${p.x + s},${p.y + s} M${p.x + s},${p.y - s} L${p.x - s},${p.y + s}`;
      stroke = true; break;
    }
    case "surprised":
      d = circlePath(p.x, p.y, R * 0.13 * Math.max(0.15, blink)); break;
    case "love":
      d = heartPath(p.x, p.y, R * 0.2); break;
    case "curious":
      if (isRight) h *= 1.3; else h *= 0.8;
      d = pill(p.x, p.y, w, h * Math.max(0.12, blink)); break;
    case "shy":
      d = pill(p.x, p.y + R * 0.04, w, h * 0.7 * Math.max(0.12, blink)); break;
    default:
      d = pill(p.x, p.y, w, h * Math.max(0.12, blink));
  }
  path.setAttribute("d", d);
  path.classList.toggle("is-line", stroke);
}

function pill(cx, cy, w, h) {
  const r = Math.min(w, h) / 2;
  const x = cx - w / 2, y = cy - h / 2;
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

function circlePath(cx, cy, r) {
  return `M${cx - r},${cy}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0Z`;
}

function heartPath(cx, cy, s) {
  const y = cy - s * 0.25;
  return `M${cx},${y + s * 0.75} C${cx - s},${y + s * 0.1} ${cx - s * 0.55},${y - s * 0.55} ${cx},${y - s * 0.1} C${cx + s * 0.55},${y - s * 0.55} ${cx + s},${y + s * 0.1} ${cx},${y + s * 0.75}Z`;
}

function spline(p) {
  const n = p.length;
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

function el(name, a) {
  const e = document.createElementNS(SVG_NS, name);
  attrs(e, a);
  return e;
}

function attrs(e, a) {
  for (const k in a) e.setAttribute(k, typeof a[k] === "number" ? +a[k].toFixed(2) : a[k]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
