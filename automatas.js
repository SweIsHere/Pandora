/* ============================================================
   PANDORA — automatas.js  ·  "Autómatas"
   ------------------------------------------------------------
   1) EL BANCO (lámina de montaje). Repartes una cantidad fija de
      MATERIA entre cinco piezas —brazos, piernas, coraza, núcleo e
      inteligencia—, de 1 a 8 cada una. No hay autómata perfecto:
      el presupuesto obliga a elegir qué clase de bicho eres.

      La lámina no es un icono: el muñeco se DIBUJA con sus números.
      Y esos números SON la física del duelo: las piernas mandan la
      carrera y el salto, los brazos el alcance del filo y el golpe,
      la coraza lo que come de cada impacto, el núcleo la vida y la
      inteligencia el ojo del rival (y su reacción).

   2) EL ESTADIO (tiempo real, a la manera de Nidhogg). Un ruedo
      romano dibujado en ASCII —gradas, arcada, muro y antorchas—
      que se genera solo y hace parallax mientras la cámara sigue
      a los dos autómatas. Nada por turnos: corres, saltas, te
      agachas y estocas.

        A / D  correr        W  saltar        S  agacharse
        P      subir el filo (alta → media → baja → alta)
        CLIC   estocada      (ESPACIO también)

      EL FILO ESTÁ SIEMPRE VIVO. No hace falta atacar para herir:
      si el otro se cruza con tu hoja, se empala (a media fuerza).
      Estocar la lanza más lejos y con todo el peso. Y si los dos
      filos se cruzan A LA MISMA ALTURA, chocan: chispas y los dos
      salen rebotados. De ahí sale el baile —agacharse pasa por
      debajo de una guardia alta, saltar salva una baja— y ésa es
      toda la esgrima que hay: geometría, no tablas.

      Vida = 18 + núcleo·7 · golpe = 3 + brazos·1.7 · guardia =
      coraza·1.05 (resta plana) · alcance = brazos · carrera y
      salto = piernas · crítico = int·3.4 %.

   Cinco rivales en fila; cada uno que cae da +2 de materia para
   recalibrar. Todo persiste en localStorage. Sólo corre con la
   sección en pantalla y se respeta prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  const KEY = "pandora_automatas";
  const MIN_P = 1, MAX_P = 8;
  const BASE_BUDGET = 16, BONUS_NIVEL = 2;
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const INK     = "#243ec4";
  const INK_FOE = "#a5442f";
  const PAPER   = "#f4f1e8";
  const MUTED   = "#8b887e";
  const DARK    = "#2a2a28";
  const SANGRE  = "#c0392b";

  const PARTS = [
    { id: "brazos",       label: "brazos",       glosa: "alcance del filo y peso del golpe" },
    { id: "piernas",      label: "piernas",      glosa: "carrera y salto" },
    { id: "coraza",       label: "coraza",       glosa: "lo que come el blindaje" },
    { id: "nucleo",       label: "núcleo",       glosa: "energía en el pecho" },
    { id: "inteligencia", label: "inteligencia", glosa: "ojo, reacción y cálculo" }
  ];

  /* las tres guardias: fracción de la altura del muñeco */
  const ALTURAS = ["alta", "media", "baja"];
  const SWORD_Y = { alta: 0.80, media: 0.58, baja: 0.36 };
  const SIGNO   = { alta: "▔", media: "─", baja: "▁" };

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
    level: 1,
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
      let guard = 0;
      while (spent() > budget() && guard++ < 200) {
        const top = PARTS.slice().sort((a, b) => S.parts[b.id] - S.parts[a.id])[0];
        if (S.parts[top.id] <= MIN_P) break;
        S.parts[top.id]--;
      }
    } catch (e) {}
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function derive(st) {
    return {
      vida:     Math.round(18 + st.nucleo * 7),
      golpe:    3 + st.brazos * 1.7,
      guardia:  st.coraza * 1.05,
      alcance:  0.42 + st.brazos * 0.018,      /* × altura del muñeco */
      carrera:  0.95 + st.piernas * 0.115,     /* × altura, por segundo */
      salto:    2.75 + st.piernas * 0.095,     /* justo para salvar una guardia baja */
      critico:  st.inteligencia * 3.4,
      reaccion: Math.max(0.09, 0.34 - st.inteligencia * 0.028)
    };
  }

  function derivedText(id, st) {
    const d = derive(st);
    if (id === "brazos")  return "golpe " + d.golpe.toFixed(1) + " · alcance " + Math.round(d.alcance * 100);
    if (id === "piernas") return "carrera " + Math.round(d.carrera * 100) + " · salto " + Math.round(d.salto * 10);
    if (id === "coraza")  return "absorbe " + d.guardia.toFixed(1);
    if (id === "nucleo")  return "vida " + d.vida;
    return "crítico " + Math.round(d.critico) + "% · reacción " + Math.round(d.reaccion * 1000) + "ms";
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* ruido determinista para el ASCII del estadio */
  function h2(a, b) {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177 | 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  /* ════════════════════════════════════════════════════════════
     EL DIBUJO — un autómata hecho de sus propios números
     (0,0) = el suelo entre los pies; hacia arriba, y negativa.
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

  /* codo de dos huesos: dado hombro y muñeca, dobla hacia abajo */
  function elbow(sx, sy, wx, wy, L) {
    const dx = wx - sx, dy = wy - sy;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const half = Math.min(d / 2, L * 0.999);
    const bend = Math.sqrt(Math.max(0, L * L - half * half));
    const mx = sx + dx * 0.5, my = sy + dy * 0.5;
    let px = -dy / d, py = dx / d;
    if (py < 0) { px = -px; py = -py; }        /* que el codo caiga hacia abajo */
    return [mx + px * bend, my + py * bend];
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

  /* opt: { cx, ground, h, st, ink, facing, t, hit, fall, altura,
            lunge, crouch, recoil, stride, reach } */
  function drawAutomaton(g, opt) {
    const st = opt.st, h = opt.h, f = opt.facing, t = opt.t;
    const m = metrics(st, h);
    const hit = opt.hit || 0, fall = opt.fall || 0;
    const lunge = opt.lunge || 0, crouch = opt.crouch || 0, recoil = opt.recoil || 0;
    const stride = opt.stride || 0;
    const altura = opt.altura || "media";
    const squash = 1 - 0.34 * crouch;

    m.legLen *= squash;
    m.torsoH *= 1 - 0.10 * crouch;

    const shake = hit > 0 ? (Math.random() - 0.5) * h * 0.035 * hit : 0;
    const lean  = f * h * (0.07 * lunge - 0.05 * recoil);
    const ink   = hit > 0.55 ? SANGRE : opt.ink;

    g.save();
    g.translate(opt.cx + shake + lean, opt.ground);
    if (fall > 0) {
      const e = 1 - Math.pow(1 - fall, 3);
      g.rotate(-f * 1.42 * e);
      g.globalAlpha = 1 - e * 0.45;
    }

    const hipY      = -m.legLen;
    const shoulderY = hipY - m.torsoH;
    const headCy    = shoulderY - h * 0.035 * squash - m.headR;

    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = ink;
    g.fillStyle = ink;

    /* ── piernas: pistones que zancadean ── */
    const spread = m.torsoW * (0.30 + crouch * 0.4);
    const legW = Math.max(1.2, h * (0.008 + st.piernas * 0.0016));
    for (let s = -1; s <= 1; s += 2) {
      const swing = Math.sin(stride + (s > 0 ? 0 : Math.PI)) * h * 0.055 * (opt.gait || 0);
      const x = s * spread;
      const kneeY = hipY * 0.48;
      g.lineWidth = legW;
      g.beginPath();
      g.moveTo(x, hipY);
      g.lineTo(x + s * h * (0.014 + crouch * 0.03) + swing * 0.4, kneeY);
      g.lineTo(x + swing, -h * 0.018);
      g.stroke();
      const rungs = 1 + Math.min(3, Math.floor(st.piernas / 2.5));
      g.lineWidth = 1;
      for (let i = 1; i <= rungs; i++) {
        const k = i / (rungs + 1);
        const yy = kneeY + (-h * 0.018 - kneeY) * k;
        const xx = x + s * h * 0.014 * (1 - k) + swing * (0.4 + k * 0.6);
        g.beginPath();
        g.moveTo(xx - h * 0.012, yy);
        g.lineTo(xx + h * 0.012, yy);
        g.stroke();
      }
      g.lineWidth = Math.max(1.6, legW);
      g.beginPath();
      g.moveTo(x + swing - h * 0.026 + f * h * 0.008, 0);
      g.lineTo(x + swing + h * 0.026 + f * h * 0.008, 0);
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

    g.fillStyle = ink;
    for (let i = 0; i < st.coraza; i++) {
      const k = (i + 0.5) / st.coraza;
      const s2 = i % 2 ? 1 : -1;
      const wAt = sw + (hw - sw) * k;
      g.beginPath();
      g.arc(s2 * wAt * 0.82, shoulderY + m.torsoH * k, Math.max(0.9, h * 0.005), 0, Math.PI * 2);
      g.fill();
    }

    /* ── núcleo ── */
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
    if (st.nucleo >= 6) {
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

    /* ── el brazo armado va a donde va el filo ──
       La empuñadura se coloca en la MISMA altura que usa la
       colisión, y el codo se resuelve con dos huesos: el dibujo
       y la física no pueden discrepar. */
    const bladeY = -h * SWORD_Y[altura] * squash;
    const gripX  = f * (h * 0.15 + h * 0.10 * lunge);
    const shX = f * sw * 0.92, shY = shoulderY + h * 0.018;
    const el = elbow(shX, shY, gripX, bladeY, m.armLen * 1.05);

    g.strokeStyle = ink;
    g.lineWidth = m.armW;
    g.beginPath();
    g.moveTo(shX, shY);
    g.lineTo(el[0], el[1]);
    g.lineTo(gripX, bladeY);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.arc(el[0], el[1], m.armW * 0.62, 0, Math.PI * 2);
    g.stroke();

    /* ── la hoja ── */
    (function () {
      const tipX = f * (opt.reach != null ? opt.reach : h * 0.5);
      const tilt = altura === "alta" ? -h * 0.045 : altura === "baja" ? h * 0.035 : -h * 0.008;
      const tipY = bladeY + tilt;
      const dx = tipX - gripX, dy = tipY - bladeY;
      const n = Math.hypot(dx, dy) || 1;
      const gx = -dy / n, gy = dx / n, gl = h * 0.028;

      g.strokeStyle = ink;
      g.lineWidth = Math.max(1.4, h * 0.008);
      g.beginPath();
      g.moveTo(gripX + gx * gl, bladeY + gy * gl);
      g.lineTo(gripX - gx * gl, bladeY - gy * gl);
      g.stroke();

      g.lineWidth = Math.max(1.8, h * 0.011);
      g.beginPath();
      g.moveTo(gripX, bladeY);
      g.lineTo(tipX, tipY);
      g.stroke();
      g.strokeStyle = PAPER;
      g.globalAlpha = 0.5;
      g.lineWidth = Math.max(0.6, h * 0.003);
      g.beginPath();
      g.moveTo(gripX + dx * 0.18 + gx * 0.7, bladeY + dy * 0.18 + gy * 0.7);
      g.lineTo(tipX - dx * 0.08 + gx * 0.7, tipY - dy * 0.08 + gy * 0.7);
      g.stroke();
      g.globalAlpha = 1;

      if (lunge > 0.12) {
        g.strokeStyle = ink;
        g.globalAlpha = 0.20 * lunge;
        g.lineWidth = Math.max(1, h * 0.022);
        g.beginPath();
        g.moveTo(gripX - f * h * 0.12, bladeY + h * 0.02);
        g.lineTo(tipX, tipY);
        g.stroke();
        g.globalAlpha = 1;
      }
    })();

    /* ── el brazo libre: sigue siendo garra ── */
    (function () {
      const s = -f;
      const th1 = -0.22 - Math.sin(stride) * 0.35 * (opt.gait || 0) - crouch * 0.3;
      const th2 = th1 + 0.55;
      const bshX = s * sw * 0.92, bshY = shoulderY + h * 0.018;
      const ex = bshX + f * Math.sin(th1) * m.armLen + s * m.armLen * 0.14;
      const ey = bshY + Math.cos(th1) * m.armLen;
      const wx = ex + f * Math.sin(th2) * m.armLen;
      const wy = ey + Math.cos(th2) * m.armLen;
      g.strokeStyle = ink;
      g.lineWidth = m.armW * 0.9;
      g.beginPath();
      g.moveTo(bshX, bshY);
      g.lineTo(ex, ey);
      g.lineTo(wx, wy);
      g.stroke();
      const prongs = st.brazos >= 6 ? 3 : 2;
      const dir = Math.atan2(wy - ey, wx - ex);
      g.lineWidth = Math.max(1, m.armW * 0.5);
      for (let p = 0; p < prongs; p++) {
        const sa = (p - (prongs - 1) / 2) * 0.42;
        const len = m.armLen * (0.28 + st.brazos * 0.020);
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + Math.cos(dir + sa) * len, wy + Math.sin(dir + sa) * len);
        g.stroke();
      }
    })();

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

    const eyes = Math.max(1, Math.min(3, 1 + Math.floor(st.inteligencia / 3)));
    const er = Math.max(1.1, m.headR * 0.16);
    g.fillStyle = ink;
    for (let i = 0; i < eyes; i++) {
      const ox = (i - (eyes - 1) / 2) * m.headR * 0.52 + f * m.headR * 0.22;
      g.beginPath();
      g.arc(ox, headCy, er, 0, Math.PI * 2);
      g.fill();
    }

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
     LA LÁMINA — el banco de montaje
     ════════════════════════════════════════════════════════════ */
  const plate = { cv: null, g: null, w: 0, h: 0 };

  function drawPlate(t) {
    const g = plate.g;
    if (!g) return;
    const W = plate.w, H = plate.h;
    g.clearRect(0, 0, W, H);

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
    const d = derive(S.parts);
    drawAutomaton(g, { cx: cx, ground: ground, h: h, st: S.parts, ink: INK, facing: 1,
                       t: t, altura: guardia, reach: h * d.alcance });

    const m = metrics(S.parts, h);
    const hipY = ground - m.legLen, shoulderY = hipY - m.torsoH;
    const rot = [
      { txt: "inteligencia ×" + S.parts.inteligencia, x: cx + m.headR * 1.4, y: shoulderY - h * 0.035 - m.headR * 1.6, side: 1 },
      { txt: "brazos ×" + S.parts.brazos,   x: cx + h * d.alcance * 0.75, y: ground - h * SWORD_Y[guardia], side: 1 },
      { txt: "coraza ×" + S.parts.coraza,   x: cx - m.torsoW * 0.5, y: shoulderY + m.torsoH * 0.22, side: -1 },
      { txt: "núcleo ×" + S.parts.nucleo,   x: cx - m.torsoW * 0.5, y: shoulderY + m.torsoH * 0.42, side: -1 },
      { txt: "piernas ×" + S.parts.piernas, x: cx - m.torsoW * 0.35, y: hipY + m.legLen * 0.55, side: -1 }
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

    g.globalAlpha = 0.8;
    g.textAlign = "left";
    g.fillStyle = MUTED;
    g.fillText("lámina " + String(S.level).padStart(2, "0") + " · " + (S.name || "sin nombre"), pad + 6, H - 18);
    g.textAlign = "right";
    g.fillText("materia " + spent() + "/" + budget(), W - pad - 6, H - 18);
    g.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════════
     EL ESTADIO — un ruedo romano en ASCII
     Se pinta UNA vez en un lienzo aparte (ancho de mundo × 0.6,
     que es su parallax) y luego sólo se desplaza. Encima, en vivo,
     el gentío que parpadea, las antorchas y la arena del suelo.
     ════════════════════════════════════════════════════════════ */
  const arena = { cv: null, g: null, w: 0, h: 0 };
  const stage = { bg: null, bgW: 0, worldW: 0, groundY: 0, cellW: 6, cellH: 9,
                  crowd: [], torches: [], parallax: 0.55, roar: 0, shake: 0 };

  function paintStadium() {
    const W = arena.w, H = arena.h;
    if (!W || !H) return;
    stage.worldW = Math.max(Math.round(W * 2.6), 1500);
    stage.groundY = Math.round(H * 0.86);

    const off = document.createElement("canvas");
    const bgW = Math.ceil(W + (stage.worldW - W) * stage.parallax + 40);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    off.width = Math.round(bgW * dpr);
    off.height = Math.round(H * dpr);
    const g = off.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);   /* el ASCII, a pixel de pantalla */

    const fs = Math.max(8, Math.round(H / 26));
    g.font = fs + 'px "Courier New", monospace';
    g.textBaseline = "middle";
    g.textAlign = "center";
    const cw = g.measureText("M").width || fs * 0.6;
    const ch = Math.round(fs * 1.02);
    stage.cellW = cw; stage.cellH = ch;

    const cols = Math.ceil(bgW / cw) + 1;
    const rows = Math.floor(stage.groundY / ch);

    /* bandas, de arriba abajo */
    const rBand   = 1;                                  /* banderas */
    const rGrada  = Math.max(3, Math.round(rows * 0.42));
    const gradaA  = rBand, gradaB = gradaA + rGrada;
    const cornisa = gradaB;
    const arcadaA = cornisa + 1, arcadaB = arcadaA + 3;

    stage.crowd.length = 0;
    stage.torches.length = 0;

    /* velo de piedra detrás de las gradas: da fondo a los
       caracteres para que no se pierdan sobre el papel */
    g.globalAlpha = 0.07;
    g.fillStyle = DARK;
    g.fillRect(0, 0, bgW, stage.groundY);
    g.globalAlpha = 0.05;
    g.fillRect(0, (arcadaA - 1) * ch, bgW, stage.groundY - (arcadaA - 1) * ch);
    g.globalAlpha = 1;

    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw / 2;
      for (let r = 0; r < rows; r++) {
        const y = r * ch + ch / 2;
        const n = h2(c, r);
        let ch2 = null, col = DARK, al = 0.72;

        if (r < rBand) {
          /* estandartes en tinta, colgando del borde */
          if (c % 13 === 5) { ch2 = "▛"; col = INK; al = 0.85; }
          else if (c % 13 === 6) { ch2 = "▜"; col = INK; al = 0.6; }
          else if (c % 13 === 7) { ch2 = "│"; col = MUTED; al = 0.5; }
        } else if (r < gradaB) {
          /* gradas: escaleras cada 11 columnas, gentío en el resto */
          if (c % 11 === 0) { ch2 = "║"; col = DARK; al = 0.5; }
          else if (n < 0.80) {
            /* las filas de arriba, más pequeñas y claras (perspectiva) */
            const lejos = (r - gradaA) / Math.max(1, rGrada - 1);
            ch2 = n < 0.28 ? "●" : (n < 0.52 ? "o" : (n < 0.68 ? "▪" : "•"));
            col = n < 0.28 ? DARK : MUTED;
            al = 0.42 + (1 - lejos) * 0.42;
            if (n < 0.46) stage.crowd.push([x, y]);
          }
        } else if (r === cornisa) {
          ch2 = "═"; col = DARK; al = 0.9;
        } else if (r < arcadaB) {
          /* arcada: pilar, arranque de arco y vano oscuro */
          const k = c % 6, rr2 = r - arcadaA;
          if (rr2 === 0) ch2 = k === 0 ? "║" : (k === 1 ? "╔" : (k === 5 ? "╗" : "═"));
          else ch2 = (k === 0) ? "║" : (k === 1 || k === 5 ? "║" : (rr2 === 2 && n < 0.12 ? "▪" : null));
          col = DARK;
          al = 0.85;
        } else {
          /* muro del podio, con antorchas encendidas */
          if (c % 9 === 4 && r === arcadaB) {
            ch2 = "╪"; col = DARK; al = 0.85;
            stage.torches.push([x, y - ch]);
          } else {
            ch2 = n < 0.18 ? "█" : (n < 0.55 ? "▓" : "▒");
            col = DARK;
            al = 0.46 + n * 0.26;
          }
        }

        if (!ch2) continue;
        g.globalAlpha = al;
        g.fillStyle = col;
        g.fillText(ch2, x, y);
      }
    }

    /* línea de la arena, marcada */
    g.globalAlpha = 0.85;
    g.strokeStyle = DARK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, stage.groundY + 1);
    g.lineTo(bgW, stage.groundY + 1);
    g.stroke();
    g.globalAlpha = 1;

    stage.bg = off;
    stage.bgW = bgW;
    stage.bgH = H;
  }

  function drawStage(t, camX) {
    const g = arena.g, W = arena.w, H = arena.h;
    if (stage.bg) {
      g.drawImage(stage.bg, -Math.round(camX * stage.parallax), 0, stage.bgW, stage.bgH);
    }

    /* el gentío respira; cuando alguien sangra, ruge */
    const fs = Math.max(8, Math.round(H / 26));
    g.font = fs + 'px "Courier New", monospace';
    g.textBaseline = "middle";
    g.textAlign = "center";
    const off = camX * stage.parallax;
    const roar = stage.roar;
    for (let i = 0; i < stage.crowd.length; i++) {
      const p = stage.crowd[i];
      const sx = p[0] - off;
      if (sx < -8 || sx > W + 8) continue;
      const ph = Math.sin(t * (1.4 + (i % 5) * 0.2) + i * 1.7);
      if (roar <= 0.02 && ph < 0.7) continue;
      g.globalAlpha = roar > 0.02 ? 0.45 + roar * 0.5 : 0.5;
      g.fillStyle = roar > 0.4 ? SANGRE : DARK;
      /* en la ovación el gentío se pone en pie: sube y se agranda */
      g.fillText(roar > 0.4 ? "◉" : "●", sx, p[1] - roar * 3);
    }

    /* antorchas */
    for (let i = 0; i < stage.torches.length; i++) {
      const p = stage.torches[i];
      const sx = p[0] - off;
      if (sx < -8 || sx > W + 8) continue;
      const f = Math.sin(t * 9 + i * 2.1);
      g.globalAlpha = 0.7 + 0.3 * f;
      g.fillStyle = f > 0.2 ? "#d2761f" : SANGRE;
      g.fillText(f > 0 ? "▲" : "◆", sx, p[1]);
    }
    g.globalAlpha = 1;

    /* la arena del suelo, a velocidad real */
    g.fillStyle = MUTED;
    const gy = stage.groundY;
    for (let y = gy + 5; y < H; y += 5) {
      const step = 7;
      const first = Math.floor(camX / step) * step;
      for (let wx = first; wx < camX + W + step; wx += step) {
        const n = h2(Math.round(wx / step), y);
        if (n > 0.55) continue;
        g.globalAlpha = 0.10 + n * 0.25;
        g.fillRect(Math.round(wx - camX) + (y % 10 ? 2 : 0), y, n < 0.2 ? 2 : 1, 1);
      }
    }
    g.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════════
     EL PÚBLICO — ovación sintetizada, sin un solo fichero
     Una ovación no es más que ruido filtrado con envolvente: la
     banda de 700–1600 Hz son las voces, y un barrido rápido del
     filtro hacia arriba y vuelta es el "ooooh" que sube y cae.
     Encima, un puñado de estallidos cortos en agudos = palmas.
     El AudioContext nace dentro de un gesto (política de autoplay)
     y hay un murmullo de fondo mientras dura el duelo.
     ════════════════════════════════════════════════════════════ */
  const SND_KEY = "pandora_aut_sonido";
  const SND = { ac: null, master: null, noise: null, murmur: null, murGain: null, on: true };

  try { SND.on = localStorage.getItem(SND_KEY) !== "0"; } catch (e) {}

  function ensureAudio() {
    if (!SND.on) return null;
    if (SND.ac) {
      if (SND.ac.state === "suspended") SND.ac.resume();
      return SND.ac;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    SND.ac = ac;

    const master = ac.createGain();
    master.gain.value = 0.85;
    if (ac.createDynamicsCompressor) {
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 8;
      master.connect(comp); comp.connect(ac.destination);
    } else master.connect(ac.destination);
    SND.master = master;

    /* dos segundos de ruido rosado, la materia prima de todo */
    const len = Math.floor(ac.sampleRate * 2);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.28;
    }
    SND.noise = buf;

    /* murmullo: el ruedo lleno, esperando */
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.6;
    const gm = ac.createGain(); gm.gain.value = 0;
    src.connect(bp); bp.connect(gm); gm.connect(master);
    /* respiración lenta del gentío */
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ac.createGain(); lg.gain.value = 0.35;
    lfo.connect(lg); lg.connect(gm.gain);
    src.start(); lfo.start();
    SND.murmur = src; SND.murGain = gm;
    return ac;
  }

  function murmullo(v) {
    if (!SND.ac || !SND.murGain) return;
    const t = SND.ac.currentTime;
    SND.murGain.gain.cancelScheduledValues(t);
    SND.murGain.gain.setTargetAtTime(v, t, 0.6);
  }

  /* ovación: intensidad 0..1.5 */
  function ovacion(fuerza) {
    const ac = SND.ac;
    if (!ac || !SND.noise) return;
    const t = ac.currentTime;
    const f = clamp(fuerza, 0.15, 1.5);
    const cola = 0.75 + f * 1.15;

    const voces = ac.createBufferSource();
    voces.buffer = SND.noise; voces.loop = true;
    voces.playbackRate.value = 0.85 + Math.random() * 0.3;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.75;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.linearRampToValueAtTime(1450 + f * 350, t + 0.14);
    bp.frequency.linearRampToValueAtTime(520, t + cola);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30 * f, t + 0.055);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cola);
    voces.connect(bp); bp.connect(g); g.connect(SND.master);
    voces.start(t, Math.random() * 1.4);
    voces.stop(t + cola + 0.1);

    /* palmas: ruido agudo troceado por un tremolo rápido */
    const palmas = ac.createBufferSource();
    palmas.buffer = SND.noise; palmas.loop = true;
    palmas.playbackRate.value = 1.4;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2100;
    const gp = ac.createGain();
    gp.gain.setValueAtTime(0.0001, t);
    gp.gain.exponentialRampToValueAtTime(0.14 * f, t + 0.09);
    gp.gain.exponentialRampToValueAtTime(0.0001, t + cola * 0.8);
    const trem = ac.createOscillator();
    trem.type = "square"; trem.frequency.value = 17 + Math.random() * 9;
    const tg = ac.createGain(); tg.gain.value = 0.09 * f;
    trem.connect(tg); tg.connect(gp.gain);
    palmas.connect(hp); hp.connect(gp); gp.connect(SND.master);
    palmas.start(t, Math.random() * 1.4); trem.start(t);
    palmas.stop(t + cola); trem.stop(t + cola);
  }

  /* el golpe seco de la hoja contra la chapa */
  function sonarImpacto(fuerza) {
    const ac = SND.ac;
    if (!ac || !SND.noise) return;
    const t = ac.currentTime;
    const f = clamp(fuerza, 0.3, 1.4);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.32 * f, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(SND.master);
    o.start(t); o.stop(t + 0.22);

    const n = ac.createBufferSource();
    n.buffer = SND.noise;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 1.2;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.20 * f, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    n.connect(bp); bp.connect(gn); gn.connect(SND.master);
    n.start(t, Math.random()); n.stop(t + 0.14);
  }

  /* acero contra acero */
  function sonarChoque() {
    const ac = SND.ac;
    if (!ac) return;
    const t = ac.currentTime;
    [2180, 3170, 4630].forEach(function (fr, i) {
      const o = ac.createOscillator();
      o.type = i ? "triangle" : "square";
      o.frequency.value = fr * (0.97 + Math.random() * 0.06);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34 - i * 0.08);
      o.connect(g); g.connect(SND.master);
      o.start(t); o.stop(t + 0.36);
    });
    ovacion(0.3);
  }

  /* el silbido de la estocada al aire */
  function sonarEstocada() {
    const ac = SND.ac;
    if (!ac || !SND.noise) return;
    const t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = SND.noise;
    n.playbackRate.value = 1.6;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.13);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp); bp.connect(g); g.connect(SND.master);
    n.start(t, Math.random()); n.stop(t + 0.18);
  }

  /* ════════════════════════════════════════════════════════════
     EL DUELO — tiempo real
     ════════════════════════════════════════════════════════════ */
  let D = null;                  /* duelo en curso */
  let phase = "listo";           /* listo · duelo · ganado · perdido · campeon */
  let guardia = "media";
  const pops = [];
  const chispas = [];
  const keys = Object.create(null);
  let lastClashLog = 0;

  const FH_FRAC = 0.46;          /* altura del muñeco respecto al alto del lienzo */
  const ATK_DUR = 0.28;
  const ATK_CD  = 0.13;

  function fighter(name, st, ink, face, x) {
    const d = derive(st);
    return {
      name: name, st: st, d: d, ink: ink, face: face,
      x: x, y: 0, vx: 0, vy: 0,
      hp: d.vida, max: d.vida,
      altura: "media", crouch: false, onGround: true,
      atkT: 0, cd: 0, stun: 0, inv: 0, hit: 0, recoil: 0,
      stride: 0, gait: 0, dead: false, fall: 0,
      think: 0, want: 0, wantJump: false, wantCrouch: false, wantAtk: false
    };
  }

  function FH() { return arena.h * FH_FRAC; }

  /* geometría viva: cuerpo y filo, tal como se dibujan */
  function bodyBox(F) {
    const h = FH();
    const feet = stage.groundY - F.y;
    const alto = h * (F.crouch ? 0.66 : 0.98);
    return { x0: F.x - h * 0.13, x1: F.x + h * 0.13, y0: feet - alto, y1: feet };
  }
  function bladeSeg(F) {
    const h = FH();
    const feet = stage.groundY - F.y;
    const squash = F.crouch ? 0.66 : 1;
    const p = F.atkT > 0 ? 1 - F.atkT / ATK_DUR : 0;
    const ext = F.atkT > 0 ? Math.sin(Math.min(1, p * 1.5) * Math.PI) : 0;
    const reach = h * (F.d.alcance + 0.26 * ext);
    return {
      y: feet - h * SWORD_Y[F.altura] * squash,
      x0: F.x + F.face * h * 0.15,
      x1: F.x + F.face * reach,
      ext: ext,
      reach: reach
    };
  }
  function overlapX(a0, a1, b0, b1) {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    const lo2 = Math.min(b0, b1), hi2 = Math.max(b0, b1);
    return hi >= lo2 && hi2 >= lo;
  }

  function logLine(txt, cls) {
    const box = document.getElementById("aut-log");
    if (!box) return;
    const p = document.createElement("p");
    p.className = "aut-line" + (cls ? " " + cls : "");
    p.textContent = txt;
    box.appendChild(p);
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() {
    const box = document.getElementById("aut-log");
    if (box) box.innerHTML = "";
  }

  function nextLevel() {
    S.level = Math.min(RIVALES.length, S.level + 1);
    save();
    D = null;
    phase = "listo";
  }

  function startFight() {
    if (!arena.h) return;
    if (phase === "ganado") nextLevel();
    if (S.level === 1) S.champion = false;
    const rival = RIVALES[S.level - 1];
    const yo = fighter(S.name || "tu autómata", Object.assign({}, S.parts), INK, 1, stage.worldW * 0.32);
    const ri = fighter(rival.name, rival.st, INK_FOE, -1, stage.worldW * 0.68);
    yo.altura = guardia;
    D = { you: yo, foe: ri, camX: 0, t: 0 };
    D.camX = clamp((yo.x + ri.x) / 2 - arena.w / 2, 0, stage.worldW - arena.w);
    pops.length = 0;
    chispas.length = 0;
    phase = "duelo";
    ensureAudio();
    murmullo(0.075);
    ovacion(0.5);
    clearLog();
    logLine("── nivel " + S.level + " de 5 ──", "aut-sep");
    logLine("enfrente: " + rival.name + " — " + rival.linea, "aut-flavor");
    logLine("el gentío se calla. A D correr · W saltar · S agachar · P filo · clic estocar", "aut-flavor");
    syncAll();
  }

  /* ── la cabeza del rival ── */
  function think(F, O, dt) {
    F.think -= dt;
    if (F.think > 0) return;
    F.think = F.d.reaccion * (0.7 + Math.random() * 0.7);

    const h = FH();
    const dx = O.x - F.x;
    const ad = Math.abs(dx);
    const dir = dx > 0 ? 1 : -1;
    const rango = h * (F.d.alcance + 0.18) + h * 0.13;
    const listo = F.st.inteligencia >= 5;
    const bravo = 0.32 + F.st.brazos * 0.055;

    /* espaciado: acercarse, mantener la punta o cortar distancia */
    if (ad > rango * 1.12) F.want = dir;
    else if (ad < rango * 0.62) F.want = -dir * (Math.random() < 0.75 ? 1 : 0);
    else F.want = Math.random() < 0.35 ? dir : 0;

    /* si va muy tocado y piensa, se retira a recomponerse */
    if (listo && F.hp / F.max < 0.28 && Math.random() < 0.5) F.want = -dir;

    /* el filo: buscar lo que el otro deja descubierto */
    const oBlade = bladeSeg(O);
    let alt;
    if (O.crouch)      alt = Math.random() < 0.8 ? "baja" : "media";
    else if (O.y > h * 0.12) alt = Math.random() < 0.8 ? "alta" : "media";
    else if (listo && O.atkT > 0) alt = O.altura;            /* cruzar aceros a propósito */
    else if (listo)    alt = Math.random() < 0.6 ? O.altura : ALTURAS[Math.floor(Math.random() * 3)];
    else               alt = ALTURAS[Math.floor(Math.random() * 3)];
    F.altura = alt;

    /* esquivas: agacharse bajo una guardia alta, saltar sobre una baja */
    F.wantCrouch = false;
    F.wantJump = false;
    if (ad < rango * 1.35 && O.atkT > 0 && listo) {
      if (O.altura === "alta" && Math.random() < 0.65) F.wantCrouch = true;
      else if (O.altura === "baja" && Math.random() < 0.6) F.wantJump = true;
    } else if (F.st.piernas >= 6 && Math.random() < 0.14) F.wantJump = true;

    /* estocar cuando la punta llega */
    F.wantAtk = ad < rango * 1.05 && ad > h * 0.2 && Math.random() < bravo + (oBlade.ext > 0 ? 0.1 : 0);
  }

  function attackNow(F) {
    if (F.atkT > 0 || F.cd > 0 || F.stun > 0 || F.dead) return;
    F.atkT = ATK_DUR;
    F.cd = ATK_DUR + ATK_CD;
    F.vx += F.face * FH() * 2.1;
    sonarEstocada();
  }

  function stepFighter(F, O, dt, mine) {
    const h = FH();
    F.cd = Math.max(0, F.cd - dt);
    F.inv = Math.max(0, F.inv - dt);
    F.stun = Math.max(0, F.stun - dt);
    F.hit = Math.max(0, F.hit - dt * 3.2);
    F.recoil = Math.max(0, F.recoil - dt * 3.4);
    if (F.atkT > 0) F.atkT = Math.max(0, F.atkT - dt);
    if (F.dead) { F.fall = Math.min(1, F.fall + dt * 1.7); return; }

    F.face = O.x >= F.x ? 1 : -1;

    /* voluntad */
    let mov = 0, quiere = false, agacha = false;
    if (F.stun <= 0) {
      if (mine) {
        mov = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
        quiere = !!keys["w"];
        agacha = !!keys["s"];
      } else {
        mov = F.want;
        quiere = F.wantJump;
        agacha = F.wantCrouch;
        if (F.wantAtk) { attackNow(F); F.wantAtk = false; }
      }
    }

    F.crouch = agacha && F.onGround;
    if (quiere && F.onGround && F.stun <= 0) { F.vy = -h * F.d.salto; F.onGround = false; }

    /* carrera */
    const vmax = h * F.d.carrera * (F.crouch ? 0.42 : 1) * (F.atkT > 0 ? 0.55 : 1);
    if (mov !== 0 && F.stun <= 0) {
      F.vx += mov * vmax * dt * 14;
      F.vx = clamp(F.vx, -vmax * 2.1, vmax * 2.1);
      F.gait = Math.min(1, F.gait + dt * 8);
    } else {
      F.gait = Math.max(0, F.gait - dt * 6);
    }
    F.vx *= Math.pow(F.onGround ? 0.0025 : 0.08, dt);
    F.x += F.vx * dt;
    F.stride += dt * (2 + Math.abs(F.vx) / (h * 0.16));

    /* salto y suelo */
    F.vy += h * 9.2 * dt;
    F.y -= F.vy * dt;
    if (F.y <= 0) { F.y = 0; F.vy = 0; F.onGround = true; }
    else F.onGround = false;

    F.x = clamp(F.x, 26, stage.worldW - 26);

    /* no se atraviesan */
    const sep = h * 0.24;
    const d = F.x - O.x;
    if (Math.abs(d) < sep) {
      const push = (sep - Math.abs(d)) * 0.5 * (d >= 0 ? 1 : -1);
      F.x += push;
      O.x -= push;
    }
  }

  /* chispas y números viven en coordenadas de MUNDO: si no, se
     quedarían pegados a la pantalla mientras la cámara corre */
  function chispa(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 130;
      chispas.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 1, col: col });
    }
  }

  function golpe(A, De, mine) {
    const bs = bladeSeg(A);
    const crit = Math.random() * 100 < A.d.critico;
    const pasivo = A.atkT <= 0;
    const raw = A.d.golpe * (0.9 + Math.random() * 0.2) * (crit ? 1.9 : 1) * (pasivo ? 0.5 : 1);
    const dmg = Math.max(1, Math.round(raw - De.d.guardia));

    De.hp = Math.max(0, De.hp - dmg);
    De.hit = 1;
    De.inv = 0.62;
    De.stun = 0.26;
    De.vx = A.face * FH() * 2.6;
    De.crouch = false;
    stage.roar = 1;
    stage.shake = Math.min(1, 0.5 + dmg / 24);
    sonarImpacto(0.5 + dmg / 16);
    ovacion(0.55 + dmg / 20 + (crit ? 0.4 : 0));

    chispa(bs.x1, bs.y, crit ? 12 : 7, crit ? SANGRE : De.ink);
    pops.push({ x: bs.x1, y: bs.y, txt: (crit ? "✦" : "") + "-" + dmg, color: crit ? SANGRE : De.ink, life: 1 });

    if (pasivo) logLine("· " + De.name + " se empala en el filo " + A.altura + " — " + dmg, mine ? "aut-you" : "aut-foe");
    else if (crit) logLine("✦ cálculo exacto — " + A.name + " entra " + A.altura + ": " + dmg, "aut-crit");
    else logLine("⚔ " + A.name + " entra " + A.altura + " — " + dmg + " de daño", mine ? "aut-you" : "aut-foe");

    syncBars();
    if (De.hp <= 0) finish(De);
  }

  function collide() {
    const yo = D.you, ri = D.foe;
    if (yo.dead || ri.dead) return;
    const a = bladeSeg(yo), b = bladeSeg(ri);
    const h = FH();

    /* acero contra acero: misma altura y las hojas se cruzan */
    if (Math.abs(a.y - b.y) < h * 0.09 && overlapX(a.x0, a.x1, b.x0, b.x1)) {
      const mid = (Math.max(Math.min(a.x0, a.x1), Math.min(b.x0, b.x1)) +
                   Math.min(Math.max(a.x0, a.x1), Math.max(b.x0, b.x1))) / 2;
      chispa(mid, a.y, 10, SANGRE);
      [yo, ri].forEach(function (F) {
        F.vx = -F.face * h * 2.1;
        F.stun = 0.16;
        F.recoil = 1;
        F.atkT = 0;
        F.cd = Math.max(F.cd, 0.22);
      });
      stage.shake = Math.max(stage.shake, 0.45);
      stage.roar = Math.max(stage.roar, 0.55);
      sonarChoque();
      const now = performance.now();
      if (now - lastClashLog > 700) {
        lastClashLog = now;
        logLine("✕ los aceros chocan en guardia " + yo.altura, "aut-clash");
      }
      return;
    }

    /* filo contra cuerpo */
    const pares = [[yo, ri, a, true], [ri, yo, b, false]];
    for (let i = 0; i < pares.length; i++) {
      const A = pares[i][0], De = pares[i][1], bs = pares[i][2], mine = pares[i][3];
      if (De.inv > 0 || De.dead || A.dead) continue;
      const bb = bodyBox(De);
      if (bs.y >= bb.y0 && bs.y <= bb.y1 && overlapX(bs.x0, bs.x1, bb.x0, bb.x1)) {
        golpe(A, De, mine);
      }
    }
  }

  function finish(caido) {
    caido.dead = true;
    const youDead = caido === D.you;
    stage.roar = 1;
    /* el ruedo entero se viene abajo */
    ovacion(youDead ? 0.8 : 1.5);
    murmullo(0);
    syncBars();
    if (youDead) {
      phase = "perdido";
      logLine("── se apaga tu núcleo ──", "aut-sep");
      logLine(D.foe.name + " sigue en pie. Vuelve al banco y repártelo de otro modo.", "aut-flavor");
    } else if (S.level >= RIVALES.length) {
      phase = "campeon";
      S.champion = true;
      save();
      logLine("── cae " + D.foe.name + " ──", "aut-sep");
      logLine("los cinco han caído. El ruedo entero se pone en pie.", "aut-win");
    } else {
      phase = "ganado";
      logLine("── cae " + D.foe.name + " ──", "aut-sep");
      logLine("+" + BONUS_NIVEL + " de materia para recalibrar antes del siguiente.", "aut-win");
    }
    syncAll();
  }

  function stepDuel(dt) {
    D.t += dt;
    const yo = D.you, ri = D.foe;
    yo.altura = guardia;
    if (phase === "duelo") think(ri, yo, dt);
    stepFighter(yo, ri, dt, true);
    stepFighter(ri, yo, dt, false);
    if (phase === "duelo") collide();

    /* cámara: el punto medio, con holgura */
    const mid = (yo.x + ri.x) / 2;
    const target = clamp(mid - arena.w / 2, 0, Math.max(0, stage.worldW - arena.w));
    D.camX += (target - D.camX) * Math.min(1, dt * 5.5);
  }

  function drawDuel(t) {
    const g = arena.g, W = arena.w, H = arena.h;
    const h = FH();
    const yo = D.you, ri = D.foe;

    [yo, ri].forEach(function (F) {
      const p = F.atkT > 0 ? 1 - F.atkT / ATK_DUR : 0;
      const lunge = F.atkT > 0 ? Math.sin(Math.min(1, p * 1.5) * Math.PI) : 0;
      drawAutomaton(g, {
        cx: F.x - D.camX, ground: stage.groundY - F.y, h: h, st: F.st, ink: F.ink,
        facing: F.face, t: t, hit: F.hit, fall: F.fall, altura: F.altura,
        lunge: lunge, crouch: F.crouch ? 1 : 0, recoil: F.recoil,
        stride: F.stride, gait: F.gait, reach: bladeSeg(F).reach
      });
      /* sombra en la arena cuando vuela */
      if (F.y > 2) {
        g.globalAlpha = 0.16;
        g.fillStyle = DARK;
        g.beginPath();
        g.ellipse(F.x - D.camX, stage.groundY + 2, h * 0.16, h * 0.03, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    });

    /* chispas */
    for (let i = 0; i < chispas.length; i++) {
      const c = chispas[i];
      g.globalAlpha = Math.max(0, c.life);
      g.fillStyle = c.col;
      g.fillRect(c.x - D.camX, c.y, 2, 2);
    }
    g.globalAlpha = 1;

    /* números */
    g.font = '11px "Courier New", monospace';
    g.textAlign = "center";
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.fillText(p.txt, p.x - D.camX, p.y - (1 - p.life) * 34);
    }
    g.globalAlpha = 1;

    /* flechas al borde si el rival se sale de cuadro */
    const rx = ri.x - D.camX;
    if (rx < 6 || rx > W - 6) {
      g.fillStyle = INK_FOE;
      g.globalAlpha = 0.75;
      g.font = '12px "Courier New", monospace';
      g.fillText(rx < 6 ? "◄" : "►", rx < 6 ? 10 : W - 10, stage.groundY - h * 0.5);
      g.globalAlpha = 1;
    }
  }

  function drawArena(t) {
    const g = arena.g;
    if (!g || !stage.groundY) return;
    const W = arena.w, H = arena.h;
    g.clearRect(0, 0, W, H);

    g.save();
    if (stage.shake > 0.01) {
      g.translate((Math.random() - 0.5) * 7 * stage.shake, (Math.random() - 0.5) * 5 * stage.shake);
    }
    drawStage(t, D ? D.camX : 0);
    if (D) drawDuel(t);
    else {
      g.font = '10px "Courier New", monospace';
      g.fillStyle = MUTED;
      g.textAlign = "center";
      g.globalAlpha = 0.8;
      g.fillText("el ruedo está vacío", W / 2, stage.groundY - 34);
      g.font = '9px "Courier New", monospace';
      g.fillText("monta tu autómata y bájalo a la arena", W / 2, stage.groundY - 20);
      g.globalAlpha = 1;
    }
    g.restore();
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
      if (e.target.classList.contains("ap-btn")) setPart(id, S.parts[id] + Number(e.target.dataset.d));
      else if (e.target.tagName === "I" && e.target.dataset.v) setPart(id, Number(e.target.dataset.v));
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
    if (phase === "duelo") return;
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
      btns[0].disabled = v <= MIN_P || phase === "duelo";
      btns[1].disabled = v >= MAX_P || libre <= 0 || phase === "duelo";
    });
    const bud = document.getElementById("aut-budget");
    if (bud) bud.textContent = "materia " + spent() + " / " + budget() + (libre ? " · " + libre + " libre" : "");
  }

  function syncBars() {
    ["you", "foe"].forEach(function (k) {
      const bar = document.getElementById("aut-bar-" + k);
      if (!bar) return;
      const F = D ? D[k] : null;
      bar.querySelector(".ab-name").textContent = F ? F.name : (k === "you" ? (S.name || "tu autómata") : RIVALES[S.level - 1].name);
      const pct = F ? (F.hp / F.max) * 100 : 100;
      bar.querySelector(".ab-track i").style.width = pct + "%";
      bar.querySelector(".ab-hp").textContent = F ? F.hp + "/" + F.max : "—";
      bar.classList.toggle("low", !!F && pct <= 25);
      bar.classList.toggle("out", !!F && F.hp <= 0);
    });
  }

  function syncGuard() {
    document.querySelectorAll(".ac-h").forEach(function (b) {
      b.classList.toggle("on", b.dataset.h === guardia);
      b.setAttribute("aria-pressed", String(b.dataset.h === guardia));
    });
    const badge = document.getElementById("aut-round");
    if (badge) badge.textContent = SIGNO[guardia] + " filo " + guardia;
    if (D) D.you.altura = guardia;
  }

  function cycleGuard(dir) {
    const i = ALTURAS.indexOf(guardia);
    guardia = ALTURAS[(i + (dir || 1) + 3) % 3];
    syncGuard();
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
    syncGuard();

    const lvName = document.getElementById("aut-level-name");
    if (lvName) {
      lvName.textContent = S.champion && phase !== "duelo"
        ? "campeón" : "nivel " + S.level + " · " + RIVALES[S.level - 1].name;
    }

    const fightBtn = document.getElementById("aut-fight");
    if (fightBtn) {
      fightBtn.disabled = phase === "duelo";
      fightBtn.textContent = phase === "duelo" ? "▼ en la arena" : "▼ bajar a la arena";
    }

    const act = document.getElementById("aut-action");
    if (act) {
      act.disabled = false;
      if (phase === "duelo")        act.textContent = "⚑ retirarse";
      else if (phase === "ganado")  act.textContent = "› nivel " + (S.level + 1);
      else if (phase === "perdido") act.textContent = "↺ otra vez";
      else if (phase === "campeon") { act.textContent = "✦ campeón"; act.disabled = true; }
      else                          act.textContent = "▷ a la arena";
    }
    const nameIn = document.getElementById("aut-name");
    if (nameIn) nameIn.disabled = phase === "duelo";
    const pane = document.getElementById("aut-arena-pane");
    if (pane) pane.classList.toggle("peleando", phase === "duelo");
  }

  /* ── el bucle ── */
  let visible = false, last = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.045, (now - last) / 1000 || 0.016);
    last = now;
    if (!visible) return;
    const sec = document.getElementById("sec-automatas");
    if (!sec || !sec.classList.contains("active")) return;

    const t = now / 1000;
    stage.roar = Math.max(0, stage.roar - dt * 1.5);
    stage.shake = Math.max(0, stage.shake - dt * 3.2);

    if (D) {
      stepDuel(dt);
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt * 0.85;
        if (pops[i].life <= 0) pops.splice(i, 1);
      }
      for (let i = chispas.length - 1; i >= 0; i--) {
        const c = chispas[i];
        c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 420 * dt;
        c.life -= dt * 1.6;
        if (c.life <= 0) chispas.splice(i, 1);
      }
    }
    drawPlate(t);
    drawArena(t);
  }

  /* ── medidas ── */
  function fitPlate() {
    const cv = plate.cv, w = cv.clientWidth;
    if (!w) return;
    const h = Math.round(w / 1.32);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    plate.w = w; plate.h = h;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
    plate.g = cv.getContext("2d");
    plate.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fitArena() {
    const cv = arena.cv, w = cv.clientWidth;
    if (!w) return;
    const pane = document.getElementById("aut-arena-pane");
    const fs = pane && pane.classList.contains("aut-fs");
    const h = fs ? Math.max(240, cv.parentNode.clientHeight - 20) : Math.round(w / 2.45);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    arena.w = w; arena.h = h;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
    arena.g = cv.getContext("2d");
    arena.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStadium();
    if (D) {
      D.you.x = clamp(D.you.x, 26, stage.worldW - 26);
      D.foe.x = clamp(D.foe.x, 26, stage.worldW - 26);
      D.camX = clamp((D.you.x + D.foe.x) / 2 - arena.w / 2, 0, Math.max(0, stage.worldW - arena.w));
    }
  }

  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

  /* ── arranque ── */
  function boot() {
    const sec = document.getElementById("sec-automatas");
    if (!sec) return;

    load();

    plate.cv = document.getElementById("aut-figure");
    arena.cv = document.getElementById("aut-arena");
    const pane = document.getElementById("aut-arena-pane");

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
      if (phase === "duelo") {
        D = null;
        phase = "listo";
        murmullo(0);
        logLine("── te retiras del ruedo ──", "aut-sep");
        syncAll();
      } else if (phase === "ganado") {
        nextLevel();
        clearLog();
        logLine("nivel " + S.level + " · " + RIVALES[S.level - 1].name, "aut-sep");
        logLine("tienes " + (budget() - spent()) + " de materia sin repartir.", "aut-flavor");
        syncAll();
      } else startFight();
    });

    /* botones de altura (el ratón también manda) */
    const deck = document.getElementById("aut-cmd");
    if (deck) deck.addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest(".ac-h") : null;
      if (!b) return;
      guardia = b.dataset.h;
      syncGuard();
    });

    /* clic en el ruedo = estocada (y el gesto que despierta el audio) */
    arena.cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      ensureAudio();
      if (phase !== "duelo" || !D) { if (phase !== "duelo") startFight(); return; }
      attackNow(D.you);
    });
    arena.cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    document.getElementById("aut-random").addEventListener("click", function () {
      if (phase === "duelo") return;
      PARTS.forEach(function (p) { S.parts[p.id] = MIN_P; });
      let left = budget() - PARTS.length * MIN_P, guard = 0;
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
      if (phase === "duelo") return;
      S.level = 1;
      S.champion = false;
      S.parts.brazos = 4; S.parts.piernas = 3; S.parts.coraza = 3;
      S.parts.nucleo = 4; S.parts.inteligencia = 2;
      D = null;
      phase = "listo";
      save();
      clearLog();
      logLine("campaña reiniciada — cinco rivales otra vez.", "aut-flavor");
      syncAll();
    });

    /* ── el público, por si molesta ── */
    const sndBtn = document.getElementById("aut-snd");
    function syncSnd() {
      if (!sndBtn) return;
      sndBtn.classList.toggle("on", SND.on);
      sndBtn.setAttribute("aria-pressed", String(SND.on));
      sndBtn.textContent = (SND.on ? "♪" : "♪̸") + " público";
    }
    if (sndBtn) sndBtn.addEventListener("click", function () {
      SND.on = !SND.on;
      try { localStorage.setItem(SND_KEY, SND.on ? "1" : "0"); } catch (e) {}
      if (!SND.on) { murmullo(0); if (SND.master) SND.master.gain.value = 0; }
      else {
        ensureAudio();
        if (SND.master) SND.master.gain.value = 0.85;
        if (phase === "duelo") murmullo(0.075);
        ovacion(0.4);
      }
      syncSnd();
    });
    syncSnd();

    const fsBtn = document.getElementById("aut-fs");
    if (fsBtn) fsBtn.addEventListener("click", function () {
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const req = pane.requestFullscreen || pane.webkitRequestFullscreen;
        if (req) req.call(pane);
      }
    });
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
      document.addEventListener(ev, function () {
        pane.classList.toggle("aut-fs", fsElement() === pane);
        setTimeout(fitArena, 60);
      });
    });

    /* ── teclado ──
       A D correr · W saltar · S agachar · P girar el filo · espacio estocar */
    const MOV = { a:1, d:1, w:1, s:1 };
    function activa() {
      return sec.classList.contains("active");
    }
    document.addEventListener("keydown", function (e) {
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      if (!activa()) return;
      const k = e.key.toLowerCase();
      if (MOV[k]) { keys[k] = true; e.preventDefault(); return; }
      /* ESPACIO gira el filo (p sigue valiendo); el ataque es del ratón.
         El preventDefault también evita que el espacio pulse el botón
         que hubiera quedado con el foco. */
      if (k === " " || k === "p") { cycleGuard(1); e.preventDefault(); }
      else if (k === "arrowup")   { guardia = guardia === "baja" ? "media" : "alta"; syncGuard(); e.preventDefault(); }
      else if (k === "arrowdown") { guardia = guardia === "alta" ? "media" : "baja"; syncGuard(); e.preventDefault(); }
      else if (k === "1") { guardia = "alta";  syncGuard(); }
      else if (k === "2") { guardia = "media"; syncGuard(); }
      else if (k === "3") { guardia = "baja";  syncGuard(); }
    });
    document.addEventListener("keyup", function (e) {
      const k = e.key.toLowerCase();
      if (MOV[k]) keys[k] = false;
    });
    addEventListener("blur", function () { for (const k in keys) keys[k] = false; });

    let roTimer = 0;
    const ro = new ResizeObserver(function () {
      clearTimeout(roTimer);
      roTimer = setTimeout(function () { fitPlate(); fitArena(); }, 60);
    });
    ro.observe(plate.cv.parentNode);
    ro.observe(arena.cv.parentNode);

    const io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        visible = en.isIntersecting;
        if (!visible) for (const k in keys) keys[k] = false;
      });
    }, { threshold: 0.02 });
    io.observe(sec);

    fitPlate();
    fitArena();
    syncAll();
    logLine(S.champion ? "ya fuiste campeón: repártelo de nuevo si quieres repetirlo."
                       : "nivel " + S.level + " · " + RIVALES[S.level - 1].name, "aut-sep");
    requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
