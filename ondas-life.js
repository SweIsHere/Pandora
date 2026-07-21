/* ============================================================
   PANDORA — ondas-life.js
   ------------------------------------------------------------
   Vida acuática del modo "ondas": sobre el escenario oscuro y bajo
   los anillos con bloom, nadan PECES con glow, derivan MEDUSAS que
   laten, y VUELAN las PALABRAS de los poemas registrados. Todo en
   tinta azul, dibujado en 2D con composición ADITIVA ("lighter")
   sobre fondo oscuro → cada forma brilla por acumulación de luz,
   más halos radiales suaves que hacen de resplandor barato (sin
   shadowBlur por cada trazo). Se enciende sólo en modo "ondas".

   Las palabras se leen en vivo de localStorage("pandora_poems"),
   así los poemas recién escritos aparecen volando.
   Expone window.PandoraLife = { start, stop }.
   ============================================================ */
(function () {
  "use strict";
  const POEM_KEY = "pandora_poems";
  const TAU = Math.PI * 2;
  const MONO = 'ui-monospace, "Courier New", monospace';
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const FISH_N = 5, JELLY_N = 3, WORD_MAX = 16;
  const CORE = "#d2ddff";

  let cv = null, ctx = null, W = 0, H = 0, DPR = 1;
  let running = false, raf = 0, last = 0;
  const fish = [], jellies = [], words = [];
  let wordPool = [];

  const rnd = (a, b) => a + Math.random() * (b - a);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* halo radial reutilizable = resplandor barato (un solo relleno) */
  function halo(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(" + rgb + "," + a + ")");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  /* ── PECES ── */
  function makeFish() {
    return {
      x: rnd(0, W), y: rnd(0, H), ang: rnd(0, TAU),
      len: rnd(26, 46), wid: rnd(5, 9), speed: rnd(30, 66),
      swim: rnd(0, TAU), swimRate: rnd(6, 10),
      turnF: rnd(0.1, 0.4), turnP: rnd(0, TAU), turnA: rnd(0.4, 1.0)
    };
  }
  function stepFish(k, dt, t) {
    k.ang += Math.sin(t * k.turnF * TAU + k.turnP) * k.turnA * dt;
    k.swim += k.swimRate * dt;
    k.x += Math.cos(k.ang) * k.speed * dt;
    k.y += Math.sin(k.ang) * k.speed * dt;
    const m = 70;
    if (k.x < -m) k.x = W + m; else if (k.x > W + m) k.x = -m;
    if (k.y < -m) k.y = H + m; else if (k.y > H + m) k.y = -m;
  }
  function drawFish(k) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    halo(k.x, k.y, k.len * 0.95, "60,104,255", 0.20);
    ctx.translate(k.x, k.y); ctx.rotate(k.ang);
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const along = (0.72 - u) * k.len;
      const wob = Math.sin(k.swim - u * 3.2) * (u * k.wid * 1.1);
      const r = k.wid * Math.sin(Math.PI * (0.16 + u * 0.82));
      const a = 0.42 * (1 - u * 0.4);
      ctx.fillStyle = "rgba(150,185,255," + a.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(along, wob, Math.max(0.6, r), 0, TAU); ctx.fill();
    }
    // aleta caudal
    const bx = -0.28 * k.len, by = Math.sin(k.swim - 3.2) * k.wid;
    const flap = Math.sin(k.swim) * k.wid;
    ctx.fillStyle = "rgba(90,130,255,0.34)";
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - k.len * 0.34, by - k.wid * 1.4 + flap);
    ctx.lineTo(bx - k.len * 0.34, by + k.wid * 1.4 + flap);
    ctx.closePath(); ctx.fill();
    // núcleo brillante en la cabeza
    ctx.fillStyle = CORE;
    ctx.beginPath(); ctx.arc(0.62 * k.len, 0, k.wid * 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ── MEDUSAS ── */
  function makeJelly() {
    return {
      x: rnd(0, W), y: rnd(0, H), r: rnd(16, 30),
      vx: rnd(-8, 8), vy: rnd(-22, -9),
      pulse: rnd(0, TAU), pulseRate: rnd(1.2, 2.2),
      tent: 5 + Math.floor(rnd(0, 4)), phase: rnd(0, TAU)
    };
  }
  function stepJelly(j, dt, t) {
    j.pulse += j.pulseRate * dt;
    j.x += (j.vx + Math.sin(t * 0.6 + j.phase) * 6) * dt;
    j.y += j.vy * dt;
    const m = 70;
    if (j.y < -j.r * 3 - m) { j.y = H + m; j.x = rnd(0, W); }
    if (j.x < -m) j.x = W + m; else if (j.x > W + m) j.x = -m;
  }
  function drawJelly(j, t) {
    const pr = 0.5 + 0.5 * Math.sin(j.pulse);
    const rx = j.r * (0.92 + 0.16 * pr), ry = j.r * (0.72 + 0.26 * (1 - pr));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    halo(j.x, j.y, j.r * 2.2, "70,110,255", 0.16);
    ctx.translate(j.x, j.y);

    // tentáculos ondulantes
    ctx.strokeStyle = "rgba(120,160,255,0.34)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < j.tent; i++) {
      const tx = (j.tent > 1 ? i / (j.tent - 1) - 0.5 : 0) * rx * 1.4;
      const len = j.r * 2.1;
      ctx.beginPath(); ctx.moveTo(tx, 0);
      for (let s = 1; s <= 6; s++) {
        const f = s / 6;
        const sway = Math.sin(t * 2.4 + j.phase + i * 0.7 + f * 3) * rx * 0.2 * f;
        ctx.lineTo(tx + sway, f * len);
      }
      ctx.stroke();
    }
    // campana (domo) con margen ondulado
    ctx.fillStyle = "rgba(60,100,255,0.14)";
    ctx.strokeStyle = "rgba(150,185,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-rx, 0);
    ctx.bezierCurveTo(-rx, -ry * 1.5, rx, -ry * 1.5, rx, 0);
    const waves = 4;
    for (let s = 1; s <= waves; s++) {
      const px = rx - (2 * rx) * (s / waves);
      const py = Math.sin(s * Math.PI + j.pulse) * ry * 0.16;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // núcleo interior
    ctx.fillStyle = "rgba(200,215,255,0.5)";
    ctx.beginPath(); ctx.ellipse(0, -ry * 0.35, rx * 0.42, ry * 0.42, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ── PALABRAS de los poemas ── */
  function refreshWords() {
    let poems = [];
    try { poems = JSON.parse(localStorage.getItem(POEM_KEY)) || []; } catch (e) {}
    const set = [];
    poems.forEach(function (p) {
      ((p.title || "") + " " + (p.body || "")).split(/\s+/).forEach(function (w) {
        w = w.replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’·-]/g, "");
        if (w.length >= 2) set.push(w);
      });
    });
    wordPool = set;
  }
  function makeWord(seedLife) {
    if (!wordPool.length) return null;
    return {
      text: wordPool[Math.floor(Math.random() * wordPool.length)],
      x: rnd(0, W), y: rnd(H * 0.25, H + 40),
      vx: rnd(-8, 8), vy: rnd(-26, -12),
      size: rnd(13, 23), life: seedLife || 0, ttl: rnd(6, 12),
      sway: rnd(0, TAU), swayRate: rnd(0.4, 1.0)
    };
  }
  function stepWord(wd, dt, t) {
    wd.life += dt; wd.sway += wd.swayRate * dt;
    wd.x += (wd.vx + Math.sin(wd.sway) * 10) * dt;
    wd.y += wd.vy * dt;
    return wd.life < wd.ttl && wd.y > -60;
  }
  function drawWord(wd) {
    const fade = Math.min(1, wd.life / 1.2) * Math.min(1, (wd.ttl - wd.life) / 1.6);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 " + wd.size.toFixed(1) + "px " + MONO;
    ctx.shadowColor = "rgba(60,104,255,0.9)"; ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(140,175,255," + (0.5 * fade).toFixed(3) + ")";
    ctx.fillText(wd.text, wd.x, wd.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(212,224,255," + (0.72 * fade).toFixed(3) + ")";
    ctx.fillText(wd.text, wd.x, wd.y);
    ctx.restore();
  }

  /* ── bucle ── */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    const t = now * 0.001;

    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < fish.length; i++) { if (!REDUCED) stepFish(fish[i], dt, t); drawFish(fish[i]); }
    for (let i = 0; i < jellies.length; i++) { if (!REDUCED) stepJelly(jellies[i], dt, t); drawJelly(jellies[i], t); }
    for (let i = words.length - 1; i >= 0; i--) {
      if (!REDUCED && !stepWord(words[i], dt, t)) { words.splice(i, 1); continue; }
      drawWord(words[i]);
    }
    if (!REDUCED && wordPool.length && words.length < WORD_MAX && Math.random() < 0.05) {
      const w = makeWord(); if (w) words.push(w);
    }
  }

  function start() {
    cv = document.getElementById("fx-life");
    if (!cv) return;
    ctx = cv.getContext("2d");
    cv.style.display = "block";
    resize();
    refreshWords();
    if (!fish.length) for (let i = 0; i < FISH_N; i++) fish.push(makeFish());
    if (!jellies.length) for (let i = 0; i < JELLY_N; i++) jellies.push(makeJelly());
    words.length = 0;
    const seed = Math.min(6, wordPool.length ? 6 : 0);
    for (let i = 0; i < seed; i++) { const w = makeWord(Math.random() * 3); if (w) words.push(w); }
    addEventListener("resize", resize);
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    if (cv && ctx) { ctx.clearRect(0, 0, W, H); cv.style.display = "none"; }
  }

  window.PandoraLife = { start: start, stop: stop };
})();
