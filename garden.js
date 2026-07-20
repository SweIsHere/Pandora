/* ============================================================
   PANDORA — garden.js  ·  "Babilonia Garden"
   ------------------------------------------------------------
   Jardín ASCII 3D: plantás una SEMILLA (texto) y crece una flor
   DETERMINISTA modelada en three.js —tallo, hojas, centro y
   pétalos son geometría 3D real, dispuesta según un PRNG
   (mulberry32) sembrado con un hash FNV-1a del texto. Misma
   semilla → misma flor, siempre.

   La flor se renderiza con una cámara ORTOGRÁFICA ISOMÉTRICA
   (posición (1,1,1) normalizada, recorte "contain" ajustado al
   bounding box) sobre un contexto WebGL compartido y oculto; el
   frame se vuelca a una rejilla de caracteres —igual técnica que
   el retrato/koi de ascii.js (drawImage a baja resolución +
   getImageData)—, clasificando cada celda como "pétalo/centro" o
   "tallo/hoja" por distancia de color, y eligiendo su glifo con
   DITHERING ORDENADO (mismo ruido de gradiente interleaved que
   ascii.js) sobre una rampa de densidad que remata en el glifo
   propio de cada flor —así el sombreado 3D queda como textura
   ASCII continua en vez de puntos sueltos. Cada flor "respira"
   con un balanceo sinusoidal lento (des-sincronizado por semilla)
   recalculado sólo mientras está en pantalla (IntersectionObserver),
   respetando prefers-reduced-motion.

   Las semillas persisten en localStorage. Clic en una flor = la
   arrancás.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const KEY = "pandora_garden";
  const TAU = Math.PI * 2;
  const REDUCED_MOTION = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ── PRNG determinista a partir del texto ── */
  function hashStr(s) {
    let h = 2166136261 >>> 0;                 // FNV-1a 32-bit
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
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

  /* ── paletas de rasgos ── */
  const PETALS  = ["@", "*", "o", "&", "%", "8", "#", "+", "x"];
  const CENTERS = ["o", "O", "@", "0", "*", "."];
  const BLOOMS  = [
    "#c0392b", "#d35400", "#e67e22", "#f1c40f", "#8e44ad",
    "#9b2d86", "#c2417a", "#2980b9", "#16a085", "#e84393",
    "#6c5ce7", "#243ec4", "#d81b60"
  ];
  const STEMCOLS = ["#3a7d34", "#2e7d32", "#4c9a2a", "#5a8f29"];

  /* recetas de cabeza: cuenta/apertura/radio de pétalos, tamaño de
     centro y si la flor "cuelga" (campana) o apila dos anillos (rosa) */
  const STYLES = [
    { name: "margarita", petalCount: [11, 15], openAngle: 0.10, ringRadius: 0.46, centerR: 0.15, petalLen: 0.50, petalW: 0.15, hang: false, rings: 1 },
    { name: "girasol",   petalCount: [15, 20], openAngle: 0.18, ringRadius: 0.62, centerR: 0.32, petalLen: 0.70, petalW: 0.19, hang: false, rings: 1 },
    { name: "tulipán",   petalCount: [5, 6],   openAngle: 1.10, ringRadius: 0.16, centerR: 0.05, petalLen: 0.56, petalW: 0.24, hang: false, rings: 1 },
    { name: "campana",   petalCount: [5, 6],   openAngle: 0.80, ringRadius: 0.20, centerR: 0.09, petalLen: 0.44, petalW: 0.22, hang: true,  rings: 1 },
    { name: "rosa",      petalCount: [7, 9],   openAngle: 0.60, ringRadius: 0.26, centerR: 0.07, petalLen: 0.40, petalW: 0.22, hang: false, rings: 2 }
  ];

  /* ── util color ── */
  function hexToRGB(hex) {
    const v = parseInt(hex.replace("#", ""), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function distSq(r, g, b, rgb) {
    const dr = r - rgb[0], dg = g - rgb[1], db = b - rgb[2];
    return dr * dr + dg * dg + db * db;
  }
  function toHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* petal/leaf: cono aplastado, base en el origen local (x=0),
     punta en x=len — así se puede "abrir" rotando alrededor de
     la base antes de desplazarlo al radio del anillo. */
  function bladeGeometry(w, len, thin, segs) {
    const geo = new THREE.ConeGeometry(w / 2, len, segs || 6, 1);
    geo.rotateZ(-Math.PI / 2);
    geo.translate(len / 2, 0, 0);
    geo.scale(1, thin, 1);
    return geo;
  }

  /* ── modelo 3D determinista de la flor ── */
  function buildFlower(seed) {
    const rnd = mulberry32(hashStr(seed));
    const style = STYLES[Math.floor(rnd() * STYLES.length)];
    const petalChar  = PETALS[Math.floor(rnd() * PETALS.length)];
    const centerChar = CENTERS[Math.floor(rnd() * CENTERS.length)];
    const bloomHex = BLOOMS[Math.floor(rnd() * BLOOMS.length)];
    const stemHex  = STEMCOLS[Math.floor(rnd() * STEMCOLS.length)];
    const bloomRGB = hexToRGB(bloomHex);
    const stemRGB  = hexToRGB(stemHex);

    const stemH = 0.55 + rnd() * 0.9;

    const bloomMat  = new THREE.MeshStandardMaterial({ color: bloomHex, flatShading: true, roughness: 0.7 });
    const centerMat = new THREE.MeshStandardMaterial({ color: bloomHex, flatShading: true, roughness: 0.5, emissive: new THREE.Color(bloomHex), emissiveIntensity: 0.08 });
    const stemMat   = new THREE.MeshStandardMaterial({ color: stemHex, flatShading: true, roughness: 0.8 });

    const root = new THREE.Group();

    /* tallo */
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.045, stemH, 6), stemMat);
    stem.position.y = stemH / 2;
    root.add(stem);

    /* hojas */
    const leaves = [];
    const leafCount = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < leafCount; i++) {
      const leafY = stemH * (0.18 + rnd() * 0.55);
      const side = rnd() < 0.5 ? -1 : 1;
      const leafAngle = (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.6;
      const leafLen = 0.18 + rnd() * 0.16;

      const leafMesh = new THREE.Mesh(bladeGeometry(0.15, leafLen, 0.14, 5), stemMat);
      const lift = new THREE.Group();
      lift.rotation.z = 0.35 + rnd() * 0.35;
      lift.add(leafMesh);
      const mount = new THREE.Group();
      mount.position.set(0.03, leafY, 0);
      mount.rotation.y = leafAngle;
      mount.add(lift);
      root.add(mount);

      leaves.push({
        local: new THREE.Vector3(Math.cos(leafAngle) * leafLen * 0.55, leafY + leafLen * 0.10, Math.sin(leafAngle) * leafLen * 0.55),
        ch: side < 0 ? "<" : ">"
      });
    }

    /* cabeza (pétalos + centro) */
    const head = new THREE.Group();
    head.position.y = stemH;
    if (style.hang) head.rotation.x = Math.PI * 0.92;   // cuelga boca abajo (campana)

    head.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.02, style.centerR), 8, 6), centerMat));

    const rings = style.rings || 1;
    for (let ring = 0; ring < rings; ring++) {
      const outer = ring === 1;
      const count  = Math.round(style.petalCount[0] + rnd() * (style.petalCount[1] - style.petalCount[0]));
      const openA  = outer ? style.openAngle * 0.5 : style.openAngle;
      const rad    = outer ? style.ringRadius * 1.7 : style.ringRadius;
      const len0   = outer ? style.petalLen * 1.3 : style.petalLen;
      const angOff = outer ? Math.PI / count : 0;

      for (let i = 0; i < count; i++) {
        const len = len0 * (0.85 + rnd() * 0.3);
        const w   = style.petalW * (0.85 + rnd() * 0.3);
        const mesh = new THREE.Mesh(bladeGeometry(w, len, 0.22, 6), bloomMat);

        const theta = (i / count) * TAU + angOff;
        const mount = new THREE.Group();
        mount.position.x = rad;
        mount.rotation.z = openA;
        mount.add(mesh);
        const pivot = new THREE.Group();
        pivot.rotation.y = theta;
        pivot.add(mount);
        head.add(pivot);
      }
    }
    root.add(head);

    const baseAngle  = rnd() * TAU;
    const swaySpeed  = 0.5 + rnd() * 0.6;
    const swayAmp    = 0.10 + rnd() * 0.10;
    root.rotation.y = baseAngle;

    return {
      root, bloomHex, stemHex, bloomRGB, stemRGB, petalChar, centerChar,
      name: style.name, centerLocal: new THREE.Vector3(0, stemH, 0),
      leaves, baseAngle, swaySpeed, swayAmp
    };
  }

  /* ════════════════════════════════════════════════════════════
     RENDER → ASCII (contexto WebGL compartido, oculto)
     ════════════════════════════════════════════════════════════ */
  const COLS_MAX = 30, ROWS_MAX = 32, SS = 10;
  const RENDER_W = COLS_MAX * SS, RENDER_H = ROWS_MAX * SS;
  const CHAR_ASPECT = 0.55;                          // ancho/alto típico de una celda monoespaciada
  const GRID_ASPECT = (COLS_MAX * CHAR_ASPECT) / ROWS_MAX;
  const CENTER_RADIUS = 2.2, LEAF_RADIUS = 1.7;

  /* dithering ordenado — mismo ruido de gradiente interleaved que
     ascii.js usa para el retrato y los koi, así la rejilla de la
     flor queda densa/continua en vez de puntos sueltos por umbral */
  function fract(v) { return v - Math.floor(v); }
  function ign(x, y) { return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y)); }
  function rampChar(ramp, lum, x, y) {
    const ink = Math.pow(Math.max(0, 1 - lum / 255), 0.85);
    const levels = ramp.length - 1;
    let li = ink * levels + (ign(x, y) - 0.5) * 1.15;
    li = Math.max(0, Math.min(levels, Math.round(li)));
    return ramp[li];
  }
  const RAMP_BASE = " .,:;-=+";      // rampa compartida por tallo y hojas (remata en su propio glifo)

  let renderer = null, sctx = null;
  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(RENDER_W, RENDER_H, false);
    const scratch = document.createElement("canvas");
    scratch.width = COLS_MAX; scratch.height = ROWS_MAX;
    sctx = scratch.getContext("2d", { willReadFrequently: true });
  }

  /* cámara ortográfica isométrica ajustada ("contain") al bounding box */
  function frameIsometric(box, aspect) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = size.length() * 2.2 + 2;
    const dir = new THREE.Vector3(1, 1, 1).normalize();

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, dist * 3);
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);

    const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(
        (i & 1) ? box.max.x : box.min.x,
        (i & 2) ? box.max.y : box.min.y,
        (i & 4) ? box.max.z : box.min.z
      ).applyMatrix4(inv);
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
    const padX = (maxX - minX) * 0.14 + 0.06;
    const padY = (maxY - minY) * 0.14 + 0.06;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;

    let w = maxX - minX, h = maxY - minY;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;

    cam.left = cx - w / 2; cam.right = cx + w / 2;
    cam.top = cy + h / 2; cam.bottom = cy - h / 2;
    cam.updateProjectionMatrix();
    return cam;
  }

  function worldToCell(v, camera) {
    const p = v.clone().project(camera);
    return [(p.x * 0.5 + 0.5) * COLS_MAX, (1 - (p.y * 0.5 + 0.5)) * ROWS_MAX];
  }

  /* renderiza el frame actual y clasifica cada celda visible en
     un glifo (pétalo/centro/tallo/hoja) + su color muestreado
     (que ya trae el sombreado de las luces, dando profundidad) */
  function computeGrid(ctrl) {
    renderer.setClearColor(0x000000, 0);
    renderer.render(ctrl.scene, ctrl.camera);
    sctx.clearRect(0, 0, COLS_MAX, ROWS_MAX);
    sctx.drawImage(renderer.domElement, 0, 0, RENDER_W, RENDER_H, 0, 0, COLS_MAX, ROWS_MAX);
    const d = sctx.getImageData(0, 0, COLS_MAX, ROWS_MAX).data;

    ctrl.root.updateMatrixWorld(true);
    const centerCell = worldToCell(ctrl.centerLocal.clone().applyMatrix4(ctrl.root.matrixWorld), ctrl.camera);
    const leafCells = ctrl.leaves.map(function (lf) {
      return { cell: worldToCell(lf.local.clone().applyMatrix4(ctrl.root.matrixWorld), ctrl.camera), ch: lf.ch };
    });

    const n = COLS_MAX * ROWS_MAX;
    const chars = new Array(n).fill(" ");
    const colors = new Array(n).fill(null);
    let minR = ROWS_MAX, maxR = -1, minC = COLS_MAX, maxC = -1;

    for (let y = 0; y < ROWS_MAX; y++) {
      for (let x = 0; x < COLS_MAX; x++) {
        const i = (y * COLS_MAX + x) * 4;
        const a = d[i + 3];
        if (a < 14) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const dHead = distSq(r, g, b, ctrl.bloomRGB);
        const dStem = distSq(r, g, b, ctrl.stemRGB);
        let ch;
        if (dHead <= dStem) {
          const dx = (x - centerCell[0]) * CHAR_ASPECT, dy = (y - centerCell[1]);
          ch = Math.hypot(dx, dy) < CENTER_RADIUS ? ctrl.centerChar : rampChar(ctrl.headRamp, lum, x, y);
        } else {
          ch = rampChar(ctrl.stemRamp, lum, x, y);
          for (let k = 0; k < leafCells.length; k++) {
            const lf = leafCells[k];
            const dx = (x - lf.cell[0]) * CHAR_ASPECT, dy = (y - lf.cell[1]);
            if (Math.hypot(dx, dy) < LEAF_RADIUS) { ch = rampChar(RAMP_BASE + lf.ch, lum, x, y); break; }
          }
        }
        if (ch === " ") continue;
        const p = y * COLS_MAX + x;
        chars[p] = ch;
        colors[p] = toHex(r, g, b);
        if (y < minR) minR = y; if (y > maxR) maxR = y;
        if (x < minC) minC = x; if (x > maxC) maxC = x;
      }
    }
    return { chars: chars, colors: colors, minR: minR, maxR: maxR, minC: minC, maxC: maxC };
  }

  function padCrop(grid) {
    if (grid.maxR < 0) return { r0: 0, r1: 0, c0: 0, c1: 0 };
    return {
      r0: Math.max(0, grid.minR - 1),
      r1: Math.min(ROWS_MAX - 1, grid.maxR + 1),
      c0: Math.max(0, grid.minC - 1),
      c1: Math.min(COLS_MAX - 1, grid.maxC + 1)
    };
  }

  function gridToHTML(chars, colors, r0, r1, c0, c1) {
    const rows = [];
    for (let y = r0; y <= r1; y++) {
      let row = "", runColor = null, run = "";
      for (let x = c0; x <= c1; x++) {
        const p = y * COLS_MAX + x;
        const col = colors[p];
        if (col !== runColor) {
          if (run) row += runColor ? '<span style="color:' + runColor + '">' + esc(run) + "</span>" : esc(run);
          run = ""; runColor = col;
        }
        run += chars[p];
      }
      if (run) row += runColor ? '<span style="color:' + runColor + '">' + esc(run) + "</span>" : esc(run);
      rows.push(row);
    }
    return rows.join("\n");
  }

  /* ── controlador por flor: modelo + escena + cámara fija + estado de animación ── */
  function makeController(seed) {
    const f = buildFlower(seed);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeaf0ff, 0x5a3f22, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    sun.position.set(2.4, 3.6, 2.0);
    scene.add(sun);
    scene.add(f.root);

    f.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(f.root);
    const camera = frameIsometric(box, GRID_ASPECT);

    return {
      seed: seed, scene: scene, camera: camera, root: f.root,
      bloomRGB: f.bloomRGB, stemRGB: f.stemRGB,
      petalChar: f.petalChar, centerChar: f.centerChar, name: f.name,
      headRamp: " .,:;-=+*o#%@" + f.petalChar,
      stemRamp: RAMP_BASE + "|",
      centerLocal: f.centerLocal, leaves: f.leaves,
      baseAngle: f.baseAngle, swaySpeed: f.swaySpeed, swayAmp: f.swayAmp,
      timeOffset: (hashStr(seed) % 1000) / 1000 * TAU,
      visible: false, preEl: null, wrapEl: null, cropRect: null
    };
  }

  function firstPaint(ctrl) {
    const grid = computeGrid(ctrl);
    ctrl.cropRect = padCrop(grid);
    return gridToHTML(grid.chars, grid.colors, ctrl.cropRect.r0, ctrl.cropRect.r1, ctrl.cropRect.c0, ctrl.cropRect.c1);
  }

  function updateAndRender(ctrl, t) {
    ctrl.root.rotation.y = ctrl.baseAngle + Math.sin((t + ctrl.timeOffset) * ctrl.swaySpeed) * ctrl.swayAmp;
    const grid = computeGrid(ctrl);
    if (ctrl.preEl) ctrl.preEl.innerHTML = gridToHTML(grid.chars, grid.colors, ctrl.cropRect.r0, ctrl.cropRect.r1, ctrl.cropRect.c0, ctrl.cropRect.c1);
  }

  /* ── persistencia ── */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }

  /* ── ciclo de vida de las flores en pantalla ── */
  let controllers = [];
  const ctrlByEl = new Map();
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      const ctrl = ctrlByEl.get(e.target);
      if (ctrl) ctrl.visible = e.isIntersecting;
    });
  }, { threshold: 0.05 });

  function disposeControllers() {
    controllers.forEach(function (ctrl) {
      if (ctrl.wrapEl) { io.unobserve(ctrl.wrapEl); ctrlByEl.delete(ctrl.wrapEl); }
      ctrl.root.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    });
    controllers = [];
  }

  function render() {
    const plot = document.getElementById("garden-plot");
    if (!plot) return;
    disposeControllers();
    const seeds = load();
    plot.innerHTML = "";
    if (!seeds.length) {
      plot.innerHTML = '<p class="empty-msg">el jardín está vacío — planta la primera semilla.</p>';
      return;
    }
    ensureRenderer();
    seeds.forEach(function (seed, idx) {
      const ctrl = makeController(seed);
      const html = firstPaint(ctrl);

      const el = document.createElement("div");
      el.className = "flower";
      el.title = "«" + seed + "» · " + ctrl.name + " — clic para arrancar";
      el.innerHTML = '<pre class="fl-art">' + html + "</pre>" + '<span class="fl-seed">' + esc(seed) + "</span>";
      el.addEventListener("click", function () {
        const all = load();
        all.splice(idx, 1);
        save(all);
        render();
      });
      plot.appendChild(el);

      ctrl.preEl = el.querySelector(".fl-art");
      ctrl.wrapEl = el;
      ctrlByEl.set(el, ctrl);
      controllers.push(ctrl);
      io.observe(el);
    });
  }

  /* balanceo lento, sólo para flores visibles, ~9 fps (de sobra
     para un vaivén; respeta prefers-reduced-motion) */
  const TICK_INTERVAL = 110;
  let lastTick = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (REDUCED_MOTION || !renderer) return;
    if (now - lastTick < TICK_INTERVAL) return;
    lastTick = now;
    const t = now * 0.001;
    for (let i = 0; i < controllers.length; i++) {
      const ctrl = controllers[i];
      if (ctrl.visible) updateAndRender(ctrl, t);
    }
  }

  function boot() {
    const form = document.getElementById("seed-form");
    if (!form) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const seed = ((new FormData(form).get("seed")) || "").trim();
      if (!seed) return;
      const all = load();
      all.push(seed);
      save(all);
      form.reset();
      render();
    });

    const clr = document.getElementById("garden-clear");
    if (clr) clr.addEventListener("click", function () {
      if (!load().length) return;
      if (!confirm("¿Vaciar el jardín?")) return;
      save([]);
      render();
    });

    render();
    requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
