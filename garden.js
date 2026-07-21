/* ============================================================
   PANDORA — garden.js  ·  "Babilonia Garden"
   ------------------------------------------------------------
   Una PRADERA 3D única y NAVEGABLE: en vez de una tarjeta por
   flor, hay UN solo terreno amplio (una losa de césped) donde se
   van plantando todas las flores. Cada SEMILLA (texto) genera una
   flor DETERMINISTA modelada en three.js —tallo, hojas, centro y
   pétalos son geometría 3D real, dispuesta según un PRNG
   (mulberry32) sembrado con un hash FNV-1a del texto. Misma
   semilla → misma flor, siempre.

   La escena se recorre con una cámara EN PERSPECTIVA de órbita
   libre: arrastrar gira (azimut/elevación), la rueda o +/− acercan
   (dolly) y WASD/flechas desplazan el objetivo por el campo → te
   movés dentro del jardín. Se renderiza sobre un renderer WebGL
   compartido y oculto; el frame pasa por un PASE DE POSPROCESO que
   aplica un FILTRO DE DITHERING ordenado (el mismo ruido de
   gradiente interleaved que usa ascii.js para el retrato y los
   koi) cuantizando el color a pocos niveles: el resultado 3D queda
   como una imagen tramada retro, volcada a un único <canvas> ancho
   y escalada con pixelado nítido.

   Las flores se disponen en una cuadrícula sobre la losa (con un
   leve jitter determinista por semilla) y "respiran" con un
   balanceo sinusoidal lento, sólo mientras la sección está en
   pantalla (IntersectionObserver), respetando
   prefers-reduced-motion. Cada semilla lleva su etiqueta flotante
   proyectada bajo la flor. Un toque en una flor = la arrancás
   (raycasting). Vista y semillas persisten en localStorage.
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
  const BLOOMS  = [
    "#c0392b", "#d35400", "#e67e22", "#f1c40f", "#8e44ad",
    "#9b2d86", "#c2417a", "#2980b9", "#16a085", "#e84393",
    "#6c5ce7", "#243ec4", "#d81b60", "#ff7675", "#fd79a8",
    "#fdcb6e", "#00b894", "#0984e3", "#a29bfe", "#e17055",
    "#ff5e78", "#7ed6df", "#f78fb3", "#c56cf0", "#ffb8b8",
    "#f5f0e1", "#ffd32a", "#40739e", "#e84118", "#9c88ff"
  ];
  const STEMCOLS = ["#3a7d34", "#2e7d32", "#4c9a2a", "#5a8f29", "#6b8e23", "#3d6b35", "#2f6b4f", "#54792f"];

  /* paletas propias por especie: algunas flores tienen un color
     "real" reconocible (gardenia blanca, buganvilla magenta…) así
     que no sortean de la paleta genérica sino de la suya */
  const CARNATION_COLORS = ["#e91e63", "#f06292", "#ffffff", "#f8bbd0", "#c2185b", "#ff8a80"];
  const GARDENIA_COLORS  = ["#fffdf7", "#fff6e3", "#f7f1dc"];
  const ORCHID_COLORS    = ["#9b59b6", "#c39bd3", "#f7c6de", "#8e44ad", "#ffffff", "#d199e0"];
  const LILY_COLORS      = ["#ffffff", "#ffcc80", "#f48fb1", "#fff3e0", "#ffe0b2"];
  const LOTV_COLORS      = ["#ffffff", "#f7f5e6"];
  const BOUGAIN_COLORS   = ["#c2185b", "#8e24aa", "#ff6f00", "#e91e63", "#ad1457", "#6a1b9a"];
  const POPPY_COLORS     = ["#e74c3c", "#ff6b4a", "#d63031", "#ff7f50", "#f95d6a", "#ff4757"];
  const DAHLIA_COLORS    = ["#d81b60", "#f06292", "#ff7043", "#ffca28", "#ab47bc", "#ec407a", "#ef5350"];
  const COSMOS_COLORS    = ["#f06292", "#f8bbd0", "#ffffff", "#e91e63", "#ba68c8", "#ce93d8"];
  const ANEMONE_COLORS   = ["#ffffff", "#f48fb1", "#ce93d8", "#ef9a9a", "#b39ddb", "#f5f0fa"];
  const HIBISCUS_COLORS  = ["#ff1744", "#ff5252", "#ff4081", "#ff6e40", "#f50057", "#ff8a65"];
  const IRIS_COLORS      = ["#5c6bc0", "#7986cb", "#4527a0", "#9575cd", "#30336b", "#6c5ce7"];
  const LAVENDER_COLORS  = ["#967bb6", "#8e7cc3", "#b39ddb", "#7e57c2", "#9575cd"];
  const DANDELION_COLORS = ["#fdfdf5", "#fffef0", "#f5f2e3"];

  /* ángulo áureo (Vogel/filotaxis): θ = n · 137.5° → el empaquetado
     en espiral de los flósculos del disco (girasol, margarita…) */
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  /* evita colores OSCUROS en las flores: sube el brillo (L de HSL) a
     un piso, conservando tono y saturación. Así ningún pétalo/centro
     queda apagado, aun si la paleta trae un tono profundo. */
  function brighten(hex, floorL) {
    floorL = floorL == null ? 0.54 : floorL;
    const v = parseInt(hex.slice(1), 16);
    let r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let l = (max + min) / 2, s = 0, h = 0;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    if (l >= floorL) return hex;
    l = floorL;
    if (s === 0) { const c = Math.round(l * 255); return "#" + ((1 << 24) + (c << 16) + (c << 8) + c).toString(16).slice(1); }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = function (t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const to = function (x) { return Math.round(Math.min(1, Math.max(0, x)) * 255); };
    return "#" + ((1 << 24) + (to(hue(h + 1 / 3)) << 16) + (to(hue(h)) << 8) + to(hue(h - 1 / 3))).toString(16).slice(1);
  }

  /* disco de flósculos en espiral filotáctica (modelo de Vogel): en
     vez de una esfera lisa, el centro de las flores compuestas se
     rellena con decenas de flósculos colocados en el ángulo áureo,
     formando las dos familias de espirales (horaria/antihoraria) que
     se ven en un girasol real. Abombado como una cúpula suave. */
  function addFloretDisk(head, rnd, style, centerMat) {
    const R = style.centerR;
    const n = Math.round(26 + R * 165);
    const c = R / Math.sqrt(n);                 // Vogel: r = c·√i
    const dome = R * 0.55;
    const fr = Math.max(0.011, R * 0.11);
    const geo = new THREE.SphereGeometry(fr, 4, 3);
    for (let i = 0; i < n; i++) {
      const a = i * GOLDEN_ANGLE + (rnd() - 0.5) * 0.04;
      const rr = c * Math.sqrt(i + 0.5);
      const dy = dome * (1 - (rr / R) * (rr / R)) * 0.7;   // cúpula
      const m = new THREE.Mesh(geo, centerMat);
      m.position.set(Math.cos(a) * rr, Math.max(0, dy), Math.sin(a) * rr);
      m.scale.setScalar(0.65 + (rr / R) * 0.6);            // menudos en el ojo, mayores al borde
      head.add(m);
    }
  }

  /* recetas de cabeza: cuenta/apertura/radio de pétalos, tamaño de
     centro y anillos (una flor "single" apila 1-3 anillos de pétalos,
     el más externo más ancho y plano). Flags especiales:
       hang     → cuelga boca abajo (campana)
       ruffle   → pétalos con leve giro aleatorio (volante, clavel)
       lip      → añade un pétalo inferior agrandado (labelo, orquídea)
       stamens  → añade estambres radiales desde el centro (lirio)
       palette / centerHex → color propio en vez de la paleta genérica
     Las especies "raceme" (lirio de los valles) y "cluster"
     (buganvilla) no usan estos campos: tienen su propio constructor
     porque su forma no es "una cabeza en la punta del tallo". */
  const STYLES = [
    { name: "margarita", petalCount: [11, 15], openAngle: 0.10, ringRadius: 0.46, centerR: 0.15, petalLen: 0.50, petalW: 0.15, hang: false, rings: 1, disk: true },
    { name: "girasol",   petalCount: [15, 20], openAngle: 0.18, ringRadius: 0.62, centerR: 0.32, petalLen: 0.70, petalW: 0.19, hang: false, rings: 1, disk: true },
    { name: "tulipán",   petalCount: [5, 6],   openAngle: 1.10, ringRadius: 0.16, centerR: 0.05, petalLen: 0.56, petalW: 0.24, hang: false, rings: 1 },
    { name: "campana",   petalCount: [5, 6],   openAngle: 0.80, ringRadius: 0.20, centerR: 0.09, petalLen: 0.44, petalW: 0.22, hang: true,  rings: 1 },
    { name: "rosa",      petalCount: [7, 9],   openAngle: 0.60, ringRadius: 0.26, centerR: 0.07, petalLen: 0.40, petalW: 0.22, hang: false, rings: 2 },
    { name: "clavel",    petalCount: [24, 30], openAngle: 0.55, ringRadius: 0.18, centerR: 0.05, petalLen: 0.30, petalW: 0.14, hang: false, rings: 3, ruffle: true, palette: CARNATION_COLORS },
    { name: "gardenia",  petalCount: [8, 11],  openAngle: 0.30, ringRadius: 0.20, centerR: 0.05, petalLen: 0.30, petalW: 0.19, hang: false, rings: 3, palette: GARDENIA_COLORS, centerHex: "#f5e59a" },
    { name: "orquídea",  petalCount: [5, 5],   openAngle: 0.35, ringRadius: 0.20, centerR: 0.05, petalLen: 0.34, petalW: 0.15, hang: false, rings: 1, lip: true, palette: ORCHID_COLORS },
    { name: "lirio",     petalCount: [6, 6],   openAngle: 0.95, ringRadius: 0.12, centerR: 0.05, petalLen: 0.60, petalW: 0.19, hang: false, rings: 1, stamens: true, palette: LILY_COLORS, centerHex: "#c0783c" },
    { name: "amapola",   petalCount: [4, 6],   openAngle: 0.50, ringRadius: 0.18, centerR: 0.10, petalLen: 0.40, petalW: 0.34, hang: false, rings: 1, ruffle: true, palette: POPPY_COLORS, centerHex: "#26262b" },
    { name: "dalia",     petalCount: [10, 13], openAngle: 0.50, ringRadius: 0.16, centerR: 0.06, petalLen: 0.34, petalW: 0.16, hang: false, rings: 3, ruffle: true, palette: DAHLIA_COLORS },
    { name: "cosmos",    petalCount: [8, 9],   openAngle: 0.22, ringRadius: 0.40, centerR: 0.12, petalLen: 0.44, petalW: 0.20, hang: false, rings: 1, disk: true, palette: COSMOS_COLORS, centerHex: "#f1c40f" },
    { name: "anémona",   petalCount: [6, 8],   openAngle: 0.28, ringRadius: 0.30, centerR: 0.13, petalLen: 0.40, petalW: 0.24, hang: false, rings: 1, disk: true, palette: ANEMONE_COLORS, centerHex: "#3a4a63" },
    { name: "hibisco",   petalCount: [5, 5],   openAngle: 0.55, ringRadius: 0.20, centerR: 0.05, petalLen: 0.52, petalW: 0.36, hang: false, rings: 1, stamens: true, palette: HIBISCUS_COLORS, centerHex: "#ffd54f" },
    { name: "iris",      petalCount: [3, 3],   openAngle: 0.25, ringRadius: 0.14, centerR: 0.05, petalLen: 0.44, petalW: 0.24, hang: false, rings: 2, droop: true, palette: IRIS_COLORS, centerHex: "#f1c40f" },
    { name: "lavanda",         kind: "spike",   palette: LAVENDER_COLORS, centerHex: "#6d5aa8" },
    { name: "diente de león",  kind: "puff",    palette: DANDELION_COLORS, centerHex: "#e8e4c9" },
    { name: "lirio de los valles", kind: "raceme",  palette: LOTV_COLORS, centerHex: "#eef0c2" },
    { name: "buganvilla",          kind: "cluster", palette: BOUGAIN_COLORS, centerHex: "#fff6c8" }
  ];

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* petal/leaf: cono aplastado, base en el origen local (x=0),
     punta en x=len — así se puede "abrir" rotando alrededor de
     la base antes de desplazarlo al radio del anillo. thin bajo
     (~0.05) da una bráctea papirácea plana (buganvilla). */
  function bladeGeometry(w, len, thin, segs) {
    const geo = new THREE.ConeGeometry(w / 2, len, segs || 6, 1);
    geo.rotateZ(-Math.PI / 2);
    geo.translate(len / 2, 0, 0);
    geo.scale(1, thin, 1);
    return geo;
  }

  /* tallo compartido por las tres formas de flor */
  function addStem(root, stemMat, stemH) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.045, stemH, 6), stemMat);
    stem.position.y = stemH / 2;
    root.add(stem);
  }

  /* hojas compartidas: opts permite hojas basales anchas (lirio de
     los valles) o una franja de hojas más alta (buganvilla) */
  function addLeaves(root, rnd, stemMat, stemH, opts) {
    opts = opts || {};
    const count  = opts.count != null ? opts.count : 1 + Math.floor(rnd() * 3);
    const lenBase = opts.len != null ? opts.len : 0.18;
    const lenVar  = opts.lenVar != null ? opts.lenVar : 0.16;
    const wide    = opts.w != null ? opts.w : 0.15;
    const yMin = opts.yMin != null ? opts.yMin : 0.18;
    const yMax = opts.yMax != null ? opts.yMax : 0.73;
    for (let i = 0; i < count; i++) {
      const leafY = stemH * (yMin + rnd() * (yMax - yMin));
      const side = rnd() < 0.5 ? -1 : 1;
      const leafAngle = (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.6;
      const leafLen = lenBase + rnd() * lenVar;

      const leafMesh = new THREE.Mesh(bladeGeometry(wide, leafLen, 0.14, 5), stemMat);
      const lift = new THREE.Group();
      lift.rotation.z = 0.35 + rnd() * 0.35;
      lift.add(leafMesh);
      const mount = new THREE.Group();
      mount.position.set(0.03, leafY, 0);
      mount.rotation.y = leafAngle;
      mount.add(lift);
      root.add(mount);
    }
  }

  /* cabeza de pétalos apilados en 1-3 anillos (margarita … lirio) */
  function addHead(root, rnd, style, matFor, centerMat, stemH) {
    const head = new THREE.Group();
    head.position.y = stemH;
    if (style.hang) head.rotation.x = Math.PI * 0.92;   // cuelga boca abajo (campana)

    head.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.02, style.centerR), 8, 6), centerMat));
    if (style.disk) addFloretDisk(head, rnd, style, centerMat);

    const rings = style.rings || 1;
    const twist = style.ruffle ? 0.5 : 0;
    for (let ring = 0; ring < rings; ring++) {
      const t      = rings > 1 ? ring / (rings - 1) : 0;   // 0 anillo interno … 1 externo
      const count  = Math.round(style.petalCount[0] + rnd() * (style.petalCount[1] - style.petalCount[0]));
      // droop (iris): el anillo externo cae por debajo de la horizontal
      const openA  = style.openAngle * (style.droop ? 1 + t * 1.5 : 1 - t * 0.45);
      const rad    = style.ringRadius * (1 + t * 0.9);
      const len0   = style.petalLen * (1 + t * 0.35);
      const angOff = (ring % 2) ? Math.PI / count : 0;      // alterna el calce entre anillos

      for (let i = 0; i < count; i++) {
        const len = len0 * (0.85 + rnd() * 0.3);
        const w   = style.petalW * (0.85 + rnd() * 0.3);
        const mesh = new THREE.Mesh(bladeGeometry(w, len, 0.22, 6), matFor(ring, i, rings));
        if (twist) mesh.rotation.x = (rnd() - 0.5) * twist;   // pétalo ondulado (clavel)

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

    if (style.lip) {
      // labelo: el pétalo inferior agrandado que distingue a la orquídea
      const len = style.petalLen * 1.6, w = style.petalW * 1.8;
      const mesh = new THREE.Mesh(bladeGeometry(w, len, 0.28, 6), matFor(0, 1, 1));
      const mount = new THREE.Group();
      mount.position.x = style.ringRadius * 0.6;
      mount.rotation.z = style.openAngle * 1.3;
      mount.add(mesh);
      const pivot = new THREE.Group();
      pivot.rotation.y = -Math.PI / 2;   // hacia adelante/abajo
      pivot.add(mount);
      head.add(pivot);
    }

    if (style.stamens) {
      // estambres radiales con antera (lirio)
      const count = 6, len = style.petalLen * 0.55;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * TAU + rnd() * 0.2;
        const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 4), centerMat);
        filament.rotation.z = Math.PI / 2;
        filament.position.x = len / 2;
        const anther = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), centerMat);
        anther.position.x = len;
        const mount = new THREE.Group();
        mount.rotation.z = style.openAngle * 0.6;
        mount.add(filament, anther);
        const pivot = new THREE.Group();
        pivot.rotation.y = theta;
        pivot.position.y = 0.02;
        pivot.add(mount);
        head.add(pivot);
      }
    }

    root.add(head);
  }

  /* flor "single": tallo + hojas + una cabeza (todas las STYLES sin kind) */
  function buildSingle(rnd, style, matFor, centerMat, stemMat) {
    const root = new THREE.Group();
    const stemH = 0.45 + rnd() * 1.1;
    addStem(root, stemMat, stemH);
    addLeaves(root, rnd, stemMat, stemH);
    addHead(root, rnd, style, matFor, centerMat, stemH);
    return { root, stemH, swaySpeed: 0.5 + rnd() * 0.6, swayAmp: 0.10 + rnd() * 0.10 };
  }

  /* lirio de los valles: campanitas diminutas alternadas colgando a
     lo largo del tercio superior de un tallo bajo, con hojas basales
     anchas envolviendo la base — no encaja en "una cabeza en la punta" */
  function buildRaceme(rnd, style, matFor, centerMat, stemMat) {
    const root = new THREE.Group();
    const stemH = 0.5 + rnd() * 0.35;
    addStem(root, stemMat, stemH);
    addLeaves(root, rnd, stemMat, stemH, { count: 2, yMin: 0.02, yMax: 0.08, len: 0.30, lenVar: 0.10, w: 0.30 });

    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      const y = stemH * (0.55 + f * 0.42);
      const side = i % 2 === 0 ? 1 : -1;

      const bell = new THREE.Group();
      bell.add(new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 5), centerMat));
      const petals = 5;
      for (let p = 0; p < petals; p++) {
        const mesh = new THREE.Mesh(bladeGeometry(0.05, 0.07, 0.3, 5), matFor(0, i, 1));
        const mount = new THREE.Group();
        mount.position.x = 0.02;
        mount.rotation.z = 0.9;
        mount.add(mesh);
        const pivot = new THREE.Group();
        pivot.rotation.y = (p / petals) * TAU;
        pivot.add(mount);
        bell.add(pivot);
      }
      bell.rotation.x = Math.PI * 0.85;   // cuelga, boca hacia abajo

      const mount = new THREE.Group();
      mount.position.set(0.02 * side, y, 0.03 + f * 0.03);
      mount.rotation.z = side * (0.25 + f * 0.1);
      mount.add(bell);
      root.add(mount);
    }

    return { root, stemH, swaySpeed: 0.5 + rnd() * 0.6, swayAmp: 0.10 + rnd() * 0.10 };
  }

  /* buganvilla: brácteas planas y papiráceas en tríos alrededor de una
     florecita diminuta, varios tríos agrupados cerca de la copa —
     el color vívido está en la "bráctea", no en un pétalo clásico */
  function buildCluster(rnd, style, matFor, centerMat, stemMat) {
    const root = new THREE.Group();
    const stemH = 0.5 + rnd() * 0.7;
    addStem(root, stemMat, stemH);
    addLeaves(root, rnd, stemMat, stemH, { count: 2 + Math.floor(rnd() * 2), yMin: 0.15, yMax: 0.7, len: 0.16, lenVar: 0.10, w: 0.13 });

    const trios = 3 + Math.floor(rnd() * 3);
    for (let t = 0; t < trios; t++) {
      const cluster = new THREE.Group();
      for (let b = 0; b < 3; b++) {
        const mesh = new THREE.Mesh(bladeGeometry(0.22, 0.20, 0.06, 4), matFor(0, t, 1));
        const mount = new THREE.Group();
        mount.position.x = 0.02;
        mount.rotation.z = 0.55 + rnd() * 0.2;
        mount.add(mesh);
        const pivot = new THREE.Group();
        pivot.rotation.y = (b / 3) * TAU + rnd() * 0.3;
        pivot.rotation.x = -0.3 + rnd() * 0.2;
        pivot.add(mount);
        cluster.add(pivot);
      }
      cluster.add(new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 5), centerMat));

      const mount = new THREE.Group();
      mount.position.set((rnd() - 0.5) * 0.10, stemH * (0.78 + rnd() * 0.22), (rnd() - 0.5) * 0.10);
      mount.rotation.y = rnd() * TAU;
      mount.add(cluster);
      root.add(mount);
    }

    return { root, stemH, swaySpeed: 0.5 + rnd() * 0.6, swayAmp: 0.08 + rnd() * 0.08 };
  }

  /* lavanda: espiga de botones diminutos en espiral filotáctica sobre
     un eje fino que prolonga el tallo — no hay "cabeza" ni pétalos */
  function buildSpike(rnd, style, matFor, centerMat, stemMat) {
    const root = new THREE.Group();
    const stemH = 0.65 + rnd() * 0.5;
    addStem(root, stemMat, stemH);
    addLeaves(root, rnd, stemMat, stemH, { count: 3, yMin: 0.12, yMax: 0.5, len: 0.13, lenVar: 0.07, w: 0.05 });

    const spikeLen = 0.3 + rnd() * 0.18;
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, spikeLen, 5), stemMat);
    axis.position.y = stemH + spikeLen / 2;
    root.add(axis);

    const n = 12 + Math.floor(rnd() * 9);
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      const a = i * 2.4 + rnd() * 0.5;               // ángulo áureo aprox
      const rad = 0.045 * (1 - f * 0.55);
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.026 * (1 - f * 0.35), 5, 4), matFor(0, i, 1));
      bud.scale.y = 1.5;
      bud.position.set(Math.cos(a) * rad, stemH + f * spikeLen, Math.sin(a) * rad);
      root.add(bud);
    }

    return { root, stemH: stemH + spikeLen, swaySpeed: 0.7 + rnd() * 0.6, swayAmp: 0.14 + rnd() * 0.10 };
  }

  /* diente de león: esfera de vilanos — filamentos radiales finísimos
     con una puntita en el extremo, alrededor de un receptáculo */
  function buildPuff(rnd, style, matFor, centerMat, stemMat) {
    const root = new THREE.Group();
    const stemH = 0.5 + rnd() * 0.55;
    addStem(root, stemMat, stemH);
    addLeaves(root, rnd, stemMat, stemH, { count: 2, yMin: 0.03, yMax: 0.1, len: 0.22, lenVar: 0.08, w: 0.09 });

    const head = new THREE.Group();
    head.position.y = stemH;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), centerMat));

    const R = 0.16 + rnd() * 0.07;
    const n = 34 + Math.floor(rnd() * 22);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(Math.max(0, 1 - z * z));
      const dir = new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a));
      const g = new THREE.Group();
      const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, R, 3), matFor(0, i, 1));
      fil.position.y = R / 2;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), matFor(0, i + 1, 1));
      tip.position.y = R;
      g.add(fil, tip);
      g.quaternion.setFromUnitVectors(up, dir);
      head.add(g);
    }

    root.add(head);
    return { root, stemH: stemH + R, swaySpeed: 0.6 + rnd() * 0.6, swayAmp: 0.12 + rnd() * 0.10 };
  }

  /* ── modelo 3D determinista de la flor (sin tierra: el suelo es
        una losa compartida de toda la pradera) ── */
  function buildFlower(seed) {
    const rnd = mulberry32(hashStr(seed));
    const style = STYLES[Math.floor(rnd() * STYLES.length)];
    const palette = style.palette || BLOOMS;
    const bloomHex = brighten(palette[Math.floor(rnd() * palette.length)]);
    const stemHex  = STEMCOLS[Math.floor(rnd() * STEMCOLS.length)];
    const centerHex = brighten(style.centerHex || bloomHex);

    const bloomMat  = new THREE.MeshStandardMaterial({ color: bloomHex, flatShading: true, roughness: 0.7 });
    const centerMat = new THREE.MeshStandardMaterial({ color: centerHex, flatShading: true, roughness: 0.5, emissive: new THREE.Color(centerHex), emissiveIntensity: 0.12 });
    const stemMat   = new THREE.MeshStandardMaterial({ color: stemHex, flatShading: true, roughness: 0.8 });
    const dispose = [bloomMat, centerMat, stemMat];

    /* ~40% de las flores son bicolores: o alternan pétalo a pétalo o
       reservan el segundo color para el anillo externo */
    let matFor = function () { return bloomMat; };
    if (palette.length > 1 && rnd() < 0.4) {
      let idx2 = Math.floor(rnd() * palette.length);
      if (palette[idx2] === bloomHex) idx2 = (idx2 + 1) % palette.length;
      const bloomMat2 = new THREE.MeshStandardMaterial({ color: brighten(palette[idx2]), flatShading: true, roughness: 0.7 });
      dispose.push(bloomMat2);
      const outerMode = rnd() < 0.5;
      matFor = function (ring, i, rings) {
        if (outerMode && rings > 1) return ring === rings - 1 ? bloomMat2 : bloomMat;
        return i % 2 ? bloomMat2 : bloomMat;
      };
    }

    const built = style.kind === "raceme"  ? buildRaceme(rnd, style, matFor, centerMat, stemMat)
                : style.kind === "cluster" ? buildCluster(rnd, style, matFor, centerMat, stemMat)
                : style.kind === "spike"   ? buildSpike(rnd, style, matFor, centerMat, stemMat)
                : style.kind === "puff"    ? buildPuff(rnd, style, matFor, centerMat, stemMat)
                :                            buildSingle(rnd, style, matFor, centerMat, stemMat);

    const baseAngle = rnd() * TAU;
    built.root.rotation.y = baseAngle;
    built.root.scale.setScalar(0.78 + rnd() * 0.55);   // porte: de flor menuda a ejemplar alto
    built.root.rotation.z = (rnd() - 0.5) * 0.12;      // leve inclinación natural

    return {
      root: built.root, baseAngle, swaySpeed: built.swaySpeed, swayAmp: built.swayAmp, stemH: built.stemH,
      name: style.name,
      dispose: dispose
    };
  }

  /* losa de césped de la pradera: una plancha de tierra con la
     cara superior de hierba, dimensionada para cubrir el campo */
  function buildGround(hx, hz) {
    const g = new THREE.Group();
    const THK = 0.3;
    // tonos suaves y apagados: un verde salvia y una tierra tostada
    // tenue → el dithering queda como grano fino, no como damero duro
    const soilMat  = new THREE.MeshStandardMaterial({ color: "#7a6448", flatShading: true, roughness: 1.0 });
    const grassMat = new THREE.MeshStandardMaterial({ color: "#8fa77a", flatShading: true, roughness: 0.95 });

    const slabGeo = new THREE.BoxGeometry(hx * 2, THK, hz * 2);
    const slab = new THREE.Mesh(slabGeo, soilMat);
    slab.position.y = -THK / 2;
    g.add(slab);

    const grassGeo = new THREE.PlaneGeometry(hx * 2, hz * 2);
    grassGeo.rotateX(-Math.PI / 2);
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = 0.002;
    g.add(grass);

    return { group: g, dispose: [soilMat, grassMat] };
  }

  /* ════════════════════════════════════════════════════════════
     RENDER 3D → DITHER (renderer WebGL compartido, oculto)
     ════════════════════════════════════════════════════════════ */
  const PIX = 3;                  // px de pantalla por celda de dithering (grano)
  let renderer = null, rt = null, quadScene = null, quadCam = null, quadMat = null;

  const DITHER_FRAG = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform float uLevels;",
    // ruido de gradiente interleaved (idéntico al de ascii.js) → umbral de dither ordenado
    "float ign(vec2 p){ return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }",
    "vec3 quant(vec3 c, float t, float lv){",
    "  vec3 v = c * (lv - 1.0);",
    "  return (floor(v) + step(t, fract(v))) / (lv - 1.0);",
    "}",
    "void main(){",
    "  vec4 src = texture2D(tDiffuse, vUv);",
    "  float t = ign(gl_FragCoord.xy);",
    // silueta tramada: recorta el borde con el mismo umbral (dithering 1-bit del alfa)
    "  if (src.a < max(0.04, t)) discard;",
    "  gl_FragColor = vec4(quant(src.rgb, t, uLevels), 1.0);",
    "}"
  ].join("\n");

  const DITHER_VERT = [
    "varying vec2 vUv;",
    "void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }"
  ].join("\n");

  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(1);
    renderer.autoClear = true;

    rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat
    });

    quadMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uLevels: { value: 6.0 } },
      vertexShader: DITHER_VERT,
      fragmentShader: DITHER_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
    quadCam = new THREE.Camera();
  }

  /* ── cámara 3D en perspectiva con órbita libre ──
     Ya no es isométrica fija: una PerspectiveCamera orbita un punto
     objetivo sobre el jardín. Arrastrar gira (azimut/elevación), la
     rueda o +/− acercan (dolly) y WASD/flechas desplazan el objetivo
     por el campo → te movés dentro del jardín. */
  const PHI_MIN = 0.14, PHI_MAX = 1.46;      // elevación: ni cenital ni bajo tierra
  const RAD_MIN = 1.4, RAD_MAX = 60;

  function ensureCamera() {
    if (!garden.cam) garden.cam = new THREE.PerspectiveCamera(46, garden.rw / Math.max(1, garden.rh), 0.05, 300);
  }
  function clampOrbit() {
    const o = garden.orbit;
    o.phi = Math.min(PHI_MAX, Math.max(PHI_MIN, o.phi));
    o.radius = Math.min(RAD_MAX, Math.max(RAD_MIN, o.radius));
    if (garden.bounds) {
      const hx = garden.bounds.hx + 2.5, hz = garden.bounds.hz + 2.5;
      o.target.x = Math.min(hx, Math.max(-hx, o.target.x));
      o.target.z = Math.min(hz, Math.max(-hz, o.target.z));
    }
  }
  function updateCamera() {
    ensureCamera();
    const o = garden.orbit, c = garden.cam;
    const sinP = Math.sin(o.phi), cosP = Math.cos(o.phi);
    c.position.set(
      o.target.x + o.radius * sinP * Math.sin(o.theta),
      o.target.y + o.radius * cosP,
      o.target.z + o.radius * sinP * Math.cos(o.theta)
    );
    c.up.set(0, 1, 0);
    c.lookAt(o.target);
    c.aspect = garden.rw / Math.max(1, garden.rh);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }
  /* vector "adelante" y "derecha" horizontales, según hacia dónde mira */
  function forwardXZ(out) {
    const o = garden.orbit;
    out.set(-Math.sin(o.theta), 0, -Math.cos(o.theta));
    return out.normalize();
  }

  /* ── persistencia ── */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }

  /* ════════════════════════════════════════════════════════════
     LA PRADERA — una sola escena, una sola cámara, un solo canvas
     ════════════════════════════════════════════════════════════ */
  const SX = 1.55, SZ = 1.4;                 // separación de la cuadrícula (mundo)
  const MINHX = 3.6, MINHZ = 1.5, MARGIN = 1.1;

  const ZKEY = "pandora_garden_view";
  function loadView() {
    try { return JSON.parse(localStorage.getItem(ZKEY)) || {}; } catch (e) { return {}; }
  }
  const _v = loadView();

  const garden = {
    scene: null, cam: null, orbit: null, ground: null,
    flowers: [], seedsKey: "_",
    canvas: null, ctx: null, labelWrap: null, plot: null,
    rw: 0, rh: 0, dw: 0, dh: 0, visible: false,
    bounds: null, camDirty: true,
    keys: Object.create(null),
    showLabels: _v.labels !== false
  };
  function saveView() {
    const o = garden.orbit;
    const data = { labels: garden.showLabels };
    if (o) { data.theta = o.theta; data.phi = o.phi; data.radius = o.radius; data.tx = o.target.x; data.tz = o.target.z; }
    try { localStorage.setItem(ZKEY, JSON.stringify(data)); } catch (e) {}
  }
  const raycaster = new THREE.Raycaster();
  const tmpV = new THREE.Vector3();
  const tmpF = new THREE.Vector3();

  function disposeScene() {
    if (!garden.scene) return;
    garden.scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    garden.flowers.forEach(function (f) { f.dispose.forEach(function (m) { m.dispose(); }); });
    if (garden.ground) garden.ground.dispose.forEach(function (m) { m.dispose(); });
    garden.scene = null; garden.ground = null; garden.flowers = [];
  }

  function buildScene(seeds) {
    disposeScene();
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeaf0ff, 0x5a3f22, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.position.set(2.4, 3.6, 2.0);
    scene.add(sun);

    const n = seeds.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2.4)));   // pradera ancha: más columnas que filas
    const rows = Math.ceil(n / cols);

    const flowers = [];
    seeds.forEach(function (seed, i) {
      const f = buildFlower(seed);
      const jr = mulberry32(hashStr(seed + "@pos"));
      const col = i % cols, row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * SX + (jr() - 0.5) * 0.5;
      const z = (row - (rows - 1) / 2) * SZ + (jr() - 0.5) * 0.4;
      f.root.position.set(x, 0, z);
      f.root.userData.flowerIndex = i;
      f.seed = seed;
      f.base = new THREE.Vector3(x, 0, z);
      f.timeOffset = (hashStr(seed) % 1000) / 1000 * TAU;
      scene.add(f.root);
      flowers.push(f);
    });

    const hx = Math.max(MINHX, (cols - 1) / 2 * SX + MARGIN);
    const hz = Math.max(MINHZ, (rows - 1) / 2 * SZ + MARGIN);
    const ground = buildGround(hx, hz);
    scene.add(ground.group);

    garden.scene = scene;
    garden.ground = ground;
    garden.flowers = flowers;
    garden.flowerRoots = flowers.map(function (f) { return f.root; });
  }

  /* ajusta la cámara: fija los límites del campo, inicializa la
     órbita la primera vez (o tras vaciar) y refresca la proyección */
  function reframe() {
    garden.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(garden.scene);
    const size = box.getSize(tmpV).length();
    const center = box.getCenter(new THREE.Vector3());
    garden.bounds = {
      hx: (box.max.x - box.min.x) / 2,
      hz: (box.max.z - box.min.z) / 2
    };
    ensureCamera();
    if (!garden.orbit) {
      garden.orbit = {
        target: new THREE.Vector3(center.x, 0.5, center.z),
        theta: -Math.PI * 0.25,        // arranca en un ángulo tipo 3/4
        phi: 0.92,
        radius: size * 1.05 + 2
      };
      // restaura la vista guardada, si la hay
      if (typeof _v.theta === "number") {
        garden.orbit.theta = _v.theta;
        garden.orbit.phi = _v.phi;
        garden.orbit.radius = _v.radius;
        garden.orbit.target.x = _v.tx;
        garden.orbit.target.z = _v.tz;
      }
    }
    clampOrbit();
    updateCamera();
    garden.camDirty = true;
  }

  /* acerca / aleja (dolly): factor <1 acerca, >1 aleja */
  function dolly(factor) {
    if (!garden.orbit) return;
    garden.orbit.radius = Math.min(RAD_MAX, Math.max(RAD_MIN, garden.orbit.radius * factor));
    clampOrbit();
    saveView();
    garden.camDirty = true;
  }

  function applyLabelVisibility() {
    if (garden.labelWrap) garden.labelWrap.classList.toggle("labels-hidden", !garden.showLabels);
  }

  function paint() {
    if (!garden.scene || !renderer || !garden.cam) return;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.render(garden.scene, garden.cam);
    renderer.setRenderTarget(null);
    quadMat.uniforms.tDiffuse.value = rt.texture;
    renderer.render(quadScene, quadCam);
    garden.ctx.clearRect(0, 0, garden.rw, garden.rh);
    garden.ctx.drawImage(renderer.domElement, 0, 0);
  }

  /* proyecta la base de cada flor a coordenadas de pantalla y coloca
     su etiqueta de semilla flotante justo debajo */
  function layoutLabels() {
    const wrap = garden.labelWrap;
    // reutiliza los spans existentes; crea los que falten
    while (wrap.childElementCount - 1 < garden.flowers.length) {  // -1: el canvas es hijo 0
      const s = document.createElement("span");
      s.className = "garden-label";
      wrap.appendChild(s);
    }
    while (wrap.childElementCount - 1 > garden.flowers.length) {
      wrap.removeChild(wrap.lastElementChild);
    }
    const spans = wrap.querySelectorAll(".garden-label");
    const cam = garden.cam;
    garden.flowers.forEach(function (f, i) {
      const el = spans[i];
      // proyecta el pie de la flor a pantalla; oculta si queda detrás
      // de la cámara o fuera del lienzo
      tmpV.copy(f.base); tmpV.y = 0.05;
      tmpV.project(cam);
      const sx = (tmpV.x * 0.5 + 0.5) * garden.dw;
      const sy = (1 - (tmpV.y * 0.5 + 0.5)) * garden.dh;
      const off = tmpV.z > 1 || sx < -40 || sx > garden.dw + 40 || sy < -30 || sy > garden.dh + 30;
      el.style.display = off ? "none" : "";
      if (off) return;
      el.textContent = f.seed;
      el.style.left = sx + "px";
      el.style.top = sy + "px";
    });
  }

  /* dimensiona renderer/rt/canvas a la anchura actual del contenedor */
  function resizeToPlot() {
    const W = garden.plot.clientWidth;
    if (W < 2) return false;
    const dw = W;
    const dh = Math.max(240, Math.min(460, Math.round(W * 0.5)));
    const rw = Math.max(160, Math.min(460, Math.round(W / PIX)));
    const rh = Math.max(1, Math.round(rw * dh / dw));
    garden.dw = dw; garden.dh = dh; garden.rw = rw; garden.rh = rh;

    renderer.setSize(rw, rh, false);
    rt.setSize(rw, rh);
    const cv = garden.canvas;
    cv.width = rw; cv.height = rh;
    cv.style.width = dw + "px";
    cv.style.height = dh + "px";
    garden.labelWrap.style.width = dw + "px";
    garden.labelWrap.style.height = dh + "px";
    return true;
  }

  /* raycast al puntero → índice de flor bajo el cursor (o -1) */
  function pickFlower(clientX, clientY) {
    const rect = garden.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, garden.cam);
    const hits = raycaster.intersectObjects(garden.flowerRoots, true);
    if (!hits.length) return -1;
    let o = hits[0].object;
    while (o && o.userData.flowerIndex === undefined) o = o.parent;
    return o ? o.userData.flowerIndex : -1;
  }

  /* ── (re)construye o redimensiona según haga falta ── */
  function layout() {
    if (!garden.plot) return;
    ensureRenderer();
    const seeds = load();
    const key = JSON.stringify(seeds);

    if (!seeds.length) {
      disposeScene();
      garden.seedsKey = key;
      garden.plot.innerHTML = '<p class="empty-msg">la pradera está vacía — planta la primera semilla.</p>';
      garden.canvas = null; garden.labelWrap = null;
      return;
    }

    // asegura los nodos DOM (canvas + capa de etiquetas)
    if (!garden.canvas || !garden.plot.contains(garden.canvas)) {
      garden.plot.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "garden-scene";
      const cv = document.createElement("canvas");
      cv.className = "garden-canvas";
      wrap.appendChild(cv);
      garden.plot.appendChild(wrap);
      garden.labelWrap = wrap;
      garden.canvas = cv;
      garden.ctx = cv.getContext("2d");

      // ── órbita libre: arrastrar gira la cámara; un toque (sin
      //    apenas arrastre) arranca la flor bajo el cursor ──
      let dragging = false, lx = 0, ly = 0, dragDist = 0;
      cv.addEventListener("pointerdown", function (e) {
        dragging = true; dragDist = 0; lx = e.clientX; ly = e.clientY;
        if (cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      });
      cv.addEventListener("pointermove", function (e) {
        if (dragging) {
          const dx = e.clientX - lx, dy = e.clientY - ly;
          lx = e.clientX; ly = e.clientY;
          dragDist += Math.abs(dx) + Math.abs(dy);
          const o = garden.orbit;
          if (o) {
            o.theta -= dx * 0.008;
            o.phi   -= dy * 0.008;
            clampOrbit();
            garden.camDirty = true;
          }
          return;
        }
        const idx = pickFlower(e.clientX, e.clientY);
        cv.style.cursor = idx >= 0 ? "var(--cur-hand, pointer)" : "grab";
        cv.title = idx >= 0 ? "«" + garden.flowers[idx].seed + "» · " + garden.flowers[idx].name + " — clic para arrancar" : "";
      });
      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        if (cv.releasePointerCapture) try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
        saveView();
        if (dragDist < 6) {                       // fue un toque, no un giro → arrancar
          const idx = pickFlower(e.clientX, e.clientY);
          if (idx >= 0) {
            const all = load();
            all.splice(idx, 1);
            save(all);
            layout();
          }
        }
      }
      cv.addEventListener("pointerup", endDrag);
      cv.addEventListener("pointercancel", endDrag);
      // rueda del ratón sobre el jardín → acercar / alejar (dolly)
      cv.addEventListener("wheel", function (e) {
        e.preventDefault();
        dolly(e.deltaY < 0 ? 1 / 1.12 : 1.12);
      }, { passive: false });
    }
    applyLabelVisibility();

    if (!resizeToPlot()) return;               // contenedor aún sin ancho (sección oculta)

    if (key !== garden.seedsKey || !garden.scene) {
      buildScene(seeds);
      garden.seedsKey = key;
    }
    reframe();
    paint();
    layoutLabels();
  }

  /* mueve el objetivo de la cámara con WASD / flechas → recorrés el
     jardín (avanzar/retroceder según hacia dónde mirás, y desplazar) */
  function applyKeys(dt) {
    const k = garden.keys, o = garden.orbit;
    if (!o) return false;
    const fwd = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
    const str = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
    if (!fwd && !str) return false;
    const speed = Math.max(1.2, o.radius * 0.9) * dt;
    forwardXZ(tmpF);
    o.target.x += tmpF.x * fwd * speed + tmpF.z * str * speed;   // derecha = fwd girado -90°
    o.target.z += tmpF.z * fwd * speed - tmpF.x * str * speed;
    clampOrbit();
    return true;
  }

  /* bucle: mueve la cámara (teclas), balancea las flores (~9 fps) y
     re-renderiza sólo si algo cambió y la sección está en pantalla */
  const TICK_INTERVAL = 110;
  let lastTick = 0, lastNow = 0, keySaveT = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (!garden.scene || !garden.visible) { lastNow = now; return; }
    const dt = Math.min(0.05, (now - lastNow) / 1000) || 0;
    lastNow = now;

    let changed = garden.camDirty;
    garden.camDirty = false;

    if (applyKeys(dt)) {
      changed = true;
      if (now - keySaveT > 400) { keySaveT = now; saveView(); }   // persiste sin spamear
    }

    if (!REDUCED_MOTION && now - lastTick >= TICK_INTERVAL) {
      lastTick = now;
      const t = now * 0.001;
      for (let i = 0; i < garden.flowers.length; i++) {
        const f = garden.flowers[i];
        f.root.rotation.y = f.baseAngle + Math.sin((t + f.timeOffset) * f.swaySpeed) * f.swayAmp;
      }
      changed = true;
    }

    if (changed) {
      updateCamera();
      paint();
      layoutLabels();
    }
  }

  function boot() {
    const form = document.getElementById("seed-form");
    const plot = document.getElementById("garden-plot");
    if (!form || !plot) return;
    garden.plot = plot;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const seed = ((new FormData(form).get("seed")) || "").trim();
      if (!seed) return;
      const all = load();
      all.push(seed);
      save(all);
      form.reset();
      layout();
    });

    const clr = document.getElementById("garden-clear");
    if (clr) clr.addEventListener("click", function () {
      if (!load().length) return;
      if (!confirm("¿Vaciar la pradera?")) return;
      save([]);
      layout();
    });

    // ── controles de vista: zoom (dolly) + toggle de nombres ──
    const zin  = document.getElementById("garden-zoom-in");
    const zout = document.getElementById("garden-zoom-out");
    if (zin)  zin.addEventListener("click", function () { dolly(1 / 1.25); });
    if (zout) zout.addEventListener("click", function () { dolly(1.25); });

    // ── teclado: WASD / flechas mueven por el jardín ──
    const NAVK = { w: 1, a: 1, s: 1, d: 1, arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1 };
    function typing() {
      const el = document.activeElement;
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    }
    addEventListener("keydown", function (e) {
      if (!garden.visible || typing()) return;
      const k = e.key.toLowerCase();
      if (!NAVK[k]) return;
      e.preventDefault();
      garden.keys[k] = true;
    });
    addEventListener("keyup", function (e) {
      const k = e.key.toLowerCase();
      if (NAVK[k]) garden.keys[k] = false;
    });
    // al ocultarse la sección, suelta todas las teclas
    const clearKeys = function () { garden.keys = Object.create(null); };
    addEventListener("blur", clearKeys);

    const namesBtn = document.getElementById("garden-names");
    function syncNamesBtn() {
      if (!namesBtn) return;
      namesBtn.classList.toggle("on", garden.showLabels);
      namesBtn.setAttribute("aria-pressed", String(garden.showLabels));
      namesBtn.textContent = (garden.showLabels ? "◉" : "◌") + " nombres";
    }
    if (namesBtn) namesBtn.addEventListener("click", function () {
      garden.showLabels = !garden.showLabels;
      saveView();
      applyLabelVisibility();
      syncNamesBtn();
    });
    syncNamesBtn();

    // la sección arranca oculta (display:none → ancho 0); el
    // ResizeObserver dispara el primer layout cuando se muestra y
    // en cada cambio de tamaño de la ventana.
    let roTimer = 0;
    const ro = new ResizeObserver(function () {
      clearTimeout(roTimer);
      roTimer = setTimeout(layout, 60);
    });
    ro.observe(plot);

    // visibilidad para animar sólo cuando está en pantalla
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        garden.visible = en.isIntersecting;
        if (!en.isIntersecting) garden.keys = Object.create(null);
      });
    }, { threshold: 0.02 });
    io.observe(plot);

    layout();
    requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
