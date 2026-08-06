/* ============================================================
   PANDORA — kaleidoscopio.js  ·  "Kaleidoscopio"
   ------------------------------------------------------------
   Dos piezas que se hablan:

   1) EL TALLER (canvas 2D). Se dibujan hasta VEINTE formas —trazo
      libre, polígono por vértices, o primitivas (círculo, triángulo,
      estrella) arrastrando desde el centro—. Cada forma guarda sus
      puntos NORMALIZADOS (0..1) y DOS atributos distintos:

        · TEXTURA  — cómo está PINTADA. Se pinta a mano sobre el path
          recortado: sólido, vidrio, esmerilado (mota determinista
          sembrada con el id), rayado, punteado, prisma, contorno.
        · MATERIAL — cómo se COMPORTA ANTE LA LUZ dentro del tubo:
          vitral, cristal, pan de oro, nácar, humo, obsidiana, brasa.

      La textura va a un canvas de ALBEDO (color + alfa). El material
      va a un segundo canvas —el MAPA ÓPTICO— donde cada silueta se
      rellena plana con (R = emisión, G = refracción, B = iridiscencia)
      y alfa = máscara. Dos texturas, un solo muestreo por capa: es el
      truco barato para tener materiales sin un G-buffer.

   2) EL TUBO (WebGL / three.js). Ya no es un shader suelto sino una
      CADENA DE PASES sobre quads a pantalla completa:

        tubo → rtEscena → brillo → desenfoque H → desenfoque V → composición

      · TUBO: pasa a polares y PLIEGA el ángulo en cuñas espejadas
        (mod + abs, la simetría diedral real de dos espejos
        enfrentados). Deforma el dominio con un campo fbm —el vidrio
        respira— y muestrea la cámara a TRES PROFUNDIDADES con
        rotaciones y escalas distintas, compuestas de atrás hacia
        adelante: eso es lo que da sensación de tubo y no de disco.
        El mapa óptico decide por texel cuánto se abre el prisma
        (refracción), cuánto arde (emisión) y cuánto tornasola
        (interferencia de película fina). El plomo del vitral sale
        de la DERIVADA de la silueta (fwidth) — una línea oscura
        exacta en cada canto, gratis.
      · BRILLO + DESENFOQUE: umbral de luminancia y gaussiana
        separable a media resolución → el aura.
      · COMPOSICIÓN: suma el aura, difracta el canto, viñetea en
        violeta profundo, añade grano y recorta el ocular.

   Resolución adaptativa: si el cuadro se va de 26 ms, la escena
   baja de escala (la composición sigue a resolución nativa, así que
   el canto y el grano nunca se ven blandos). Pantalla completa,
   anillo de glifos giratorio, y todo persiste en localStorage. Sólo
   se anima con la sección en pantalla (IntersectionObserver) y se
   respeta prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  const THREE = window.THREE;
  const KEY = "pandora_kaleido";
  const MAX_SHAPES = 20;
  const TAU = Math.PI * 2;
  const REDUCED_MOTION = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* fondo de la cámara — el mismo valor en JS y en GLSL, para que el
     taller sea vista previa fiel del tubo */
  const BG_CSS = "#08070b";
  const BG_GLSL = "vec3(0.030, 0.026, 0.041)";

  /* ── TEXTURA: cómo está pintada la forma ── */
  const TEXTURES = [
    ["solido",     "sólido"],
    ["vidrio",     "vidrio · transparente"],
    ["esmerilado", "esmerilado"],
    ["rayado",     "rayado"],
    ["punteado",   "punteado"],
    ["prisma",     "prisma · degradado"],
    ["contorno",   "contorno"]
  ];

  /* ── MATERIAL: cómo se comporta ante la luz ──
     [id, etiqueta, emisión, refracción, iridiscencia] → va empaquetado
     en el canal RGB del mapa óptico */
  const MATERIALS = [
    ["vitral",    "vitral",      0.20, 0.22, 0.12],
    ["cristal",   "cristal",     0.34, 0.92, 0.40],
    ["oro",       "pan de oro",  0.64, 0.12, 0.22],
    ["nacar",     "nácar",       0.26, 0.42, 1.00],
    ["humo",      "humo",        0.12, 0.72, 0.06],
    ["obsidiana", "obsidiana",   0.05, 0.18, 0.52],
    ["brasa",     "brasa",       1.00, 0.26, 0.08]
  ];

  const TEX_LABEL = Object.create(null);
  TEXTURES.forEach(function (t) { TEX_LABEL[t[0]] = t[1]; });
  const MAT_BY_ID = Object.create(null);
  MATERIALS.forEach(function (m) { MAT_BY_ID[m[0]] = m; });

  const TOOLS = ["libre", "poligono", "circulo", "triangulo", "estrella"];

  /* ── REPARTO: cómo se sueltan los objetos dentro de la cámara ── */
  const LAYOUTS = [
    ["dispersion", "dispersión"],
    ["anillo",     "anillo"],
    ["rejilla",    "rejilla"]
  ];

  /* glifos del anillo: planetarios y geométricos, presentes en casi
     cualquier fuente del sistema */
  const GLYPHS = "☉☽☿♀♂♃♄♅♆✶✦✧⁂✵☾⚹".split("");

  /* ── PRNG determinista (mismo par que usa el jardín) ── */
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── color ── */
  function hexToRgb(hex) {
    const h = String(hex || "#243ec4").replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shiftHue(hex, deg) {
    const c = hexToRgb(hex).map(function (v) { return v / 255; });
    const max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
    const l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d > 1e-6) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === c[0])      h = ((c[1] - c[2]) / d) % 6;
      else if (max === c[1]) h = (c[2] - c[0]) / d + 2;
      else                   h = (c[0] - c[1]) / d + 4;
      h *= 60;
    }
    h = ((h + deg) % 360 + 360) % 360;
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = C; g = X; }
    else if (h < 120) { r = X; g = C; }
    else if (h < 180) { g = C; b = X; }
    else if (h < 240) { g = X; b = C; }
    else if (h < 300) { r = X; b = C; }
    else              { r = C; b = X; }
    const to = function (v) { return Math.round((v + m) * 255); };
    return "rgb(" + to(r) + "," + to(g) + "," + to(b) + ")";
  }

  /* ════════════════════════════════════════════════════════════
     ESTADO
     ════════════════════════════════════════════════════════════ */
  const state = {
    shapes: [],                 // {id, pts, color, tex, mat, alpha, smooth}
    sel: null,
    tool: "libre",
    draft: null,
    hover: null,
    loaded: false,
    tube: {
      seg: 6, zoom: 1, spin: 0.14, auto: true,
      prism: 0.55, warp: 0.45, lead: 0.6, aura: 0.85, glyphs: true,
      layout: "dispersion"
    }
  };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw) return;
      if (Array.isArray(raw.shapes)) state.shapes = raw.shapes.slice(0, MAX_SHAPES);
      if (raw.tube) {
        // migración desde la versión anterior: «disp» pasó a ser «prisma»
        if (raw.tube.prism == null && raw.tube.disp != null) raw.tube.prism = raw.tube.disp;
        Object.assign(state.tube, raw.tube);
      }
      state.shapes.forEach(function (s) { if (!s.mat || !MAT_BY_ID[s.mat]) s.mat = "vitral"; });
      state.loaded = state.shapes.length > 0;
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ shapes: state.shapes, tube: state.tube })); } catch (e) {}
  }

  function selShape() {
    if (!state.sel) return null;
    for (let i = 0; i < state.shapes.length; i++) if (state.shapes[i].id === state.sel) return state.shapes[i];
    return null;
  }

  /* ════════════════════════════════════════════════════════════
     GEOMETRÍA DE LAS FORMAS
     ════════════════════════════════════════════════════════════ */
  function primitive(kind, cx, cy, r, rot) {
    const pts = [];
    let n = 3;
    if (kind === "circulo") n = 56;
    else if (kind === "triangulo") n = 3;
    else if (kind === "estrella") n = 10;
    for (let i = 0; i < n; i++) {
      const a = rot - Math.PI / 2 + (i / n) * TAU;
      const rr = (kind === "estrella" && i % 2) ? r * 0.42 : r;   // la estrella alterna radios
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }

  /* descarta puntos casi colineales del trazo libre (Douglas–Peucker) */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const seg = stack.pop(), a = seg[0], b = seg[1];
      const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-6;
      let far = -1, fd = eps;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
        if (d > fd) { fd = d; far = i; }
      }
      if (far > 0) { keep[far] = true; stack.push([a, far], [far, b]); }
    }
    return pts.filter(function (p, i) { return keep[i]; });
  }

  function bbox(pts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  /* ════════════════════════════════════════════════════════════
     EL REPARTO — cada objeto se dibuja en su propio lienzo, así que
     es la cámara la que decide dónde cae cada uno. Devuelve, por
     forma, un sitio (centro, radio y giro) en el cuadro 0..1.
     ════════════════════════════════════════════════════════════ */
  function placements(shapes, mode) {
    const n = shapes.length, out = [];
    if (!n) return out;

    if (mode === "anillo") {
      // más de una docena ya no cabe en un solo anillo: se abre un segundo
      const inner = n > 12 ? Math.floor(n / 3) : 0;
      const outer = n - inner;
      const ring = function (from, count, rad, phase) {
        for (let i = 0; i < count; i++) {
          const a = phase + (i / count) * TAU;
          out[from + i] = {
            cx: 0.5 + Math.cos(a) * rad,
            cy: 0.5 + Math.sin(a) * rad,
            r: Math.min(0.15, Math.max(0.045, (TAU * rad) / Math.max(3, count) * 0.5)),
            rot: a + Math.PI / 2                 // cada cuenta mira hacia afuera
          };
        }
      };
      ring(0, outer, 0.33, -Math.PI / 2);
      if (inner) ring(outer, inner, 0.145, 0);
      return out;
    }

    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cw = 1 / cols, ch = 1 / rows;
    const cell = Math.min(cw, ch) * 0.5;
    for (let i = 0; i < n; i++) {
      let cx = ((i % cols) + 0.5) * cw;
      let cy = (Math.floor(i / cols) + 0.5) * ch;
      let rot = 0, r = cell * 0.82;
      if (mode === "dispersion") {
        // rejilla con temblor determinista, sembrado con el id de la
        // forma: parecen cuentas sueltas y no se pisan entre ellas
        const rnd = mulberry32(hashStr(shapes[i].id || ("p" + i)));
        cx += (rnd() - 0.5) * cw * 0.5;
        cy += (rnd() - 0.5) * ch * 0.5;
        rot = rnd() * TAU;
        r = cell * (0.72 + rnd() * 0.24);
      }
      out.push({ cx: cx, cy: cy, r: r, rot: rot });
    }
    return out;
  }

  /* lleva los puntos de la forma —tal como se dibujaron— a su sitio */
  function placedPts(sh, pl) {
    const b = bbox(sh.pts);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const maxDim = Math.max(b.w, b.h, 1e-3);
    // el tamaño con que la dibujaste sigue contando, pero nada desborda su celda
    const want = pl.r * 2 * (0.42 + 0.58 * Math.min(1, maxDim / 0.75));
    const k = want / maxDim;
    const co = Math.cos(pl.rot), si = Math.sin(pl.rot);
    return sh.pts.map(function (p) {
      const x = (p[0] - cx) * k, y = (p[1] - cy) * k;
      return [pl.cx + x * co - y * si, pl.cy + x * si + y * co];
    });
  }

  function withPts(sh, pts) {
    return {
      id: sh.id, pts: pts, color: sh.color, tex: sh.tex,
      mat: sh.mat, alpha: sh.alpha, smooth: sh.smooth
    };
  }

  /* recorre las formas ya colocadas en la cámara */
  function eachPlaced(fn) {
    const pls = placements(state.shapes, state.tube.layout);
    for (let i = 0; i < state.shapes.length; i++) {
      fn(withPts(state.shapes[i], placedPts(state.shapes[i], pls[i])));
    }
  }

  /* ════════════════════════════════════════════════════════════
     PINTADO (taller, albedo y miniaturas comparten este código)
     ════════════════════════════════════════════════════════════ */
  function tracePath(ctx, pts, W, H, smooth) {
    const n = pts.length;
    ctx.beginPath();
    if (n < 2) return;
    if (!smooth || n < 4) {
      ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
      ctx.closePath();
      return;
    }
    // curva cerrada suave: control en el vértice, extremos en los puntos medios
    const mx = function (a, b) { return (a[0] + b[0]) * 0.5 * W; };
    const my = function (a, b) { return (a[1] + b[1]) * 0.5 * H; };
    ctx.moveTo(mx(pts[n - 1], pts[0]), my(pts[n - 1], pts[0]));
    for (let i = 0; i < n; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % n];
      ctx.quadraticCurveTo(cur[0] * W, cur[1] * H, mx(cur, nxt), my(cur, nxt));
    }
    ctx.closePath();
  }

  function paintShape(ctx, sh, W, H) {
    const pts = sh.pts;
    if (!pts || pts.length < 3) return;
    const a = Math.max(0.04, Math.min(1, sh.alpha == null ? 0.85 : sh.alpha));
    const color = sh.color || "#243ec4";
    const min = Math.min(W, H);
    const b = bbox(pts);
    const px = { x: b.x0 * W, y: b.y0 * H, w: Math.max(1, b.w * W), h: Math.max(1, b.h * H) };

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    tracePath(ctx, pts, W, H, sh.smooth);

    if (sh.tex === "contorno") {
      ctx.globalAlpha = a * 0.07;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, min * 0.016);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (sh.tex === "prisma") {
      const g = ctx.createLinearGradient(px.x, px.y, px.x + px.w, px.y + px.h);
      g.addColorStop(0.00, color);
      g.addColorStop(0.45, shiftHue(color, 55));
      g.addColorStop(1.00, shiftHue(color, 150));
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = shiftHue(color, 200);
      ctx.lineWidth = Math.max(1, min * 0.006);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (sh.tex === "vidrio") {
      ctx.globalAlpha = a * 0.38;
      ctx.fillStyle = color;
      ctx.fill();
      // reflejo interior: un lóbulo de luz arriba-izquierda
      ctx.save();
      ctx.clip();
      const gr = ctx.createRadialGradient(
        px.x + px.w * 0.3, px.y + px.h * 0.24, 1,
        px.x + px.w * 0.3, px.y + px.h * 0.24, Math.max(px.w, px.h) * 0.72
      );
      gr.addColorStop(0, "rgba(255,255,255," + (a * 0.42) + ")");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.globalAlpha = Math.min(1, a * 1.1);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, min * 0.008);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (sh.tex === "esmerilado") {
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const rnd = mulberry32(hashStr(sh.id || "k"));
      const n = Math.max(60, Math.min(1600, Math.round(px.w * px.h * 0.0035)));
      const dot = Math.max(0.7, min * 0.0035);
      for (let i = 0; i < n; i++) {
        const x = px.x + rnd() * px.w, y = px.y + rnd() * px.h;
        ctx.globalAlpha = a * (0.12 + rnd() * 0.4);
        ctx.fillStyle = rnd() > 0.45 ? "#ffffff" : color;
        ctx.beginPath();
        ctx.arc(x, y, dot * (0.5 + rnd()), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = Math.max(1, min * 0.005);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (sh.tex === "rayado") {
      ctx.globalAlpha = a * 0.2;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const step = Math.max(4, min * 0.03);
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.lineWidth = step * 0.44;
      ctx.beginPath();
      for (let d = -H; d < W + H; d += step) { ctx.moveTo(d, 0); ctx.lineTo(d - H, H); }
      ctx.stroke();
      ctx.restore();
      ctx.restore();
      return;
    }

    if (sh.tex === "punteado") {
      ctx.globalAlpha = a * 0.16;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const step = Math.max(5, min * 0.042), rad = step * 0.26;
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      let row = 0;
      for (let y = px.y - step; y < px.y + px.h + step; y += step, row++) {
        const off = (row % 2) * step * 0.5;
        for (let x = px.x - step + off; x < px.x + px.w + step; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.restore();
      return;
    }

    // sólido
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /* la misma silueta, rellena plana con las constantes ópticas del
     material → ése es el mapa que lee el shader */
  function paintMaterial(ctx, sh, W, H) {
    if (!sh.pts || sh.pts.length < 3) return;
    const m = MAT_BY_ID[sh.mat] || MAT_BY_ID.vitral;
    ctx.save();
    tracePath(ctx, sh.pts, W, H, sh.smooth);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(" +
      Math.round(m[2] * 255) + "," + Math.round(m[3] * 255) + "," + Math.round(m[4] * 255) + ")";
    ctx.fill();
    ctx.restore();
  }

  /* miniatura: reencuadra la forma dentro de la caja del listado.
     El reencuadre va en espacio NORMALIZADO — paintShape ya escala a px. */
  function paintThumb(ctx, sh, W, H) {
    const b = bbox(sh.pts);
    const k = Math.min(0.80 / Math.max(b.w, 1e-3), 0.80 / Math.max(b.h, 1e-3));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    paintShape(ctx, {
      id: sh.id, color: sh.color, tex: sh.tex, alpha: sh.alpha, smooth: sh.smooth,
      pts: sh.pts.map(function (p) {
        return [0.5 + (p[0] - cx) * k, 0.5 + (p[1] - cy) * k];
      })
    }, W, H);
  }

  /* ════════════════════════════════════════════════════════════
     LA CÁMARA DE OBJETOS → DOS TEXTURAS (albedo + mapa óptico)
     ════════════════════════════════════════════════════════════ */
  const SRC = 512;
  let albCanvas = null, albCtx = null, texAlb = null;
  let matCanvas = null, matCtx = null, texMat = null;

  function ensureSource() {
    if (albCanvas) return;
    albCanvas = document.createElement("canvas");
    albCanvas.width = albCanvas.height = SRC;
    albCtx = albCanvas.getContext("2d");
    matCanvas = document.createElement("canvas");
    matCanvas.width = matCanvas.height = SRC;
    matCtx = matCanvas.getContext("2d");
  }

  function repaintSource() {
    ensureSource();
    albCtx.clearRect(0, 0, SRC, SRC);
    matCtx.clearRect(0, 0, SRC, SRC);
    if (state.loaded) {
      eachPlaced(function (placed) {
        paintShape(albCtx, placed, SRC, SRC);
        paintMaterial(matCtx, placed, SRC, SRC);
      });
    }
    if (texAlb) texAlb.needsUpdate = true;
    if (texMat) texMat.needsUpdate = true;
  }

  /* ════════════════════════════════════════════════════════════
     EL TALLER — canvas de dibujo
     ════════════════════════════════════════════════════════════ */
  const board = { el: null, ctx: null, w: 0, h: 0, dpr: 1, drawing: false, preview: false };

  function layoutBoard() {
    if (!board.el) return;
    const r = board.el.getBoundingClientRect();
    const size = Math.max(120, Math.round(r.width));
    board.dpr = Math.min(2, window.devicePixelRatio || 1);
    board.w = size; board.h = size;
    board.el.width = Math.round(size * board.dpr);
    board.el.height = Math.round(size * board.dpr);
    board.el.style.height = size + "px";
    board.ctx.setTransform(board.dpr, 0, 0, board.dpr, 0, 0);
    drawBoard();
  }

  function drawBoard() {
    if (!board.ctx) return;
    const ctx = board.ctx, W = board.w, H = board.h;
    ctx.setTransform(board.dpr, 0, 0, board.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG_CSS;
    ctx.fillRect(0, 0, W, H);

    // retícula tenue: referencia de encuadre
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.055)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const t = Math.round((i / 8) * W) + 0.5;
      ctx.moveTo(t, 0); ctx.lineTo(t, H);
      ctx.moveTo(0, t); ctx.lineTo(W, t);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(36,62,196,.32)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W * 0.42, 0, TAU);
    ctx.stroke();
    ctx.restore();

    /* modo cámara: se ve el reparto completo, todos los objetos ya
       colocados — es exactamente lo que entra en el tubo */
    if (board.preview) {
      eachPlaced(function (placed) { paintShape(ctx, placed, W, H); });
      if (!state.shapes.length) {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.28)";
        ctx.font = '11px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.fillText("cámara vacía", W / 2, H / 2);
        ctx.restore();
      }
      return;
    }

    /* un lienzo por objeto: sólo se ve el que estás editando */
    const sel = selShape();
    if (sel && !state.draft) {
      paintShape(ctx, sel, W, H);
      ctx.save();
      tracePath(ctx, sel.pts, W, H, sel.smooth);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,.75)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // forma en curso
    const d = state.draft;
    if (d && d.pts.length) {
      ctx.save();
      if (d.pts.length >= 3) paintShape(ctx, d, W, H);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(d.pts[0][0] * W, d.pts[0][1] * H);
      for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i][0] * W, d.pts[i][1] * H);
      if (state.tool === "poligono" && state.hover) ctx.lineTo(state.hover[0] * W, state.hover[1] * H);
      ctx.stroke();
      if (state.tool === "poligono") {
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff";
        for (let i = 0; i < d.pts.length; i++) {
          ctx.beginPath();
          ctx.arc(d.pts[i][0] * W, d.pts[i][1] * H, i === 0 ? 4 : 2.6, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /* con veinte formas, repintar el taller Y los dos canvas de 512²
     en cada evento de un deslizador sale caro: se agrupa todo en el
     siguiente cuadro y se hace una sola vez */
  let flushQueued = false, needBoard = false, needSource = false;
  function invalidate(wantBoard, wantSource) {
    if (wantBoard) needBoard = true;
    if (wantSource) needSource = true;
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(function () {
      flushQueued = false;
      if (needBoard) { needBoard = false; drawBoard(); }
      if (needSource) { needSource = false; repaintSource(); }
    });
  }

  function boardPos(ev) {
    const r = board.el.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))),
      Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height)))
    ];
  }

  function newDraft(pts, smooth) {
    const ui = readShapeUI();
    return {
      id: "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      pts: pts, color: ui.color, tex: ui.tex, mat: ui.mat, alpha: ui.alpha, smooth: !!smooth
    };
  }

  function commitDraft() {
    const d = state.draft;
    state.draft = null;
    state.hover = null;
    if (!d || d.pts.length < 3) { drawBoard(); return; }
    const b = bbox(d.pts);
    if (Math.max(b.w, b.h) < 0.03) { drawBoard(); return; }   // un toque suelto no es una forma
    if (state.shapes.length >= MAX_SHAPES) { flashLimit(); drawBoard(); return; }
    delete d.origin;                                          // dato de arrastre, no se guarda
    state.shapes.push(d);
    state.sel = d.id;
    save();
    syncUI();
    drawBoard();
    if (state.loaded) repaintSource();       // ya estaba dentro: se actualiza al vuelo
  }

  function cancelDraft() {
    state.draft = null;
    state.hover = null;
    drawBoard();
  }

  /* al empezar un trazo nuevo el lienzo queda limpio: se suelta la
     forma que estuvieras reeditando */
  function clearSelection() {
    if (!state.sel) return;
    state.sel = null;
    const prev = elList ? elList.querySelector(".kal-chip.sel") : null;
    if (prev) prev.classList.remove("sel");
    syncSelInfo();
  }

  /* ════════════════════════════════════════════════════════════
     EL TUBO — cadena de pases WebGL
     ════════════════════════════════════════════════════════════ */
  const VERT = [
    "varying vec2 vUv;",
    "void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }"
  ].join("\n");

  /* tinte de película fina: el arcoíris del nácar, del aceite y del
     canto difractado. Compartido por el pase del tubo y el de composición */
  const FILM = [
    "vec3 filmTint(float x){",
    "  return 0.5 + 0.5 * cos(6.28318530718 * (vec3(0.0, 0.33, 0.67) + x));",
    "}"
  ].join("\n");

  const NOISE = [
    "float hash21(vec2 p){",
    "  p = fract(p * vec2(123.34, 456.21));",
    "  p += dot(p, p + 45.32);",
    "  return fract(p.x * p.y);",
    "}",
    "float vnoise(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),",
    "             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);",
    "}",
    "float fbm(vec2 p){",
    "  float v = 0.0, a = 0.55;",
    "  for (int i = 0; i < 3; i++){ v += a * vnoise(p); p *= 2.07; a *= 0.5; }",
    "  return v;",
    "}"
  ].join("\n");

  /* ── PASE 1 · el tubo ── */
  const FRAG_TUBE = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex, uMat;",
    "uniform float uTime, uRot, uZoom, uSeg, uPrism, uDrop, uAspect, uHas, uWarp, uLead;",
    "#define PI 3.141592653589793",
    "const vec3 BG = " + BG_GLSL + ";",
    NOISE,
    FILM,

    /* repetición ESPEJADA: el campo de objetos se prolonga sin costuras */
    "vec2 mirrorUV(vec2 uv){ return abs(mod(uv + 1.0, 2.0) - 1.0); }",

    /* una capa de la cámara a profundidad `dep` (0 = frente).
       Devuelve color premezclado + alfa, y saca la emisión por separado. */
    "vec4 chamberLayer(vec2 q, float dep, float t, out float emis){",
    "  float ang = t * (0.050 + dep * 0.045) + dep * 2.1 + uRot * dep * 0.30;",
    "  float c = cos(ang), s = sin(ang);",
    "  vec2 p = mat2(c, s, -s, c) * q * mix(1.0, 0.52, dep);",
    "  p += vec2(sin(t * 0.083 + dep * 3.1), cos(t * 0.061 + dep * 2.3)) * 0.22;",

    "  vec2 uv = mirrorUV(p * 0.5 + 0.5);",
    /* el mapa óptico: R emisión · G refracción · B iridiscencia · A máscara */
    "  vec4 m = texture2D(uMat, uv);",
    "  vec4 col;",
    "  if (dep < 0.01 && uPrism > 0.001) {",
    /*   el prisma se abre MÁS donde el material refracta más */
    "    float d = uPrism * (0.008 + 0.036 * m.g);",
    "    vec4 cr = texture2D(uTex, mirrorUV(p * (1.0 + d) * 0.5 + 0.5));",
    "    vec4 cg = texture2D(uTex, uv);",
    "    vec4 cb = texture2D(uTex, mirrorUV(p * (1.0 - d) * 0.5 + 0.5));",
    "    col = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a) * 0.8));",
    "  } else {",
    "    col = texture2D(uTex, uv);",
    "  }",
    "  emis = m.r * col.a;",
    /* interferencia de película fina: la fase corre con el radio y el tiempo */
    "  float ph = length(p) * 1.7 + t * 0.09 + dep * 0.5;",
    "  col.rgb = mix(col.rgb, col.rgb * 0.55 + filmTint(ph) * 0.85, m.b * uPrism);",
    "  col.a *= uHas;",
    "  return col;",
    "}",

    "void main(){",
    "  vec2 pp = (vUv - 0.5) * 2.0;",
    "  pp.x *= uAspect;",
    "  float r = length(pp);",
    "  float t = uTime;",

    /* pliegue diedral: dos espejos enfrentados = mod + abs */
    "  float a = atan(pp.y, pp.x) + uRot;",
    "  float w = PI / uSeg;",
    "  float af = mod(a, 2.0 * w);",
    "  af = abs(af - w);",
    "  float rr = r / max(0.2, uZoom);",
    "  vec2 q = vec2(cos(af), sin(af)) * rr;",

    /* temblor del vidrio: un solo campo fbm deforma el dominio */
    "  vec2 wv = vec2(fbm(q * 2.7 + t * 0.08), fbm(q * 2.7 + 11.0 - t * 0.065)) - 0.5;",
    "  q += wv * uWarp * 0.34;",

    /* al «introducir» las formas, la cámara entra desde lejos */
    "  q *= mix(2.6, 1.0, uDrop);",

    /* tres profundidades → el tubo tiene fondo */
    "  float e0, e1, e2;",
    "  vec4 l2 = chamberLayer(q, 1.0, t, e2);",
    "  vec4 l1 = chamberLayer(q, 0.5, t, e1);",
    "  vec4 l0 = chamberLayer(q, 0.0, t, e0);",

    "  vec3 col = BG;",
    "  col = mix(col, l2.rgb * 0.55, l2.a * 0.45);",
    "  col = mix(col, l1.rgb * 0.80, l1.a * 0.70);",
    "  col = mix(col, l0.rgb, l0.a);",

    /* lo que arde por dentro */
    "  float glow = e0 + e1 * 0.5 + e2 * 0.26;",
    "  col += col * glow * 1.2 + glow * 0.10;",

    /* plomo del vitral: la derivada de la silueta del frente */
    "  float lead = clamp(fwidth(l0.a) * uLead * 5.0, 0.0, 1.0);",
    "  col = mix(col, vec3(0.014, 0.012, 0.021), lead * 0.85);",

    /* juntas de los espejos */
    "  float sn = min(af, w - af) / w;",
    "  col += (1.0 - smoothstep(0.0, 0.055, sn)) * smoothstep(0.03, 0.40, r) * 0.15;",

    /* haces que bajan desde el eje */
    "  float shaft = fbm(vec2(af / w * 3.0 + t * 0.05, r * 0.7 - t * 0.11));",
    "  col += vec3(0.60, 0.53, 0.95) * shaft * shaft * smoothstep(1.0, 0.05, r) * 0.16;",

    /* el ojo del tubo */
    "  col += vec3(1.0, 0.93, 0.82) * exp(-r * r * 110.0) * 0.45;",

    /* apagado suave fuera del ocular: el aura no debe sangrar de las esquinas */
    "  col *= 1.0 - smoothstep(0.97, 1.12, r);",

    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  /* ── PASE 2 · umbral de luminancia ── */
  const FRAG_BRIGHT = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform float uThresh;",
    "void main(){",
    "  vec3 c = texture2D(tDiffuse, vUv).rgb;",
    "  float l = dot(c, vec3(0.299, 0.587, 0.114));",
    "  gl_FragColor = vec4(c * smoothstep(uThresh, uThresh + 0.32, l), 1.0);",
    "}"
  ].join("\n");

  /* ── PASE 3/4 · gaussiana separable (5 tomas con filtrado lineal) ── */
  const FRAG_BLUR = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform vec2 uDir;",
    "void main(){",
    "  vec4 s = texture2D(tDiffuse, vUv) * 0.2270270270;",
    "  s += (texture2D(tDiffuse, vUv + uDir * 1.3846153846) +",
    "        texture2D(tDiffuse, vUv - uDir * 1.3846153846)) * 0.3162162162;",
    "  s += (texture2D(tDiffuse, vUv + uDir * 3.2307692308) +",
    "        texture2D(tDiffuse, vUv - uDir * 3.2307692308)) * 0.0702702703;",
    "  gl_FragColor = s;",
    "}"
  ].join("\n");

  /* ── PASE 5 · composición y ocular ── */
  const FRAG_COMP = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D tScene, tBloom;",
    "uniform float uTime, uAspect, uDrop, uAura;",
    FILM,
    "void main(){",
    "  vec2 p = (vUv - 0.5) * 2.0;",
    "  p.x *= uAspect;",
    "  float r = length(p);",
    "  if (r > 1.0) discard;",

    "  vec3 col = texture2D(tScene, vUv).rgb;",
    "  col += texture2D(tBloom, vUv).rgb * uAura;",

    /* el canto del ocular difracta: halo de película fina */
    "  float ring = smoothstep(0.84, 1.0, r);",
    "  col += filmTint(r * 3.0 + uTime * 0.05) * ring * 0.14;",

    /* viñeta que además tira a violeta: la penumbra del tubo */
    "  col *= mix(1.0, 0.20, smoothstep(0.40, 1.0, r));",
    "  col = mix(col, col * vec3(0.70, 0.64, 1.05), smoothstep(0.45, 1.0, r) * 0.75);",

    /* grano finísimo, hermano del tramado del resto del sitio */
    "  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453);",
    "  col += (g - 0.5) * 0.030;",

    /* la caída: el campo se revela */
    "  col = mix(" + BG_GLSL + ", col, smoothstep(0.0, 0.4, uDrop));",

    "  float alpha = 1.0 - smoothstep(0.984, 1.0, r);",
    "  gl_FragColor = vec4(col, alpha);",
    "}"
  ].join("\n");

  const tube = {
    el: null, lens: null, ring: null, renderer: null, scene: null, cam: null, quad: null,
    matTube: null, matBright: null, matBlur: null, matComp: null,
    rtScene: null, rtA: null, rtB: null,
    size: 0, buf: 0, pr: 1, quality: 1,
    visible: false, rot: 0, vel: 0, drop: 1, dragging: false, lastX: 0,
    raf: 0, t0: 0, last: 0, acc: 0, frames: 0
  };

  function ensureTube() {
    if (tube.renderer || !tube.el) return !!tube.renderer;
    let r;
    try {
      r = new THREE.WebGLRenderer({
        canvas: tube.el, alpha: true, antialias: false, preserveDrawingBuffer: true
      });
    } catch (e) { return false; }
    r.setClearColor(0x000000, 0);
    r.autoClear = true;
    tube.renderer = r;

    ensureSource();
    texAlb = new THREE.CanvasTexture(albCanvas);
    texMat = new THREE.CanvasTexture(matCanvas);
    [texAlb, texMat].forEach(function (tx) {
      tx.minFilter = THREE.LinearFilter;
      tx.magFilter = THREE.LinearFilter;
      tx.generateMipmaps = false;
      tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
    });

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false
    };
    tube.rtScene = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    tube.rtA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    tube.rtB = new THREE.WebGLRenderTarget(2, 2, rtOpts);

    const base = { depthTest: false, depthWrite: false, vertexShader: VERT };

    tube.matTube = new THREE.ShaderMaterial(Object.assign({}, base, {
      uniforms: {
        uTex:    { value: texAlb },
        uMat:    { value: texMat },
        uTime:   { value: 0 },
        uRot:    { value: 0 },
        uZoom:   { value: state.tube.zoom },
        uSeg:    { value: state.tube.seg },
        uPrism:  { value: state.tube.prism },
        uDrop:   { value: 1 },
        uAspect: { value: 1 },
        uHas:    { value: 0 },
        uWarp:   { value: state.tube.warp },
        uLead:   { value: state.tube.lead }
      },
      fragmentShader: FRAG_TUBE,
      extensions: { derivatives: true }      // fwidth → el plomo del vitral
    }));

    tube.matBright = new THREE.ShaderMaterial(Object.assign({}, base, {
      uniforms: { tDiffuse: { value: null }, uThresh: { value: 0.34 } },
      fragmentShader: FRAG_BRIGHT
    }));

    tube.matBlur = new THREE.ShaderMaterial(Object.assign({}, base, {
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      fragmentShader: FRAG_BLUR
    }));

    tube.matComp = new THREE.ShaderMaterial(Object.assign({}, base, {
      uniforms: {
        tScene:  { value: null },
        tBloom:  { value: null },
        uTime:   { value: 0 },
        uAspect: { value: 1 },
        uDrop:   { value: 1 },
        uAura:   { value: state.tube.aura }
      },
      fragmentShader: FRAG_COMP,
      transparent: true
    }));

    tube.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tube.matTube);
    tube.scene = new THREE.Scene();
    tube.scene.add(tube.quad);
    tube.cam = new THREE.Camera();
    return true;
  }

  /* tamaños: el lienzo va a resolución nativa; la escena puede bajar
     de escala sola si el cuadro se pone caro */
  function sizeTargets() {
    const s = Math.max(64, Math.round(tube.buf * tube.quality));
    const h = Math.max(32, Math.round(s * 0.5));
    tube.rtScene.setSize(s, s);
    tube.rtA.setSize(h, h);
    tube.rtB.setSize(h, h);
  }

  function layoutTube() {
    if (!tube.lens || !tube.renderer) return;
    const r = tube.lens.getBoundingClientRect();
    const size = Math.max(140, Math.round(Math.min(r.width, r.height) || r.width));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // techo del búfer: en pantalla completa un 4K nativo no compensa
    const pr = Math.max(0.75, Math.min(dpr, 1400 / size));
    if (size === tube.size && Math.abs(pr - tube.pr) < 0.01) return;
    tube.size = size;
    tube.pr = pr;
    tube.buf = Math.round(size * pr);
    tube.renderer.setPixelRatio(pr);
    tube.renderer.setSize(size, size, false);
    tube.el.style.width = size + "px";
    tube.el.style.height = size + "px";
    sizeTargets();
    drawRing();
  }

  function renderTube() {
    const R = tube.renderer, q = tube.quad;
    const bh = Math.max(1, tube.rtA.width);

    q.material = tube.matTube;
    R.setRenderTarget(tube.rtScene);
    R.render(tube.scene, tube.cam);

    q.material = tube.matBright;
    tube.matBright.uniforms.tDiffuse.value = tube.rtScene.texture;
    R.setRenderTarget(tube.rtA);
    R.render(tube.scene, tube.cam);

    q.material = tube.matBlur;
    tube.matBlur.uniforms.tDiffuse.value = tube.rtA.texture;
    tube.matBlur.uniforms.uDir.value.set(1.35 / bh, 0);
    R.setRenderTarget(tube.rtB);
    R.render(tube.scene, tube.cam);

    tube.matBlur.uniforms.tDiffuse.value = tube.rtB.texture;
    tube.matBlur.uniforms.uDir.value.set(0, 1.35 / bh);
    R.setRenderTarget(tube.rtA);
    R.render(tube.scene, tube.cam);

    q.material = tube.matComp;
    tube.matComp.uniforms.tScene.value = tube.rtScene.texture;
    tube.matComp.uniforms.tBloom.value = tube.rtA.texture;
    R.setRenderTarget(null);
    R.render(tube.scene, tube.cam);
  }

  function tick(now) {
    tube.raf = requestAnimationFrame(tick);
    if (!tube.visible || !tube.renderer) return;
    const dt = Math.min(0.05, tube.last ? (now - tube.last) / 1000 : 0.016);
    tube.last = now;

    // giro: inercia del arrastre + giro automático
    if (!tube.dragging) {
      tube.rot += tube.vel * dt;
      tube.vel *= Math.pow(0.02, dt);                       // amortiguación exponencial
      if (state.tube.auto && !REDUCED_MOTION) tube.rot += state.tube.spin * dt;
    }
    if (tube.drop < 1) tube.drop = Math.min(1, tube.drop + dt / 0.85);

    const t = REDUCED_MOTION ? 0 : (now - tube.t0) / 1000;
    const drop = REDUCED_MOTION ? 1 : tube.drop;
    const u = tube.matTube.uniforms;
    u.uTime.value = t;
    u.uRot.value = tube.rot;
    u.uZoom.value = state.tube.zoom;
    u.uSeg.value = state.tube.seg;
    u.uPrism.value = state.tube.prism;
    u.uWarp.value = REDUCED_MOTION ? 0 : state.tube.warp;
    u.uLead.value = state.tube.lead;
    u.uDrop.value = drop;
    u.uHas.value = state.loaded ? 1 : 0;

    const c = tube.matComp.uniforms;
    c.uTime.value = t;
    c.uDrop.value = drop;
    c.uAura.value = state.tube.aura;

    renderTube();

    // el anillo de glifos gira al revés que el tubo
    if (tube.ring) tube.ring.style.transform = "rotate(" + (-tube.rot * 22) + "deg)";

    // resolución adaptativa: si el cuadro se encarece, la escena baja
    tube.acc += dt; tube.frames++;
    if (tube.frames >= 45) {
      const avg = tube.acc / tube.frames;
      const prev = tube.quality;
      if (avg > 0.026) tube.quality = Math.max(0.55, tube.quality - 0.12);
      else if (avg < 0.015) tube.quality = Math.min(1, tube.quality + 0.08);
      if (Math.abs(prev - tube.quality) > 0.001) sizeTargets();
      tube.acc = 0; tube.frames = 0;
    }
  }

  /* ── anillo de glifos sobre el canto del ocular ── */
  function drawRing() {
    if (!tube.ring) return;
    const size = tube.size || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tube.ring.width = Math.round(size * dpr);
    tube.ring.height = Math.round(size * dpr);
    tube.ring.style.width = size + "px";
    tube.ring.style.height = size + "px";
    const ctx = tube.ring.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!state.tube.glyphs) return;

    const cx = size / 2, cy = size / 2, rad = size * 0.435;
    ctx.strokeStyle = "rgba(198,190,255,.16)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rad * 1.055, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.905, 0, TAU); ctx.stroke();

    ctx.fillStyle = "rgba(214,206,255,.42)";
    ctx.font = Math.round(size * 0.036) + "px " + '"Segoe UI Symbol", "DejaVu Sans", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const n = GLYPHS.length;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(GLYPHS[i], 0, 0);
      ctx.restore();
    }
  }

  /* ════════════════════════════════════════════════════════════
     UI
     ════════════════════════════════════════════════════════════ */
  let elColor, elTex, elMat, elAlpha, elAlphaVal, elList, elCount, elBadge, elEmpty,
      elClosePoly, elSelInfo;

  function readShapeUI() {
    return {
      color: elColor ? elColor.value : "#243ec4",
      tex: elTex ? elTex.value : "vidrio",
      mat: elMat ? elMat.value : "vitral",
      alpha: elAlpha ? (+elAlpha.value / 100) : 0.85
    };
  }

  function flashLimit() {
    if (!elCount) return;
    elCount.classList.remove("kal-flash");
    void elCount.offsetWidth;
    elCount.classList.add("kal-flash");
  }

  function syncUI() {
    if (elCount) elCount.textContent = state.shapes.length + " / " + MAX_SHAPES;
    if (elBadge) {
      elBadge.textContent = !state.loaded
        ? "vacío"
        : (state.shapes.length + (state.shapes.length === 1 ? " objeto" : " objetos"));
    }
    if (elEmpty) elEmpty.style.display = (state.loaded && state.shapes.length) ? "none" : "";
    if (elClosePoly) elClosePoly.style.display = (state.tool === "poligono" && state.draft) ? "" : "none";
    syncSelInfo();
    renderList();
  }

  let chipMap = Object.create(null);

  function renderList() {
    if (!elList) return;
    elList.innerHTML = "";
    chipMap = Object.create(null);
    if (!state.shapes.length) {
      const p = document.createElement("div");
      p.className = "kal-list-empty";
      p.textContent = "sin formas todavía — dibuja en la cámara de arriba";
      elList.appendChild(p);
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    state.shapes.forEach(function (sh, i) {
      const chip = document.createElement("div");
      chip.className = "kal-chip" + (sh.id === state.sel ? " sel" : "");
      chip.title = "forma " + (i + 1) + " · " + ((MAT_BY_ID[sh.mat] || MAT_BY_ID.vitral)[1]);

      const cv = document.createElement("canvas");
      cv.width = Math.round(44 * dpr); cv.height = Math.round(44 * dpr);
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = BG_CSS;
      c.fillRect(0, 0, 44, 44);
      paintThumb(c, sh, 44, 44);
      chip.appendChild(cv);
      chipMap[sh.id] = cv;

      const del = document.createElement("button");
      del.className = "kal-del";
      del.type = "button";
      del.title = "quitar";
      del.textContent = "×";
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        state.shapes = state.shapes.filter(function (s) { return s.id !== sh.id; });
        if (state.sel === sh.id) state.sel = null;
        if (!state.shapes.length) state.loaded = false;
        save(); syncUI(); drawBoard(); repaintSource();
      });
      chip.appendChild(del);

      chip.addEventListener("click", function () {
        state.sel = sh.id;
        if (elColor) elColor.value = sh.color;
        if (elTex) elTex.value = sh.tex;
        if (elMat) elMat.value = sh.mat || "vitral";
        if (elAlpha) { elAlpha.value = Math.round((sh.alpha == null ? 0.85 : sh.alpha) * 100); syncAlphaLabel(); }
        syncUI(); drawBoard();
      });

      elList.appendChild(chip);
    });
  }

  function syncAlphaLabel() {
    if (elAlphaVal && elAlpha) elAlphaVal.textContent = elAlpha.value + "%";
  }

  /* aplica el control editado a la forma seleccionada (o deja el valor
     como ajuste por defecto de la siguiente).
     No rehace el muestrario entero: sólo repinta la ficha que cambió. */
  function applyToSelection() {
    const sh = selShape();
    if (!sh) { syncSelInfo(); return; }
    const ui = readShapeUI();
    sh.color = ui.color; sh.tex = ui.tex; sh.mat = ui.mat; sh.alpha = ui.alpha;
    save();
    syncSelInfo();
    repaintChip(sh);
    invalidate(true, state.loaded);
  }

  function syncSelInfo() {
    if (!elSelInfo) return;
    const sh = selShape();
    if (!sh) {
      elSelInfo.textContent = "nada seleccionado — los controles fijan el ajuste de la próxima forma";
      return;
    }
    const m = MAT_BY_ID[sh.mat] || MAT_BY_ID.vitral;
    elSelInfo.textContent = "forma " + (state.shapes.indexOf(sh) + 1) + " · " +
      m[1] + " · " + (TEX_LABEL[sh.tex] || sh.tex) + " · " +
      Math.round((sh.alpha == null ? 0.85 : sh.alpha) * 100) + "%";
  }

  function repaintChip(sh) {
    const cv = chipMap[sh.id];
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, 44, 44);
    c.fillStyle = BG_CSS;
    c.fillRect(0, 0, 44, 44);
    paintThumb(c, sh, 44, 44);
  }

  /* ── pantalla completa ── */
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function toggleFullscreen(host) {
    if (fsElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = host.requestFullscreen || host.webkitRequestFullscreen;
      if (req) req.call(host);
    }
  }

  /* ════════════════════════════════════════════════════════════
     BOOT
     ════════════════════════════════════════════════════════════ */
  function boot() {
    const sec = document.getElementById("sec-kaleidoscopio");
    if (!sec || !THREE) return;

    load();

    board.el = document.getElementById("kal-draw");
    board.ctx = board.el.getContext("2d");
    tube.el = document.getElementById("kal-canvas");
    tube.lens = document.getElementById("kal-lens");
    tube.ring = document.getElementById("kal-ring");
    const tubePane = document.getElementById("kal-tube-pane");

    elColor = document.getElementById("kal-color");
    elTex = document.getElementById("kal-texture");
    elMat = document.getElementById("kal-material");
    elAlpha = document.getElementById("kal-alpha");
    elAlphaVal = document.getElementById("kal-alpha-val");
    elList = document.getElementById("kal-list");
    elCount = document.getElementById("kal-count");
    elBadge = document.getElementById("kal-badge");
    elEmpty = document.getElementById("kal-empty");
    elClosePoly = document.getElementById("kal-close-poly");
    elSelInfo = document.getElementById("kal-sel-info");

    TEXTURES.forEach(function (t) {
      const o = document.createElement("option");
      o.value = t[0]; o.textContent = t[1];
      elTex.appendChild(o);
    });
    elTex.value = "vidrio";
    MATERIALS.forEach(function (m) {
      const o = document.createElement("option");
      o.value = m[0]; o.textContent = m[1];
      elMat.appendChild(o);
    });
    elMat.value = "vitral";

    const layoutEl = document.getElementById("kal-layout");
    LAYOUTS.forEach(function (l) {
      const o = document.createElement("option");
      o.value = l[0]; o.textContent = l[1];
      layoutEl.appendChild(o);
    });
    layoutEl.value = state.tube.layout;
    layoutEl.addEventListener("change", function () {
      state.tube.layout = layoutEl.value;
      save();
      invalidate(true, state.loaded);
    });

    const previewEl = document.getElementById("kal-preview");
    previewEl.addEventListener("click", function () {
      board.preview = !board.preview;
      previewEl.classList.toggle("on", board.preview);
      previewEl.setAttribute("aria-pressed", String(board.preview));
      board.el.classList.toggle("kal-viewing", board.preview);
      if (board.preview) cancelDraft();
      invalidate(true, false);
    });

    syncAlphaLabel();

    /* ── herramientas ── (sólo los botones con data-tool: «cerrar» no lo es) */
    const toolBtns = document.querySelectorAll(".kal-tool[data-tool]");
    toolBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        cancelDraft();
        state.tool = TOOLS.indexOf(b.dataset.tool) >= 0 ? b.dataset.tool : "libre";
        toolBtns.forEach(function (x) { x.classList.toggle("active", x === b); });
        syncUI();
      });
    });

    /* ── dibujo ── */
    board.el.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0 || board.preview) return;
      const p = boardPos(ev);

      if (state.tool === "poligono") {
        ev.preventDefault();
        if (!state.draft) {
          if (state.shapes.length >= MAX_SHAPES) { flashLimit(); return; }
          clearSelection();
          state.draft = newDraft([p], false);
        } else {
          const first = state.draft.pts[0];
          if (state.draft.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 0.035) {
            commitDraft(); return;
          }
          state.draft.pts.push(p);
        }
        state.hover = p;
        syncUI(); drawBoard();
        return;
      }

      if (state.shapes.length >= MAX_SHAPES) { flashLimit(); return; }
      ev.preventDefault();
      board.el.setPointerCapture(ev.pointerId);
      board.drawing = true;
      clearSelection();

      if (state.tool === "libre") {
        state.draft = newDraft([p], true);
      } else {
        state.draft = newDraft(primitive(state.tool, p[0], p[1], 0.02, 0), false);
        state.draft.origin = p;
      }
      drawBoard();
    });

    board.el.addEventListener("pointermove", function (ev) {
      const p = boardPos(ev);
      if (state.tool === "poligono") {
        if (state.draft) { state.hover = p; invalidate(true, false); }
        return;
      }
      if (!board.drawing || !state.draft) return;
      ev.preventDefault();

      if (state.tool === "libre") {
        const last = state.draft.pts[state.draft.pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.008) state.draft.pts.push(p);
      } else {
        const o = state.draft.origin;
        const dx = p[0] - o[0], dy = p[1] - o[1];
        const rad = Math.max(0.015, Math.hypot(dx, dy));
        const rot = Math.atan2(dy, dx) + Math.PI / 2;
        state.draft.pts = primitive(state.tool, o[0], o[1], rad, rot);
      }
      invalidate(true, false);
    });

    function endStroke(ev) {
      if (!board.drawing) return;
      board.drawing = false;
      try { board.el.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (state.draft && state.tool === "libre") {
        state.draft.pts = simplify(state.draft.pts, 0.006);
      }
      commitDraft();
    }
    board.el.addEventListener("pointerup", endStroke);
    board.el.addEventListener("pointercancel", endStroke);
    board.el.addEventListener("dblclick", function (ev) {
      if (state.tool === "poligono" && state.draft) { ev.preventDefault(); commitDraft(); }
    });
    board.el.addEventListener("contextmenu", function (ev) {
      if (state.draft) { ev.preventDefault(); cancelDraft(); syncUI(); }
    });

    document.addEventListener("keydown", function (ev) {
      if (/input|textarea|select/i.test(ev.target.tagName)) return;
      if (!sec.classList.contains("active")) return;
      if (ev.key === "Escape" && state.draft) { cancelDraft(); syncUI(); }
      else if (ev.key === "Enter" && state.draft) { commitDraft(); }
      else if ((ev.key === "f" || ev.key === "F") && !ev.ctrlKey && !ev.metaKey) toggleFullscreen(tubePane);
    });

    if (elClosePoly) elClosePoly.addEventListener("click", function () {
      if (state.draft) commitDraft();
    });

    /* ── color / textura / material / opacidad ── */
    elColor.addEventListener("input", applyToSelection);
    elTex.addEventListener("change", applyToSelection);
    elMat.addEventListener("change", applyToSelection);
    elAlpha.addEventListener("input", function () { syncAlphaLabel(); applyToSelection(); });

    /* ── acciones del taller ── */
    document.getElementById("kal-undo").addEventListener("click", function () {
      if (state.draft) { cancelDraft(); syncUI(); return; }
      const gone = state.shapes.pop();
      if (gone && state.sel === gone.id) state.sel = null;
      if (!state.shapes.length) state.loaded = false;
      save(); syncUI(); drawBoard(); repaintSource();
    });

    document.getElementById("kal-clear").addEventListener("click", function () {
      state.shapes = []; state.sel = null; state.draft = null; state.loaded = false;
      save(); syncUI(); drawBoard(); repaintSource();
    });

    document.getElementById("kal-load").addEventListener("click", function () {
      if (!state.shapes.length) { flashLimit(); return; }
      state.loaded = true;
      save();
      repaintSource();
      tube.drop = 0;                       // las formas caen dentro del tubo
      tube.vel += 2.6;                     // y el tubo da un tirón
      syncUI();
      if (tube.lens) tube.lens.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    /* ── controles del tubo ── */
    const segEl = document.getElementById("kal-seg");
    const segVal = document.getElementById("kal-seg-val");
    const zoomEl = document.getElementById("kal-zoom");
    const spinEl = document.getElementById("kal-spin");
    const prismEl = document.getElementById("kal-prism");
    const warpEl = document.getElementById("kal-warp");
    const leadEl = document.getElementById("kal-lead");
    const auraEl = document.getElementById("kal-aura");
    const autoEl = document.getElementById("kal-auto");
    const glyphEl = document.getElementById("kal-glyphs");

    segEl.value = state.tube.seg;
    zoomEl.value = Math.round(state.tube.zoom * 100);
    spinEl.value = Math.round(state.tube.spin * 100);
    prismEl.value = Math.round(state.tube.prism * 100);
    warpEl.value = Math.round(state.tube.warp * 100);
    leadEl.value = Math.round(state.tube.lead * 100);
    auraEl.value = Math.round(state.tube.aura * 100);
    segVal.textContent = state.tube.seg + " × 2";

    function toggleBtn(el, on) {
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", String(on));
    }
    toggleBtn(autoEl, state.tube.auto);
    toggleBtn(glyphEl, state.tube.glyphs);

    segEl.addEventListener("input", function () {
      state.tube.seg = +segEl.value;
      segVal.textContent = state.tube.seg + " × 2";
      save();
    });
    zoomEl.addEventListener("input", function () { state.tube.zoom = +zoomEl.value / 100; save(); });
    spinEl.addEventListener("input", function () { state.tube.spin = +spinEl.value / 100; save(); });
    prismEl.addEventListener("input", function () { state.tube.prism = +prismEl.value / 100; save(); });
    warpEl.addEventListener("input", function () { state.tube.warp = +warpEl.value / 100; save(); });
    leadEl.addEventListener("input", function () { state.tube.lead = +leadEl.value / 100; save(); });
    auraEl.addEventListener("input", function () { state.tube.aura = +auraEl.value / 100; save(); });

    autoEl.addEventListener("click", function () {
      state.tube.auto = !state.tube.auto;
      toggleBtn(autoEl, state.tube.auto);
      save();
    });
    glyphEl.addEventListener("click", function () {
      state.tube.glyphs = !state.tube.glyphs;
      toggleBtn(glyphEl, state.tube.glyphs);
      drawRing();
      save();
    });

    document.getElementById("kal-shot").addEventListener("click", function () {
      if (!tube.renderer) return;
      try {
        const a = document.createElement("a");
        a.download = "pandora-caleidoscopio.png";
        a.href = tube.renderer.domElement.toDataURL("image/png");
        a.click();
      } catch (e) {}
    });

    /* ── pantalla completa ── */
    const fsBtn = document.getElementById("kal-fs");
    fsBtn.addEventListener("click", function () { toggleFullscreen(tubePane); });

    let idleTimer = 0;
    function wakeHud() {
      tubePane.classList.remove("kal-idle");
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (fsElement()) tubePane.classList.add("kal-idle");
      }, 2600);
    }
    function onFsChange() {
      const on = !!fsElement();
      tubePane.classList.toggle("kal-fs", on);
      fsBtn.textContent = on ? "⤡ salir" : "⛶ pantalla completa";
      tubePane.classList.remove("kal-idle");
      clearTimeout(idleTimer);
      if (on) { tube.visible = true; wakeHud(); }
      // el layout llega un cuadro tarde: el navegador aún está redimensionando
      requestAnimationFrame(function () { requestAnimationFrame(layoutTube); });
      setTimeout(layoutTube, 220);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    tubePane.addEventListener("pointermove", function () { if (fsElement()) wakeHud(); });

    /* ── girar el tubo con el puntero ── */
    tube.el.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      tube.el.setPointerCapture(ev.pointerId);
      tube.dragging = true;
      tube.lastX = ev.clientX;
      tube.vel = 0;
    });
    tube.el.addEventListener("pointermove", function (ev) {
      if (!tube.dragging) return;
      const dx = ev.clientX - tube.lastX;
      tube.lastX = ev.clientX;
      const d = dx * 0.008;
      tube.rot += d;
      tube.vel = d * 26;                                   // se conserva al soltar
    });
    function endDrag(ev) {
      if (!tube.dragging) return;
      tube.dragging = false;
      try { tube.el.releasePointerCapture(ev.pointerId); } catch (e) {}
    }
    tube.el.addEventListener("pointerup", endDrag);
    tube.el.addEventListener("pointercancel", endDrag);
    tube.el.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      state.tube.zoom = Math.max(0.35, Math.min(3, state.tube.zoom * Math.exp(-ev.deltaY * 0.0012)));
      zoomEl.value = Math.round(state.tube.zoom * 100);
      save();
    }, { passive: false });
    tube.el.addEventListener("dblclick", function () { autoEl.click(); });

    /* ── arranque del render ── */
    if (!ensureTube()) {
      if (elEmpty) {
        elEmpty.innerHTML = "este navegador no tiene WebGL<br><span>el tubo necesita aceleración gráfica</span>";
        elEmpty.style.display = "";
      }
      syncUI();
      layoutBoard();
      return;
    }
    tube.t0 = performance.now();
    tube.drop = 1;

    let roT = 0;
    const ro = new ResizeObserver(function () {
      clearTimeout(roT);
      roT = setTimeout(function () { layoutBoard(); layoutTube(); }, 60);
    });
    ro.observe(board.el.parentNode);
    ro.observe(tube.lens);

    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (fsElement()) return;                 // en pantalla completa siempre corre
        tube.visible = en.isIntersecting;
        if (en.isIntersecting) { tube.last = 0; layoutBoard(); layoutTube(); }
      });
    }, { threshold: 0.02 });
    io.observe(tube.lens);

    repaintSource();
    syncUI();
    layoutBoard();
    layoutTube();
    tube.raf = requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
