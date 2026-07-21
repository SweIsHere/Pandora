/* ============================================================
   PANDORA — sketch.js  ·  three.js engine
   ------------------------------------------------------------
   · UN solo contexto WebGL compartido para TODOS los atractores
     (hero, galería, lightbox) → se dibuja cada escena en un
     sub-viewport y se hace blit a un <canvas> 2D de cada vista.
     Esto rinde N tarjetas con un único contexto GPU.
   · Cada atractor es una nube de PARTÍCULAS (THREE.Points): cada
     vértice de la trayectoria es un punto con un shader de "flujo
     cometa" (estructura tenue + cabezales brillantes) y un
     dithering ordenado que le da grano semitono.
   · Estética "etérea", dos variantes intercambiables en vivo
     (ver AESTHETIC / setAestheticMode):
       - "nebulosa": fondo casi negro, el blit se repite borroso
         y se compone en aditivo ("lighter") sobre el trazo nítido
         → halo luminoso, como mirar una nebulosa por un ojo de buey.
       - "bruma":    fondo claro (como antes), el mismo halo borroso
         se compone en normal a baja opacidad → niebla pastel suave
         alrededor del trazo nítido.
     El post-proceso vive en applyGlow(); reemplaza el dithering
     Bayer que tenía esta escena anteriormente.
   ============================================================ */

const THREE = window.THREE;

const DEFAULTS = [
  {
    name: "Aizawa", color: "#243ec4", dt: 0.012,
    params: "a=0.95, b=0.7, c=0.6, d=3.5, e=0.25, f=0.1",
    dx: "(z-b)*x-d*y", dy: "d*x+(z-b)*y",
    dz: "c+a*z-pow(z,3)/3-(x*x+y*y)*(1+e*z)+f*z*pow(x,3)",
    init: [0.1, 0, 0]
  },
  {
    name: "Thomas", color: "#243ec4", dt: 0.05,
    params: "b=0.208",
    dx: "sin(y)-b*x", dy: "sin(z)-b*y", dz: "sin(x)-b*z",
    init: [1.1, 1.1, -0.1]
  },
  {
    name: "Rössler", color: "#243ec4", dt: 0.04,
    params: "a=0.2, b=0.2, c=5.7",
    dx: "-y-z", dy: "x+a*y", dz: "b+z*(x-c)",
    init: [0.1, 0, 0]
  }
];

const DEFAULT_COLOR = "#243ec4";

/* ── utils numéricos ── */
function hexToRgb(h) {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function parseParams(str) {
  const names = [], vals = [];
  (str || "").split(/[,;\n]+/).forEach(p => {
    const m = p.split("=");
    if (m.length === 2) {
      const k = m[0].trim(), v = parseFloat(m[1]);
      if (k && isFinite(v)) { names.push(k); vals.push(v); }
    }
  });
  return { names, vals };
}

function buildDeriv(def) {
  const { names, vals } = parseParams(def.params);
  const fn = new Function(
    "x", "y", "z", ...names,
    "with(Math){return [(" + def.dx + "),(" + def.dy + "),(" + def.dz + ")];}"
  );
  return (x, y, z) => fn(x, y, z, ...vals);
}

function lorenzDeriv(x, y, z) {
  const s = 10, r = 28, b = 8 / 3;
  return [s * (y - x), x * (r - z) - y, x * y - b * z];
}

function rk4(deriv, px, py, pz, dt) {
  const k1 = deriv(px, py, pz);
  const k2 = deriv(px + dt/2*k1[0], py + dt/2*k1[1], pz + dt/2*k1[2]);
  const k3 = deriv(px + dt/2*k2[0], py + dt/2*k2[1], pz + dt/2*k2[2]);
  const k4 = deriv(px + dt*k3[0],   py + dt*k3[1],   pz + dt*k3[2]);
  return [
    px + dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),
    py + dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]),
    pz + dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2])
  ];
}

function precompute(deriv, init, dt, N, warmup = 1500) {
  let x = init[0], y = init[1], z = init[2];
  for (let i = 0; i < warmup; i++) [x,y,z] = rk4(deriv,x,y,z,dt);

  const pts = new Float32Array(N * 3);
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  let count = 0;

  for (let i = 0; i < N; i++) {
    [x,y,z] = rk4(deriv,x,y,z,dt);
    if (!isFinite(x)||!isFinite(y)||!isFinite(z)) break;
    pts[i*3]=x; pts[i*3+1]=y; pts[i*3+2]=z;
    if(x<mnx)mnx=x; if(x>mxx)mxx=x;
    if(y<mny)mny=y; if(y>mxy)mxy=y;
    if(z<mnz)mnz=z; if(z>mxz)mxz=z;
    count++;
  }

  const cx=(mnx+mxx)/2, cy=(mny+mxy)/2, cz=(mnz+mxz)/2;
  const span = Math.max(mxx-mnx, mxy-mny, mxz-mnz, 1e-3);
  return { pts, cx, cy, cz, span, count };
}

/* ============================================================
   MOTOR WebGL COMPARTIDO
   ============================================================ */
/* densidad de render interna < 1 → el canvas se dibuja a menor
   resolución; el CSS ya no la pixela (ver .gl-canvas), así que el
   halo del glow queda suave al escalar. */
const PIXEL_SCALE = 0.85;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.autoClear = true;
const glCanvas = renderer.domElement;

let bufW = 1, bufH = 1;               // tamaño actual del framebuffer compartido
const registry = new Set();           // todas las vistas de atractor vivas

/* ── estética etérea: dos variantes, alternables en vivo ── */
const ATTR_KEY = "pandora_attr_mode";
let AESTHETIC_MODE = localStorage.getItem(ATTR_KEY) === "bruma" ? "bruma" : "nebulosa";

const AESTHETIC = {
  nebulosa: {
    clearColor: new THREE.Color(0x06070c),   // casi negro
    glowOp: "lighter",                       // aditivo → glow luminoso
    glowAlpha: 0.6, blurFrac: 0.05, blurMin: 2
  },
  bruma: {
    clearColor: new THREE.Color(0xffffff),   // fondo claro del sitio
    glowOp: "source-over",                   // normal → niebla suave
    glowAlpha: 0.4, blurFrac: 0.035, blurMin: 1.5
  }
};
function currentAesthetic() { return AESTHETIC[AESTHETIC_MODE]; }

function setAestheticMode(m) {
  AESTHETIC_MODE = m === "bruma" ? "bruma" : "nebulosa";
  try { localStorage.setItem(ATTR_KEY, AESTHETIC_MODE); } catch (e) {}
  document.body.classList.toggle("attr-nebulosa", AESTHETIC_MODE === "nebulosa");
  const btn = document.getElementById("btn-attractor-mode");
  if (btn) btn.textContent = AESTHETIC_MODE === "nebulosa" ? "✦ bruma" : "✦ nebulosa";
}

/* Shader del "flujo cometa" por PARTÍCULAS — cada vértice de la
   trayectoria se dibuja como un punto (gl_Points) en vez de una
   polilínea continua. Mismo revelado progresivo + cabezas cometa,
   pero ahora con un dithering ordenado (ruido de gradiente
   interleaved) que cuantiza el alfa en escalones → grano tipo
   semitono sobre cada partícula. ── */
const COMET_VERT = `
  attribute float aProg;
  uniform float uSize;
  varying float vProg;
  void main() {
    vProg = aProg;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (3.2 / -mv.z);   // atenúa suave con la profundidad
  }
`;
const COMET_FRAG = `
  precision highp float;
  uniform vec3  uColor;
  uniform float uReveal;
  uniform float uTrail;
  uniform float uBase;
  uniform float uHeads[4];
  uniform int   uHeadCount;
  varying float vProg;
  void main() {
    if (vProg > uReveal) discard;
    vec2 pc = gl_PointCoord - 0.5;          // disco suave por partícula
    float rr = dot(pc, pc);
    if (rr > 0.25) discard;
    float soft = smoothstep(0.25, 0.02, rr);

    float a = uBase;                        // estructura tenue ya revelada
    for (int k = 0; k < 4; k++) {
      if (k >= uHeadCount) break;
      float d = uHeads[k] - vProg;
      if (d < 0.0) d += uReveal;            // envolver dentro de lo revelado
      if (d < uTrail) {
        float f = 1.0 - d / uTrail;         // 0 cola → 1 cabeza
        float trailA = mix(0.16, 1.0, f);
        a = max(a, trailA);
      }
    }
    a *= soft;

    // dithering ordenado: cuantiza el alfa en escalones con un umbral
    // de ruido de gradiente → grano semitono estable (no parpadea)
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy,
                      vec2(0.06711056, 0.00583715))));
    float levels = 6.0;
    a = floor(a * levels + ign) / levels;
    if (a <= 0.0) discard;

    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  }
`;

/* Halo etéreo: recorta el mismo frame recién renderizado, lo
   desenfoca con el filtro nativo del canvas 2D y lo compone sobre
   el trazo nítido — aditivo en "nebulosa", suave en "bruma".
   Un único canvas de trabajo, reutilizado para todas las vistas
   (se procesan de a una por frame, nunca en paralelo). */
const glowScratch = document.createElement("canvas");
const glowCtx = glowScratch.getContext("2d");

function applyGlow(v) {
  const a = currentAesthetic();
  if (glowScratch.width !== v.dw || glowScratch.height !== v.dh) {
    glowScratch.width = v.dw;
    glowScratch.height = v.dh;
  }
  glowCtx.clearRect(0, 0, v.dw, v.dh);
  glowCtx.drawImage(glCanvas, 0, 0, v.dw, v.dh, 0, 0, v.dw, v.dh);

  const blurPx = Math.max(a.blurMin, v.dw * a.blurFrac);
  v.ctx.save();
  v.ctx.filter = "blur(" + blurPx.toFixed(2) + "px)";
  v.ctx.globalCompositeOperation = a.glowOp;
  v.ctx.globalAlpha = a.glowAlpha;
  v.ctx.drawImage(glowScratch, 0, 0);
  v.ctx.restore();
}

function makeAttractorScene(def, N, opts) {
  const deriv = def._lorenz ? lorenzDeriv : buildDeriv(def);
  // validación rápida
  const t0 = deriv(def.init[0], def.init[1], def.init[2]);
  if (!t0.every(isFinite)) throw new Error("diverge");

  const r = precompute(deriv, def.init || [0.1,0,0], def.dt || 0.006, N);
  if (r.count < 8) throw new Error("sin puntos");

  const n = r.count;
  const positions = new Float32Array(n * 3);
  const prog = new Float32Array(n);
  const inv = 1.9 / r.span;
  for (let i = 0; i < n; i++) {
    positions[i*3]   = (r.pts[i*3]   - r.cx) * inv;
    positions[i*3+1] = (r.pts[i*3+1] - r.cy) * inv;
    positions[i*3+2] = (r.pts[i*3+2] - r.cz) * inv;
    prog[i] = i / (n - 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aProg", new THREE.BufferAttribute(prog, 1));

  const col = new THREE.Color(def.color || DEFAULT_COLOR);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor:     { value: col },
      uReveal:    { value: 0.0 },
      uTrail:     { value: opts.trail },
      uBase:      { value: opts.base },
      uSize:      { value: opts.size || 2.6 },
      uHeads:     { value: [0,0,0,0] },
      uHeadCount: { value: opts.heads }
    },
    vertexShader: COMET_VERT,
    fragmentShader: COMET_FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);
  const group = new THREE.Group();
  group.add(points);
  group.rotation.x = opts.tiltX || 0.3;

  const scene = new THREE.Scene();
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 3.4);
  camera.lookAt(0, 0, 0);

  return { scene, camera, group, mat, total: n };
}

/* Una VISTA = un <canvas> 2D destino + su escena three.js */
function createView(hostCanvas, def, N, opts) {
  const ctx = hostCanvas.getContext("2d");
  let sc;
  try { sc = makeAttractorScene(def, N, opts); }
  catch (e) { drawError(ctx, hostCanvas); return null; }

  const view = {
    canvas: hostCanvas, ctx, ...sc,
    dw: 1, dh: 1, active: false, scale: 1,
    rotX: opts.tiltX || 0.3, rotY: 0, dragging: false,
    reveal: 0, phase: 0,
    growth: opts.growth, spin: opts.spin,
    speedEl: opts.speedEl || null,
    reset() { this.reveal = 0; this.phase = 0; },
    dispose() {
      this.active = false;
      registry.delete(this);
      this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this.mat.dispose();
    },
    step() {
      const grow = this.speedEl ? (parseInt(this.speedEl.value) || 600) / 60000 : this.growth;
      if (this.reveal < 1) this.reveal = Math.min(1, this.reveal + grow);
      if (!this.dragging) this.rotY += this.spin;
      this.phase = (this.phase + grow * 6) % 1;
      const R = this.reveal;
      const hu = this.mat.uniforms.uHeads.value;
      const hc = this.mat.uniforms.uHeadCount.value;
      for (let k = 0; k < hc; k++) hu[k] = ((this.phase + k / hc) % 1) * R;
      this.mat.uniforms.uReveal.value = R;
      this.group.rotation.x = this.rotX;
      this.group.rotation.y = this.rotY;
    }
  };
  registry.add(view);
  return view;
}

function drawError(ctx, cv) {
  const w = cv.width || 200, h = cv.height || 200;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = "#b43c3c"; ctx.font = "13px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("error", w/2, h/2);
}

/* ── ajuste de tamaño (backing store) de una vista ── */
function fitView(v) {
  const cssW = v.canvas.clientWidth || 300;
  const cssH = v.canvas.clientHeight || 300;
  const w = Math.max(1, Math.round(cssW * PIXEL_SCALE));
  const h = Math.max(1, Math.round(cssH * PIXEL_SCALE));
  if (v.canvas.width !== w)  v.canvas.width  = w;
  if (v.canvas.height !== h) v.canvas.height = h;
  v.dw = w; v.dh = h;
  if (v.camera && v.camera.isPerspectiveCamera) {
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
  }
}

function drawView(v) {
  renderer.setViewport(0, bufH - v.dh, v.dw, v.dh);
  renderer.setScissor(0, bufH - v.dh, v.dw, v.dh);
  renderer.setScissorTest(true);
  renderer.setClearColor(currentAesthetic().clearColor, 1);
  renderer.render(v.scene, v.camera);
  v.ctx.drawImage(glCanvas, 0, 0, v.dw, v.dh, 0, 0, v.dw, v.dh);
  applyGlow(v);
}

/* ── bucle central ── */
function loop() {
  const live = [];
  registry.forEach(v => { if (v.active) live.push(v); });

  let maxW = 1, maxH = 1;
  for (const v of live) { fitView(v); if (v.dw > maxW) maxW = v.dw; if (v.dh > maxH) maxH = v.dh; }
  if (maxW !== bufW || maxH !== bufH) { renderer.setSize(maxW, maxH, false); bufW = maxW; bufH = maxH; }

  for (const v of live) { v.step(); drawView(v); }
  requestAnimationFrame(loop);
}

/* rotación por arrastre en un canvas de vista */
function attachDrag(view) {
  const el = view.canvas;
  el.addEventListener("pointerdown", e => { view.dragging = true; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointerup",   e => { view.dragging = false; });
  el.addEventListener("pointercancel", () => { view.dragging = false; });
  el.addEventListener("pointermove", e => {
    if (!view.dragging) return;
    view.rotY += e.movementX * 0.008;
    view.rotX += e.movementY * 0.008;
    view.rotX = Math.max(-1.4, Math.min(1.4, view.rotX));
  });
}

/* ═══ HERO ═══ */
function makeHero(holder) {
  const cv = document.createElement("canvas");
  cv.className = "gl-canvas";
  holder.appendChild(cv);
  const view = createView(cv, { name:"Lorenz", color:"#243ec4", dt:0.006, _lorenz:true, init:[0.1,0,0] },
    32000, { trail: 0.06, base: 0.13, heads: 3, size: 3.0, tiltX: 0.28, growth: 0.006, spin: 0.0032 });
  if (view) { view.active = true; attachDrag(view); }
}

/* ═══ LIGHTBOX ═══ */
let lightboxView = null;

function openLightbox(def) {
  const overlay = document.getElementById("lightbox");
  overlay.classList.add("open");
  document.getElementById("lightbox-title").textContent = def.name;
  const holder = document.getElementById("lightbox-holder");
  holder.innerHTML = "";
  const cv = document.createElement("canvas");
  cv.className = "gl-canvas";
  holder.appendChild(cv);

  const speedEl = document.getElementById("lb-speed");
  lightboxView = createView(cv, def, 60000,
    { trail: 0.05, base: 0.13, heads: 3, size: 3.0, tiltX: 0.3, spin: 0.003, speedEl });
  if (lightboxView) { lightboxView.active = true; attachDrag(lightboxView); }
}

function closeLightbox() {
  if (lightboxView) { lightboxView.dispose(); lightboxView = null; }
  document.getElementById("lightbox").classList.remove("open");
  document.getElementById("lightbox-holder").innerHTML = "";
}

/* ═══ TARJETAS DE GALERÍA ═══ */
const cardViews = new Map();   // wrap element → view

const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    const v = cardViews.get(e.target);
    if (!v) return;
    if (e.isIntersecting) { v.reset(); v.active = true; }
    else v.active = false;
  });
}, { threshold: 0.05 });

let editingId = null;

function makeCard(def, isUser) {
  const card = document.createElement("div");
  card.className = "card";
  if (def.id) card.dataset.id = def.id;

  const eqText =
    "dx = "+def.dx+"\ndy = "+def.dy+"\ndz = "+def.dz+
    (def.params ? "\n[ "+def.params+" ]" : "");

  card.innerHTML =
    (isUser ? '<span class="own-tag">propio</span>' : "")+
    '<div class="card-wrap"><canvas class="gl-canvas"></canvas></div>'+
    '<div class="card-bar">'+
      '<span class="card-name"></span>'+
      '<div class="card-btns">'+
        '<button class="card-btn t-eq" title="ecuaciones">ƒ</button>'+
        (isUser ? '<button class="card-btn t-edit">editar</button>' : "")+
        (isUser ? '<button class="card-btn t-del">×</button>' : "")+
      '</div>'+
    '</div>'+
    '<pre class="card-eq"></pre>';

  card.querySelector(".card-name").textContent = def.name;
  card.querySelector(".card-eq").textContent   = eqText;

  const wrap = card.querySelector(".card-wrap");
  const cv   = card.querySelector("canvas");
  wrap.title = "clic para ver en grande";
  wrap.addEventListener("click", () => openLightbox(def));

  card.querySelector(".t-eq").addEventListener("click", ev => {
    ev.stopPropagation();
    card.querySelector(".card-eq").classList.toggle("show");
  });

  if (isUser) {
    card.querySelector(".t-edit").addEventListener("click", () => startEdit(def, card));
    card.querySelector(".t-del").addEventListener("click", () => {
      if (!confirm('¿Eliminar "'+def.name+'"?')) return;
      removeSnippet(def.id);
      const v = cardViews.get(wrap);
      if (v) { v.dispose(); cardViews.delete(wrap); }
      io.unobserve(wrap);
      card.remove();
    });
  }

  document.getElementById("gallery").appendChild(card);

  const view = createView(cv, def, 16000,
    { trail: 0.05, base: 0.13, heads: 2, size: 2.4, tiltX: 0.3, growth: 0.008, spin: 0.005 });
  if (view) {
    cardViews.set(wrap, view);
    io.observe(wrap);
  }
}

/* ── navegación ── */
function showSection(sec) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.sec === sec));
  document.querySelectorAll(".sec").forEach(s => s.classList.remove("active"));
  document.getElementById("sec-" + sec).classList.add("active");
  document.getElementById("hero").style.display = (sec === "cc") ? "block" : "none";
  // en babilonia garden los koi de fondo no deben aparecer
  document.body.classList.toggle("in-garden", sec === "babilonia");
}

/* ── edición ── */
function startEdit(def, card) {
  editingId = def.id;
  const sf = document.getElementById("snippet-form");
  sf.querySelector('[name="name"]').value   = def.name;
  sf.querySelector('[name="params"]').value = def.params || "";
  sf.querySelector('[name="dt"]').value     = def.dt || "";
  sf.querySelector('[name="color"]').value  = def.color || DEFAULT_COLOR;
  sf.querySelector('[name="dx"]').value     = def.dx;
  sf.querySelector('[name="dy"]').value     = def.dy;
  sf.querySelector('[name="dz"]').value     = def.dz;
  sf.querySelector('.btn-solid').textContent = "actualizar";
  document.getElementById("cancel-edit").style.display = "inline-flex";
  showSection("cc");
  document.querySelector(".upload").scrollIntoView({behavior:"smooth", block:"start"});
}

function cancelEdit() {
  editingId = null;
  const sf = document.getElementById("snippet-form");
  sf.querySelector('.btn-solid').textContent = "añadir";
  sf.reset();
  sf.querySelector('[name="color"]').value = DEFAULT_COLOR;
  document.getElementById("cancel-edit").style.display = "none";
}

/* ── localStorage ── */
const SNAP_KEY = "pandora_snippets";
const POEM_KEY = "pandora_poems";
function loadSnippets(){try{return JSON.parse(localStorage.getItem(SNAP_KEY))||[];}catch{return[];}}
function saveSnippets(a){try{localStorage.setItem(SNAP_KEY,JSON.stringify(a));}catch{}}
function removeSnippet(id){saveSnippets(loadSnippets().filter(s=>s.id!==id));}
function loadPoems(){try{return JSON.parse(localStorage.getItem(POEM_KEY))||[];}catch{return[];}}
function savePoems(a){try{localStorage.setItem(POEM_KEY,JSON.stringify(a));}catch{}}

/* ── BOOT ── */
window.addEventListener("DOMContentLoaded", () => {
  setAestheticMode(AESTHETIC_MODE);
  makeHero(document.getElementById("hero-holder"));
  loop();

  document.getElementById("btn-expand-hero").addEventListener("click", () => {
    openLightbox({name:"Lorenz", color:"#243ec4", dt:0.006, _lorenz:true, init:[0.1,0,0]});
  });

  const attrBtn = document.getElementById("btn-attractor-mode");
  if (attrBtn) attrBtn.addEventListener("click", () => {
    setAestheticMode(AESTHETIC_MODE === "nebulosa" ? "bruma" : "nebulosa");
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "e" || e.key === "E") && !/input|textarea/i.test(e.target.tagName)) {
      setAestheticMode(AESTHETIC_MODE === "nebulosa" ? "bruma" : "nebulosa");
    }
  });

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => showSection(btn.dataset.sec));
  });

  document.getElementById("lightbox").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeLightbox();
  });
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLightbox(); });
  document.getElementById("lb-replay").addEventListener("click", () => {
    if (lightboxView) lightboxView.reset();
  });

  DEFAULTS.forEach(d => makeCard(d, false));
  loadSnippets().forEach(s => makeCard(s, true));

  const sf = document.getElementById("snippet-form");
  sf.addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(sf);
    const dtVal = parseFloat(f.get("dt"));
    const def = {
      name:   (f.get("name") || "sin nombre").trim(),
      color:  f.get("color") || DEFAULT_COLOR,
      params: (f.get("params") || "").trim(),
      dx: f.get("dx").trim(), dy: f.get("dy").trim(), dz: f.get("dz").trim(),
      dt: isFinite(dtVal) && dtVal > 0 ? dtVal : 0.01,
      init: [0.1, 0, 0]
    };
    try { buildDeriv(def)(1,1,1); }
    catch(err) { alert("Error en las ecuaciones:\n"+err.message); return; }

    if (editingId) {
      def.id = editingId;
      const all = loadSnippets();
      const idx = all.findIndex(s => s.id === editingId);
      if (idx !== -1) all[idx] = def;
      saveSnippets(all);
      const oldCard = document.querySelector('[data-id="'+editingId+'"]');
      if (oldCard) {
        const wrap = oldCard.querySelector(".card-wrap");
        const v = cardViews.get(wrap);
        if (v) { v.dispose(); cardViews.delete(wrap); }
        io.unobserve(wrap);
        oldCard.remove();
      }
      cancelEdit();
      makeCard(def, true);
    } else {
      def.id = "u"+Date.now();
      const all = loadSnippets(); all.push(def); saveSnippets(all);
      makeCard(def, true);
      sf.reset();
      sf.querySelector('[name="color"]').value = DEFAULT_COLOR;
    }
  });

  document.getElementById("fill-demo").addEventListener("click", () => {
    const d = {name:"Lorenz propio", params:"a=10, b=28, c=2.6667",
      dx:"a*(y-x)", dy:"x*(b-z)-y", dz:"x*y-c*z", dt:"0.006"};
    for (const [k,v] of Object.entries(d))
      sf.querySelector('[name="'+k+'"]').value = v;
  });

  document.getElementById("cancel-edit").addEventListener("click", cancelEdit);

  const pf = document.getElementById("poem-form");
  pf.addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(pf);
    const poem = {
      id: "p"+Date.now(),
      title: (f.get("title")||"sin título").trim() || "sin título",
      body: f.get("body"),
      date: new Date().toLocaleDateString("es", {year:"numeric",month:"long",day:"numeric"})
    };
    const all = loadPoems(); all.unshift(poem); savePoems(all);
    renderPoems(); pf.reset();
  });

  renderPoems();
});

function renderPoems() {
  const list = document.getElementById("poems-list");
  const poems = loadPoems();
  list.innerHTML = "";
  if (!poems.length) {
    list.innerHTML = '<p class="empty-msg">el primero te espera al lado.</p>';
    return;
  }
  poems.forEach(pm => {
    const el = document.createElement("article");
    el.className = "poem-item";
    el.innerHTML =
      '<div class="poem-item-top"><h4></h4><button class="poem-del">borrar</button></div>'+
      '<div class="poem-date"></div><div class="poem-body"></div>';
    el.querySelector("h4").textContent        = pm.title;
    el.querySelector(".poem-date").textContent = pm.date;
    el.querySelector(".poem-body").textContent = pm.body;
    el.querySelector(".poem-del").addEventListener("click", () => {
      if (!confirm("¿Borrar este poema?")) return;
      savePoems(loadPoems().filter(x => x.id !== pm.id));
      renderPoems();
    });
    list.appendChild(el);
  });
}
