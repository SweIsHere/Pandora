/* ============================================================
   PANDORA — automatas.js  ·  "Autómatas"
   ------------------------------------------------------------
   Dos ventanas hermanas, como en el kaleidoscopio:

   1) EL BANCO (lámina de montaje). Repartes una cantidad fija de
      MATERIA entre cinco piezas —brazos, piernas, coraza, núcleo e
      inteligencia—, de 1 a 8 cada una. No hay autómata perfecto:
      el presupuesto obliga a elegir qué clase de bicho eres.

      La lámina no es un icono: el muñeco se DIBUJA a partir de los
      números. Brazos gruesos si pegas, piernas largas y con pistones
      si corres, torso ancho y tramado si vas blindado, núcleo grande
      y latiendo si aguantas, antenas y ojos si piensas. Con líneas
      de cota y rótulos, como una plancha de manual.

   2) LA ARENA. Cinco rivales en fila; cada uno cae y da +2 de
      materia para recalibrar antes del siguiente. El combate se
      resuelve solo, un golpe por tic, y se cuenta en un diario en
      monoespaciada — se mira, no se juega a botonazos.

      Números: vida = 18 + núcleo·7 · golpe = 3 + brazos·1.7
      guardia = coraza·1.05 (resta plana) · esquiva = piernas·2.6 %
      puntería = 72 + int·3.2 % · crítico = int·3.4 % (×1.9)
      Además, la inteligencia LEE EL PATRÓN: a partir de la tercera
      ronda suma puntería y crítico acumulados — un autómata listo
      empieza torpe y termina inevitable.

   Todo persiste en localStorage. Sólo se anima con la sección en
   pantalla (IntersectionObserver) y se respeta prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  const KEY = "pandora_automatas";
  const MIN_P = 1, MAX_P = 8;
  const BASE_BUDGET = 16, BONUS_NIVEL = 2;
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const INK     = "#243ec4";   /* tú: la tinta azul de la casa */
  const INK_FOE = "#a5442f";   /* el rival: óxido */
  const PAPER   = "#f4f1e8";
  const MUTED   = "#8b887e";
  const DARK    = "#2a2a28";

  const PARTS = [
    { id: "brazos",       label: "brazos",       glosa: "empuje del golpe" },
    { id: "piernas",      label: "piernas",      glosa: "iniciativa y esquiva" },
    { id: "coraza",       label: "coraza",       glosa: "lo que come el blindaje" },
    { id: "nucleo",       label: "núcleo",       glosa: "energía en el pecho" },
    { id: "inteligencia", label: "inteligencia", glosa: "puntería y cálculo" }
  ];

  /* ── los cinco de la fila ── */
  const RIVALES = [
    { name: "Hojalata",           st: { brazos:3, piernas:2, coraza:3, nucleo:3, inteligencia:2 },
      linea: "un muñeco de cuerda: pega despacio y piensa menos" },
    { name: "el Segador",         st: { brazos:7, piernas:3, coraza:2, nucleo:4, inteligencia:1 },
      linea: "todo brazos y ninguna duda — si te alcanza, dolerá" },
    { name: "Libélula de latón",  st: { brazos:3, piernas:8, coraza:2, nucleo:4, inteligencia:4 },
      linea: "nunca la verás quieta el tiempo suficiente" },
    { name: "el Muro de Nínive",  st: { brazos:5, piernas:1, coraza:8, nucleo:8, inteligencia:3 },
      linea: "no ataca: espera a que te canses de golpearlo" },
    { name: "el Oráculo",         st: { brazos:6, piernas:5, coraza:5, nucleo:6, inteligencia:8 },
      linea: "ya ha visto este combate antes, y sabe cómo acaba" }
  ];

  /* ── estado persistente ── */
  const S = {
    name: "Autómata I",
    parts: { brazos:4, piernas:3, coraza:3, nucleo:4, inteligencia:2 },
    level: 1,          /* 1..5 — el rival que toca */
    champion: false
  };

  function budget() { return BASE_BUDGET + (S.level - 1) * BONUS_NIVEL; }
  function spent()  { return PARTS.reduce((a, p) => a + S.parts[p.id], 0); }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw) return;
      if (typeof raw.name === "string" && raw.name.trim()) S.name = raw.name.slice(0, 22);
      if (raw.parts) PARTS.forEach(p => {
        const v = Math.round(Number(raw.parts[p.id]));
        if (isFinite(v)) S.parts[p.id] = Math.max(MIN_P, Math.min(MAX_P, v));
      });
      const lv = Math.round(Number(raw.level));
      if (isFinite(lv)) S.level = Math.max(1, Math.min(RIVALES.length, lv));
      S.champion = !!raw.champion;
      /* si un reparto guardado se pasa del presupuesto (por un cambio
         de reglas), se recorta de mayor a menor hasta que cuadre */
      let guard = 0;
      while (spent() > budget() && guard++ < 200) {
        const top = PARTS.slice().sort((a, b) => S.parts[b.id] - S.parts[a.id])[0];
        if (S.parts[top.id] <= MIN_P) break;
        S.parts[top.id]--;
      }
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  /* ── de números a carne: estadísticas derivadas ── */
  function derive(st) {
    return {
      vida:     Math.round(18 + st.nucleo * 7),
      golpe:    3 + st.brazos * 1.7,
      guardia:  st.coraza * 1.05,
      paso:     st.piernas,
      esquiva:  st.piernas * 2.6,
      punteria: 72 + st.inteligencia * 3.2,
      critico:  st.inteligencia * 3.4
    };
  }

  /* rótulo corto por pieza, para leer el reparto sin hacer cuentas */
  function derivedText(id, st) {
    const d = derive(st);
    if (id === "brazos")  return "golpe " + d.golpe.toFixed(1);
    if (id === "piernas") return "esquiva " + Math.round(d.esquiva) + "%";
    if (id === "coraza")  return "absorbe " + d.guardia.toFixed(1);
    if (id === "nucleo")  return "vida " + d.vida;
    return "crítico " + Math.round(d.critico) + "%";
  }

  /* ════════════════════════════════════════════════════════════
     EL DIBUJO — un autómata hecho de sus propios números
     Todo cuelga de (0,0) = el suelo entre los pies; hacia arriba
     es y negativa. Así el muñeco se puede tumbar rotando sobre
     los pies sin recalcular nada.
     ════════════════════════════════════════════════════════════ */

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);  g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);  g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);      g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function metrics(st, h) {
    return {
      legLen:  h * (0.24 + st.piernas * 0.017),
      torsoH:  h * 0.30,
      torsoW:  h * (0.13 + st.coraza * 0.015),
      headR:   h * (0.050 + st.inteligencia * 0.005),
      armW:    Math.max(1.4, h * (0.010 + st.brazos * 0.0042)),
      armLen:  h * (0.115 + st.brazos * 0.006),
      coreR:   h * (0.014 + st.nucleo * 0.0055)
    };
  }

  /* opt: { cx, ground, h, st, ink, facing, t, hit, atk, fall } */
  function drawAutomaton(g, opt) {
    const st = opt.st, h = opt.h, m = metrics(st, h);
    const t = opt.t, f = opt.facing;
    const hit = opt.hit || 0, atk = opt.atk || 0, fall = opt.fall || 0;

    const bob   = REDUCED ? 0 : Math.sin(t * 1.7 + opt.cx * 0.03) * h * 0.007;
    const shake = hit > 0 ? (Math.random() - 0.5) * h * 0.035 * hit : 0;
    const ink   = hit > 0.55 ? "#c0392b" : opt.ink;

    g.save();
    g.translate(opt.cx + shake, opt.ground);
    if (fall > 0) {
      const e = 1 - Math.pow(1 - fall, 3);          /* cae y se posa */
      g.rotate(-f * 1.42 * e);
      g.globalAlpha = 1 - e * 0.45;
    }

    const hipY      = -m.legLen + bob;
    const shoulderY = hipY - m.torsoH;
    const headCy    = shoulderY - h * 0.035 - m.headR;

    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = ink;
    g.fillStyle = ink;

    /* ── piernas: pistones ── */
    const spread = m.torsoW * 0.30;
    const legW = Math.max(1.2, h * (0.008 + st.piernas * 0.0016));
    for (let s = -1; s <= 1; s += 2) {
      const x = s * spread;
      const step = REDUCED ? 0 : Math.sin(t * 1.7 + (s > 0 ? 0 : Math.PI)) * h * 0.006;
      const kneeY = hipY * 0.48;
      g.lineWidth = legW;
      g.beginPath();
      g.moveTo(x, hipY);
      g.lineTo(x + s * h * 0.014, kneeY + step * 0.4);
      g.lineTo(x, -h * 0.018);
      g.stroke();
      /* rungs del pistón: más piernas, más maquinaria a la vista */
      const rungs = 1 + Math.min(3, Math.floor(st.piernas / 2.5));
      g.lineWidth = 1;
      for (let i = 1; i <= rungs; i++) {
        const k = i / (rungs + 1);
        const yy = kneeY + (-h * 0.018 - kneeY) * k;
        const xx = x + s * h * 0.014 * (1 - k);
        g.beginPath();
        g.moveTo(xx - h * 0.012, yy);
        g.lineTo(xx + h * 0.012, yy);
        g.stroke();
      }
      /* rodilla y pie */
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x + s * h * 0.014, kneeY + step * 0.4, Math.max(1.5, h * 0.009), 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(x - h * 0.026 + f * h * 0.008, 0);
      g.lineTo(x + h * 0.026 + f * h * 0.008, 0);
      g.lineWidth = Math.max(1.6, legW);
      g.stroke();
    }

    /* ── torso: plancha con tramado y remaches ── */
    const sw = m.torsoW / 2, hw = m.torsoW / 2 * 0.78;
    g.beginPath();
    g.moveTo(-sw, shoulderY + h * 0.012);
    g.lineTo(-sw * 0.86, shoulderY);
    g.lineTo(sw * 0.86, shoulderY);
    g.lineTo(sw, shoulderY + h * 0.012);
    g.lineTo(hw, hipY);
    g.lineTo(-hw, hipY);
    g.closePath();
    g.fillStyle = PAPER;
    g.fill();
    g.save();
    g.clip();
    /* el tramado es el blindaje: más coraza, más densidad */
    const sp = Math.max(3, 11 - st.coraza * 0.9);
    g.strokeStyle = ink;
    g.globalAlpha = 0.30;
    g.lineWidth = 1;
    for (let x = -m.torsoW; x < m.torsoW * 2; x += sp) {
      g.beginPath();
      g.moveTo(x, shoulderY - 2);
      g.lineTo(x - m.torsoH, hipY + 2);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.2, h * (0.006 + st.coraza * 0.0012));
    g.stroke();

    /* remaches: uno por punto de coraza, repartidos por el canto */
    g.fillStyle = ink;
    for (let i = 0; i < st.coraza; i++) {
      const k = (i + 0.5) / st.coraza;
      const s2 = i % 2 ? 1 : -1;
      const y = shoulderY + m.torsoH * k;
      const wAt = sw + (hw - sw) * k;
      g.beginPath();
      g.arc(s2 * wAt * 0.82, y, Math.max(0.9, h * 0.005), 0, Math.PI * 2);
      g.fill();
    }

    /* ── núcleo: el corazón, late ── */
    const coreY = shoulderY + m.torsoH * 0.42;
    const pulse = REDUCED ? 1 : 0.82 + 0.18 * Math.sin(t * 3.1);
    g.save();
    g.globalAlpha = 0.9;
    g.beginPath();
    g.arc(0, coreY, m.coreR * pulse, 0, Math.PI * 2);
    g.fillStyle = ink;
    g.fill();
    g.globalAlpha = 0.45;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, coreY, m.coreR * 1.9, 0, Math.PI * 2);
    g.strokeStyle = ink;
    g.stroke();
    if (st.nucleo >= 6) {          /* núcleos grandes echan chispas */
      g.globalAlpha = 0.35;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + t * 0.6;
        g.beginPath();
        g.moveTo(Math.cos(a) * m.coreR * 2.3, coreY + Math.sin(a) * m.coreR * 2.3);
        g.lineTo(Math.cos(a) * m.coreR * 3.0, coreY + Math.sin(a) * m.coreR * 3.0);
        g.stroke();
      }
    }
    g.restore();

    /* ── brazos ──
       θ se mide desde la vertical hacia abajo; positivo = hacia el
       frente. El brazo delantero es el que golpea: atk lo levanta
       hasta la horizontal y estira el codo. */
    const swingBase = REDUCED ? 0 : Math.sin(t * 1.7) * 0.16;
    for (let s = -1; s <= 1; s += 2) {
      const front = (s === f);
      const shX = s * sw * 0.92, shY = shoulderY + h * 0.018;
      const lunge = front ? atk : 0;
      const th1 = (front ? 0.26 : -0.22) + swingBase * (front ? 1 : -1) + lunge * 1.35;
      const th2 = th1 + (front ? 0.62 : 0.5) - lunge * 0.95;
      const out = s * m.armLen * 0.14;
      const ex = shX + f * Math.sin(th1) * m.armLen + out;
      const ey = shY + Math.cos(th1) * m.armLen;
      const wx = ex + f * Math.sin(th2) * m.armLen;
      const wy = ey + Math.cos(th2) * m.armLen;

      g.strokeStyle = ink;
      g.lineWidth = m.armW;
      g.beginPath();
      g.moveTo(shX, shY);
      g.lineTo(ex, ey);
      g.lineTo(wx, wy);
      g.stroke();
      /* codo */
      g.lineWidth = 1;
      g.beginPath();
      g.arc(ex, ey, m.armW * 0.62, 0, Math.PI * 2);
      g.stroke();
      /* garra: tantas puntas como fuerza */
      const prongs = st.brazos >= 6 ? 3 : 2;
      const dir = Math.atan2(wy - ey, wx - ex);
      g.lineWidth = Math.max(1, m.armW * 0.55);
      for (let p = 0; p < prongs; p++) {
        const spreadA = (p - (prongs - 1) / 2) * 0.42;
        const len = m.armLen * (0.30 + st.brazos * 0.022);
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + Math.cos(dir + spreadA) * len, wy + Math.sin(dir + spreadA) * len);
        g.stroke();
      }
    }

    /* ── cabeza ── */
    g.lineWidth = 1.4;
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(0, shoulderY);
    g.lineTo(0, headCy + m.headR * 0.9);
    g.stroke();

    const hw2 = m.headR * 1.15, hh2 = m.headR * 1.5;
    g.fillStyle = PAPER;
    rr(g, -hw2, headCy - hh2 / 2, hw2 * 2, hh2, m.headR * 0.35);
    g.fill();
    g.lineWidth = Math.max(1.2, h * 0.006);
    g.stroke();

    /* ojos: uno, dos o tres según lo que piense */
    const eyes = Math.max(1, Math.min(3, 1 + Math.floor(st.inteligencia / 3)));
    const er = Math.max(1.1, m.headR * 0.16);
    g.fillStyle = ink;
    for (let i = 0; i < eyes; i++) {
      const ox = (i - (eyes - 1) / 2) * m.headR * 0.52 + f * m.headR * 0.22;
      g.beginPath();
      g.arc(ox, headCy, er, 0, Math.PI * 2);
      g.fill();
    }

    /* antenas: la inteligencia asoma por arriba */
    const ants = Math.max(0, Math.min(4, Math.ceil(st.inteligencia / 2) - 1));
    g.strokeStyle = ink;
    g.lineWidth = 1;
    for (let i = 0; i < ants; i++) {
      const s2 = (i % 2 ? 1 : -1) * (1 + Math.floor(i / 2) * 0.6);
      const sway = REDUCED ? 0 : Math.sin(t * 2.2 + i) * m.headR * 0.16;
      const tipX = s2 * m.headR * 0.55 + sway;
      const tipY = headCy - hh2 / 2 - m.headR * (0.7 + (i % 2) * 0.4);
      g.beginPath();
      g.moveTo(s2 * m.headR * 0.32, headCy - hh2 / 2);
      g.lineTo(tipX, tipY);
      g.stroke();
      g.fillStyle = ink;
      g.beginPath();
      g.arc(tipX, tipY, 1.4, 0, Math.PI * 2);
      g.fill();
    }

    g.restore();
  }

  /* ════════════════════════════════════════════════════════════
     LA LÁMINA — el banco de montaje, con cotas y rótulos
     ════════════════════════════════════════════════════════════ */
  const plate = { cv: null, g: null, w: 0, h: 0, dpr: 1 };

  function drawPlate(t) {
    const g = plate.g;
    if (!g) return;
    const W = plate.w, H = plate.h;
    g.clearRect(0, 0, W, H);

    /* marco de plancha: esquinas y regla inferior */
    g.strokeStyle = MUTED;
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    const pad = 10, c = 12;
    [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]
      .forEach(function (q) {
        g.beginPath();
        g.moveTo(q[0] + q[2] * c, q[1]);
        g.lineTo(q[0], q[1]);
        g.lineTo(q[0], q[1] + q[3] * c);
        g.stroke();
      });

    const ground = H - 34;
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(pad + 6, ground);
    g.lineTo(W - pad - 6, ground);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;

    const h = Math.min(H - 78, 250);
    const cx = W * 0.44;
    drawAutomaton(g, { cx: cx, ground: ground, h: h, st: S.parts, ink: INK, facing: 1, t: t });

    /* rótulos con línea de cota — la lámina explica el bicho */
    const m = metrics(S.parts, h);
    const hipY = ground - m.legLen, shoulderY = hipY - m.torsoH;
    const rot = [
      { txt: "inteligencia ×" + S.parts.inteligencia, x: cx + m.headR * 1.4,  y: shoulderY - h * 0.035 - m.headR * 1.6, side: 1 },
      { txt: "brazos ×" + S.parts.brazos,             x: cx - m.torsoW * 0.5 - m.armLen * 0.9, y: shoulderY + h * 0.12, side: -1 },
      { txt: "coraza ×" + S.parts.coraza,             x: cx + m.torsoW * 0.5,  y: shoulderY + m.torsoH * 0.22, side: 1 },
      { txt: "núcleo ×" + S.parts.nucleo,             x: cx - m.torsoW * 0.5,  y: shoulderY + m.torsoH * 0.42, side: -1 },
      { txt: "piernas ×" + S.parts.piernas,           x: cx + m.torsoW * 0.35, y: hipY + m.legLen * 0.55, side: 1 }
    ];
    g.font = '9px "Courier New", monospace';
    g.textBaseline = "middle";
    g.globalAlpha = 0.75;
    rot.forEach(function (r) {
      const endX = r.side > 0 ? W - pad - 92 : pad + 92;
      g.strokeStyle = MUTED;
      g.setLineDash([1, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(r.x, r.y);
      g.lineTo(endX, r.y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = DARK;
      g.textAlign = r.side > 0 ? "left" : "right";
      g.fillText(r.txt, endX + r.side * 5, r.y);
      g.fillStyle = MUTED;
      g.beginPath();
      g.arc(r.x, r.y, 1.6, 0, Math.PI * 2);
      g.fill();
    });

    /* pie de plancha */
    g.globalAlpha = 0.8;
    g.textAlign = "left";
    g.fillStyle = MUTED;
    g.fillText("lámina " + String(S.level).padStart(2, "0") + " · " + (S.name || "sin nombre"), pad + 6, H - 18);
    g.textAlign = "right";
    g.fillText("materia " + spent() + "/" + budget(), W - pad - 6, H - 18);
    g.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════════
     LA ARENA
     ════════════════════════════════════════════════════════════ */
  const arena = { cv: null, g: null, w: 0, h: 0, dpr: 1 };

  /* combate en curso (null = nadie en la arena) */
  let C = null;
  let phase = "listo";          /* listo · combate · ganado · perdido · campeon */
  let timer = 0;
  let fast = false;
  let paused = false;
  const pops = [];              /* números que suben */

  function fighter(name, st, ink, facing) {
    const d = derive(st);
    return {
      name: name, st: st, d: d, ink: ink, facing: facing,
      hp: d.vida, max: d.vida,
      hit: 0, atk: 0, fall: 0, dead: false, lectura: 0, leido: false
    };
  }

  function drawArena(t) {
    const g = arena.g;
    if (!g) return;
    const W = arena.w, H = arena.h;
    g.clearRect(0, 0, W, H);

    const ground = H - 26;

    /* suelo: línea de cota y polvo tramado */
    g.strokeStyle = MUTED;
    g.globalAlpha = 0.4;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(14, ground + 0.5);
    g.lineTo(W - 14, ground + 0.5);
    g.stroke();
    g.globalAlpha = 0.18;
    g.fillStyle = MUTED;
    for (let y = ground + 5; y < H - 4; y += 4) {
      for (let x = 14 + ((y % 8) ? 2 : 0); x < W - 14; x += 5) {
        g.fillRect(x, y, 1, 1);
      }
    }
    g.globalAlpha = 1;

    if (!C) {
      g.font = '10px "Courier New", monospace';
      g.fillStyle = MUTED;
      g.textAlign = "center";
      g.globalAlpha = 0.75;
      g.fillText("la arena está vacía", W / 2, H / 2 - 6);
      g.font = '9px "Courier New", monospace';
      g.fillText("monta tu autómata y bájalo", W / 2, H / 2 + 10);
      g.globalAlpha = 1;
      return;
    }

    const h = Math.min(H - 60, 190);
    drawAutomaton(g, { cx: W * 0.28, ground: ground, h: h, st: C.you.st, ink: C.you.ink,
                       facing: 1, t: t, hit: C.you.hit, atk: C.you.atk, fall: C.you.fall });
    drawAutomaton(g, { cx: W * 0.72, ground: ground, h: h, st: C.foe.st, ink: C.foe.ink,
                       facing: -1, t: t, hit: C.foe.hit, atk: C.foe.atk, fall: C.foe.fall });

    /* números flotantes */
    g.font = '11px "Courier New", monospace';
    g.textAlign = "center";
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.fillText(p.txt, p.x, p.y - (1 - p.life) * 30);
    }
    g.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════════
     COMBATE
     ════════════════════════════════════════════════════════════ */
  function logLine(txt, cls) {
    const box = document.getElementById("aut-log");
    if (!box) return;
    const p = document.createElement("p");
    p.className = "aut-line" + (cls ? " " + cls : "");
    p.textContent = txt;
    box.appendChild(p);
    while (box.children.length > 90) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() {
    const box = document.getElementById("aut-log");
    if (box) box.innerHTML = "";
  }

  /* pasar de nivel: +2 de materia y de vuelta al banco */
  function nextLevel() {
    S.level = Math.min(RIVALES.length, S.level + 1);
    save();
    C = null;
    phase = "listo";
  }

  function startFight() {
    /* si vienes de ganar y bajas directo, el rival es el siguiente */
    if (phase === "ganado") nextLevel();
    /* volver al primero es empezar una campaña nueva: el trofeo se guarda aparte */
    if (S.level === 1) S.champion = false;
    const rival = RIVALES[S.level - 1];
    C = {
      you: fighter(S.name || "tu autómata", Object.assign({}, S.parts), INK, 1),
      foe: fighter(rival.name, rival.st, INK_FOE, -1),
      round: 0,
      queue: []
    };
    pops.length = 0;
    phase = "combate";
    paused = false;
    clearLog();
    logLine("── nivel " + S.level + " de 5 ──", "aut-sep");
    logLine("enfrente: " + rival.name + " — " + rival.linea, "aut-flavor");
    logLine("suena la campana.", "aut-flavor");
    syncAll();
    schedule(700);
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (phase !== "combate" || paused) return;
    timer = setTimeout(step, ms == null ? (fast ? 260 : 850) : ms);
  }

  function step() {
    if (!C || phase !== "combate") return;

    if (C.queue.length === 0) {
      C.round++;
      logLine("── ronda " + C.round + " ──", "aut-sep");
      const rb = document.getElementById("aut-round");
      if (rb) rb.textContent = "ronda " + C.round;
      /* el paso decide quién abre; empate, a suertes */
      const a = C.you.d.paso + Math.random() * 1.5;
      const b = C.foe.d.paso + Math.random() * 1.5;
      C.queue = a >= b ? ["you", "foe"] : ["foe", "you"];
      /* leer el patrón: la inteligencia se cobra con el tiempo */
      [C.you, C.foe].forEach(function (F) {
        F.lectura = Math.min(F.st.inteligencia * 1.6, (C.round - 1) * F.st.inteligencia * 0.55);
        if (!F.leido && F.lectura >= 4) {
          F.leido = true;
          logLine("› " + F.name + " empieza a leer el patrón", "aut-read");
        }
      });
    }

    const who = C.queue.shift();
    const A = who === "you" ? C.you : C.foe;
    const D = who === "you" ? C.foe : C.you;
    resolve(A, D, who === "you");

    if (C.you.hp <= 0 || C.foe.hp <= 0) { finish(); return; }
    schedule();
  }

  function resolve(A, D, mine) {
    A.atk = 1;
    const px = mine ? arena.w * 0.72 : arena.w * 0.28;
    const py = arena.h - 26 - Math.min(arena.h - 60, 190) * 0.75;

    const chance = Math.max(25, Math.min(96, A.d.punteria + A.lectura - D.d.esquiva));
    if (Math.random() * 100 > chance) {
      logLine("⤬ " + A.name + " falla — " + D.name + " se aparta", "aut-miss");
      pops.push({ x: px, y: py, txt: "—", color: MUTED, life: 1 });
      return;
    }

    const crit = Math.random() * 100 < (A.d.critico + A.lectura / 3);
    const raw = A.d.golpe * (0.88 + Math.random() * 0.24) * (crit ? 1.9 : 1);
    const dmg = Math.max(1, Math.round(raw - D.d.guardia));
    const comido = Math.max(0, Math.round(raw) - dmg);

    D.hp = Math.max(0, D.hp - dmg);
    D.hit = 1;

    if (crit) logLine("✦ cálculo exacto de " + A.name + " — " + dmg + " de daño", "aut-crit");
    else      logLine("› " + A.name + " golpea — " + dmg + " de daño", mine ? "aut-you" : "aut-foe");
    if (comido >= 2) logLine("· la coraza de " + D.name + " se come " + comido, "aut-soak");

    pops.push({ x: px, y: py, txt: (crit ? "✦" : "") + "-" + dmg, color: crit ? "#c0392b" : D.ink, life: 1 });
    syncBars();
  }

  function finish() {
    clearTimeout(timer);
    const youDead = C.you.hp <= 0;
    (youDead ? C.you : C.foe).dead = true;
    syncBars();

    if (youDead) {
      phase = "perdido";
      logLine("── se apaga tu núcleo ──", "aut-sep");
      logLine(C.foe.name + " sigue en pie. Vuelve al banco y repártelo de otro modo.", "aut-flavor");
    } else if (S.level >= RIVALES.length) {
      phase = "campeon";
      S.champion = true;
      save();
      logLine("── cae " + C.foe.name + " ──", "aut-sep");
      logLine("los cinco han caído. Tu autómata es el último en pie.", "aut-win");
    } else {
      phase = "ganado";
      logLine("── cae " + C.foe.name + " ──", "aut-sep");
      logLine("+" + BONUS_NIVEL + " de materia para recalibrar antes del siguiente.", "aut-win");
    }
    syncAll();
  }

  /* ════════════════════════════════════════════════════════════
     INTERFAZ
     ════════════════════════════════════════════════════════════ */
  function buildParts() {
    const box = document.getElementById("aut-parts");
    if (!box) return;
    box.innerHTML = "";
    PARTS.forEach(function (p) {
      const row = document.createElement("div");
      row.className = "aut-part";
      row.dataset.part = p.id;

      const name = document.createElement("span");
      name.className = "ap-name";
      name.textContent = p.label;
      name.title = p.glosa;

      const pips = document.createElement("span");
      pips.className = "ap-pips";
      for (let i = 1; i <= MAX_P; i++) {
        const pip = document.createElement("i");
        pip.dataset.v = String(i);
        pip.title = p.label + " ×" + i;
        pips.appendChild(pip);
      }

      const btns = document.createElement("span");
      btns.className = "ap-btns";
      ["−", "+"].forEach(function (sig, k) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ap-btn";
        b.dataset.d = k ? "1" : "-1";
        b.textContent = sig;
        btns.appendChild(b);
      });

      const der = document.createElement("span");
      der.className = "ap-derived";

      row.appendChild(name);
      row.appendChild(pips);
      row.appendChild(btns);
      row.appendChild(der);
      box.appendChild(row);
    });

    box.addEventListener("click", function (e) {
      const row = e.target.closest ? e.target.closest(".aut-part") : null;
      if (!row) return;
      const id = row.dataset.part;
      if (e.target.classList.contains("ap-btn")) {
        setPart(id, S.parts[id] + Number(e.target.dataset.d));
      } else if (e.target.tagName === "I" && e.target.dataset.v) {
        setPart(id, Number(e.target.dataset.v));
      }
    });
  }

  function flashBudget() {
    const el = document.getElementById("aut-budget");
    if (!el) return;
    el.classList.remove("kal-flash");
    void el.offsetWidth;
    el.classList.add("kal-flash");
  }

  function setPart(id, v) {
    if (phase === "combate") return;
    v = Math.max(MIN_P, Math.min(MAX_P, v));
    const delta = v - S.parts[id];
    if (delta === 0) return;
    if (spent() + delta > budget()) { flashBudget(); return; }
    S.parts[id] = v;
    save();
    syncParts();
  }

  function syncParts() {
    const box = document.getElementById("aut-parts");
    if (!box) return;
    const libre = budget() - spent();
    PARTS.forEach(function (p) {
      const row = box.querySelector('.aut-part[data-part="' + p.id + '"]');
      if (!row) return;
      const v = S.parts[p.id];
      row.querySelectorAll(".ap-pips i").forEach(function (pip, i) {
        pip.classList.toggle("on", i < v);
        pip.classList.toggle("reach", i >= v && i < v + libre);
      });
      row.querySelector(".ap-derived").textContent = derivedText(p.id, S.parts);
      const btns = row.querySelectorAll(".ap-btn");
      btns[0].disabled = v <= MIN_P || phase === "combate";
      btns[1].disabled = v >= MAX_P || libre <= 0 || phase === "combate";
    });
    const bud = document.getElementById("aut-budget");
    if (bud) bud.textContent = "materia " + spent() + " / " + budget() + (libre ? " · " + libre + " libre" : "");
  }

  function syncBars() {
    ["you", "foe"].forEach(function (k) {
      const bar = document.getElementById("aut-bar-" + k);
      if (!bar) return;
      const F = C ? C[k] : null;
      bar.querySelector(".ab-name").textContent = F ? F.name : (k === "you" ? (S.name || "tu autómata") : RIVALES[S.level - 1].name);
      const pct = F ? (F.hp / F.max) * 100 : 100;
      bar.querySelector(".ab-track i").style.width = pct + "%";
      bar.querySelector(".ab-hp").textContent = F ? F.hp + "/" + F.max : "—";
      bar.classList.toggle("low", !!F && pct <= 25);
      bar.classList.toggle("out", !!F && F.hp <= 0);
    });
  }

  function syncLevels() {
    const box = document.getElementById("aut-levels");
    if (!box) return;
    box.innerHTML = "";
    RIVALES.forEach(function (r, i) {
      const n = i + 1;
      const chip = document.createElement("span");
      const done = S.champion || n < S.level;
      chip.className = "aut-lv" + (done ? " done" : "") + (!done && n === S.level ? " now" : "");
      chip.textContent = String(n).padStart(2, "0") + " " + r.name.replace(/^el |^la /, "");
      chip.title = r.linea + "  ·  brazos " + r.st.brazos + " · piernas " + r.st.piernas +
                   " · coraza " + r.st.coraza + " · núcleo " + r.st.nucleo + " · int " + r.st.inteligencia;
      box.appendChild(chip);
    });
  }

  function syncAll() {
    syncParts();
    syncBars();
    syncLevels();

    const lvName = document.getElementById("aut-level-name");
    if (lvName) {
      lvName.textContent = S.champion && phase !== "combate"
        ? "campeón"
        : "nivel " + S.level + " · " + RIVALES[S.level - 1].name;
    }
    const round = document.getElementById("aut-round");
    if (round) round.textContent = C && phase === "combate" ? "ronda " + Math.max(1, C.round) : "—";

    const fightBtn = document.getElementById("aut-fight");
    if (fightBtn) {
      fightBtn.disabled = phase === "combate";
      fightBtn.textContent = phase === "combate" ? "▼ en la arena" : "▼ bajar a la arena";
    }

    const act = document.getElementById("aut-action");
    if (act) {
      act.disabled = false;
      if (phase === "combate")      act.textContent = paused ? "▷ seguir" : "❚❚ pausa";
      else if (phase === "ganado")  act.textContent = "› nivel " + (S.level + 1);
      else if (phase === "perdido") act.textContent = "↺ otra vez";
      else if (phase === "campeon") { act.textContent = "✦ campeón"; act.disabled = true; }
      else                          act.textContent = "▷ empezar";
    }
    const nameIn = document.getElementById("aut-name");
    if (nameIn) nameIn.disabled = phase === "combate";
  }

  /* ── el bucle ── */
  let visible = false, last = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (!visible) return;
    const sec = document.getElementById("sec-automatas");
    if (!sec || !sec.classList.contains("active")) return;

    const t = now / 1000;
    if (C) {
      [C.you, C.foe].forEach(function (F) {
        F.hit = Math.max(0, F.hit - dt * 3.2);
        F.atk = Math.max(0, F.atk - dt * 3.6);
        if (F.dead && F.fall < 1) F.fall = Math.min(1, F.fall + dt * 1.7);
      });
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt * 0.9;
        if (pops[i].life <= 0) pops.splice(i, 1);
      }
    }
    drawPlate(t);
    drawArena(t);
  }

  /* ── medidas: el canvas manda (el contenedor lleva padding) ── */
  function fit(o, ratio) {
    const w = o.cv.clientWidth;
    if (!w) return;
    const h = Math.round(w / ratio);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    o.w = w; o.h = h; o.dpr = dpr;
    o.cv.width = Math.round(w * dpr);
    o.cv.height = Math.round(h * dpr);
    o.cv.style.height = h + "px";
    o.g = o.cv.getContext("2d");
    o.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ── arranque ── */
  function boot() {
    const sec = document.getElementById("sec-automatas");
    if (!sec) return;

    load();

    plate.cv = document.getElementById("aut-figure");
    arena.cv = document.getElementById("aut-arena");
    const plateBox = plate.cv.parentNode, arenaBox = arena.cv.parentNode;

    buildParts();

    const nameIn = document.getElementById("aut-name");
    nameIn.value = S.name;
    nameIn.addEventListener("input", function () {
      S.name = nameIn.value.slice(0, 22);
      save();
      syncBars();
    });

    document.getElementById("aut-fight").addEventListener("click", startFight);

    document.getElementById("aut-action").addEventListener("click", function () {
      if (phase === "combate") {
        paused = !paused;
        if (!paused) schedule(120); else clearTimeout(timer);
        syncAll();
      } else if (phase === "ganado") {
        nextLevel();
        clearLog();
        logLine("nivel " + S.level + " · " + RIVALES[S.level - 1].name, "aut-sep");
        logLine("tienes " + (budget() - spent()) + " de materia sin repartir.", "aut-flavor");
        syncAll();
      } else {
        startFight();
      }
    });

    const fastBtn = document.getElementById("aut-fast");
    fastBtn.addEventListener("click", function () {
      fast = !fast;
      fastBtn.classList.toggle("on", fast);
      fastBtn.setAttribute("aria-pressed", String(fast));
      if (phase === "combate" && !paused) schedule(120);
    });

    document.getElementById("aut-random").addEventListener("click", function () {
      if (phase === "combate") return;
      PARTS.forEach(function (p) { S.parts[p.id] = MIN_P; });
      let left = budget() - PARTS.length * MIN_P;
      let guard = 0;
      while (left > 0 && guard++ < 400) {
        const p = PARTS[Math.floor(Math.random() * PARTS.length)];
        if (S.parts[p.id] >= MAX_P) continue;
        S.parts[p.id]++;
        left--;
      }
      save();
      syncParts();
    });

    document.getElementById("aut-reset").addEventListener("click", function () {
      if (phase === "combate") return;
      clearTimeout(timer);
      S.level = 1;
      S.champion = false;
      PARTS.forEach(function (p) { S.parts[p.id] = MIN_P; });
      S.parts.brazos = 4; S.parts.piernas = 3; S.parts.coraza = 3;
      S.parts.nucleo = 4; S.parts.inteligencia = 2;
      C = null;
      phase = "listo";
      save();
      clearLog();
      logLine("campaña reiniciada — cinco rivales otra vez.", "aut-flavor");
      syncAll();
    });

    let roTimer = 0;
    const ro = new ResizeObserver(function () {
      clearTimeout(roTimer);
      roTimer = setTimeout(function () {
        fit(plate, 1.32);
        fit(arena, 1.9);
      }, 60);
    });
    ro.observe(plateBox);
    ro.observe(arenaBox);

    const io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { visible = en.isIntersecting; });
    }, { threshold: 0.02 });
    io.observe(sec);

    fit(plate, 1.32);
    fit(arena, 1.9);
    syncAll();
    logLine(S.champion ? "ya fuiste campeón: repártelo de nuevo si quieres repetirlo."
                       : "nivel " + S.level + " · " + RIVALES[S.level - 1].name, "aut-sep");
    requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
