(() => {
  "use strict";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const canvas = document.getElementById("field");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    w: 0,
    h: 0,
    dpr: 1,
    points: [],
    mouse: { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 },
    t: 0,
    raf: 0,
  };

  const COLS = 14;
  const ROWS = 10;
  const ACCENT = { r: 157, g: 180, b: 160 };

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    canvas.width = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    canvas.style.width = state.w + "px";
    canvas.style.height = state.h + "px";
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    seed();
  }

  function seed() {
    state.points = [];
    const padX = state.w * 0.06;
    const padY = state.h * 0.08;
    const spanX = state.w - padX * 2;
    const spanY = state.h - padY * 2;

    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i <= COLS; i++) {
        const nx = i / COLS;
        const ny = j / ROWS;
        state.points.push({
          bx: padX + nx * spanX,
          by: padY + ny * spanY,
          ox: (Math.random() - 0.5) * 18,
          oy: (Math.random() - 0.5) * 18,
          phase: Math.random() * Math.PI * 2,
          amp: 4 + Math.random() * 10,
        });
      }
    }
  }

  function drawStatic() {
    ctx.clearRect(0, 0, state.w, state.h);
    const pts = state.points;
    const cols = COLS + 1;

    ctx.lineWidth = 1;
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = pts[j * cols + i];
        const b = pts[j * cols + i + 1];
        const alpha = 0.04 + ((i + j) % 3) * 0.015;
        ctx.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.bx + a.ox * 0.3, a.by + a.oy * 0.3);
        ctx.lineTo(b.bx + b.ox * 0.3, b.by + b.oy * 0.3);
        ctx.stroke();
      }
    }
    for (let i = 0; i <= COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const a = pts[j * cols + i];
        const b = pts[(j + 1) * cols + i];
        const alpha = 0.035 + ((i + j) % 4) * 0.012;
        ctx.strokeStyle = `rgba(232,230,225,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.bx + a.ox * 0.3, a.by + a.oy * 0.3);
        ctx.lineTo(b.bx + b.ox * 0.3, b.by + b.oy * 0.3);
        ctx.stroke();
      }
    }

    for (const p of pts) {
      ctx.fillStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0.22)`;
      ctx.beginPath();
      ctx.arc(p.bx + p.ox * 0.3, p.by + p.oy * 0.3, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    state.t = now * 0.001;
    state.mouse.x += (state.mouse.tx - state.mouse.x) * 0.06;
    state.mouse.y += (state.mouse.ty - state.mouse.y) * 0.06;

    const mx = state.mouse.x * state.w;
    const my = state.mouse.y * state.h;
    const pts = state.points;
    const cols = COLS + 1;

    // positions this frame
    const pos = pts.map((p) => {
      const dx = mx - p.bx;
      const dy = my - p.by;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1;
      const pull = Math.min(28, 2200 / dist);
      const wave =
        Math.sin(state.t * 0.55 + p.phase + p.bx * 0.004) * p.amp * 0.35;
      return {
        x: p.bx + p.ox * 0.25 + (dx / dist) * -pull * 0.35 + wave,
        y: p.by + p.oy * 0.25 + (dy / dist) * -pull * 0.35 + wave * 0.6,
      };
    });

    ctx.clearRect(0, 0, state.w, state.h);

    // horizontal edges
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = pos[j * cols + i];
        const b = pos[j * cols + i + 1];
        const alpha = 0.05 + ((i + j) % 3) * 0.018;
        ctx.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // vertical edges
    for (let i = 0; i <= COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const a = pos[j * cols + i];
        const b = pos[(j + 1) * cols + i];
        const alpha = 0.04 + ((i + j) % 4) * 0.014;
        ctx.strokeStyle = `rgba(232,230,225,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // nodes
    for (let n = 0; n < pos.length; n++) {
      const p = pos[n];
      const near =
        1 - Math.min(1, Math.hypot(p.x - mx, p.y - my) / (state.w * 0.35));
      const a = 0.18 + near * 0.35;
      ctx.fillStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.15 + near * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    state.raf = requestAnimationFrame(frame);
  }

  function onPointer(e) {
    const x = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX);
    const y = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
    if (x == null || y == null) return;
    state.mouse.tx = x / state.w;
    state.mouse.ty = y / state.h;
  }

  resize();

  if (reduceMotion) {
    drawStatic();
    window.addEventListener("resize", () => {
      resize();
      drawStatic();
    });
    return;
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("touchmove", onPointer, { passive: true });
  state.raf = requestAnimationFrame(frame);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(state.raf);
    } else {
      state.raf = requestAnimationFrame(frame);
    }
  });
})();
