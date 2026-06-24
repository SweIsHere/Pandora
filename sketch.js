/* ============================================================
   PANDORA — sketch.js v5
   Rendering: líneas vectoriales (polyline) — beginShape/vertex
   Trazo semi-transparente que se acumula; build-up progresivo
   ============================================================ */

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

/* ── utils ── */
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

/* Escala de render interno < 1 → el canvas se dibuja a menor resolución
   y el CSS lo amplía con image-rendering:pixelated → pixelado ligero. */
const PIXEL_SCALE = 0.6;

/* Matriz Bayer 4×4 para un dithering ordenado mínimo. */
const BAYER = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
];

/* Aplica un dithering minúsculo SOLO a los píxeles más tenues (la estructura
   del atractor), dejando intactos los cometas brillantes → textura granulada. */
function applyDither(p) {
  const W = p.width, H = p.height;
  const FAINT = 64;            // umbral: solo píxeles casi-blancos se estipulan
  p.loadPixels();
  const px = p.pixels;
  for (let y = 0; y < H; y++) {
    const row = BAYER[y & 3];
    for (let x = 0; x < W; x++) {
      const k = 4 * (y * W + x);
      const r = px[k], g = px[k+1], b = px[k+2];
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const dist = 255 - mn;    // 0 = blanco puro, mayor = más color
      if (dist > 4 && dist < FAINT) {
        const thr = (row[x & 3] + 0.5) / 16 * FAINT;
        if (dist < thr) { px[k] = 255; px[k+1] = 255; px[k+2] = 255; }
      }
    }
  }
  p.updatePixels();
}

/* Render "flujo cometa":
   - la parte ya revelada de la trayectoria se dibuja tenue (estructura)
   - varios cabezales brillantes recorren la curva dejando una cola que
     se desvanece → puntos en movimiento continuo sobre el atractor
   drawn  = cuántos puntos de la estructura están revelados (build-up)
   base   = fase de avance de los cabezales
   heads  = nº de cometas equiespaciados
   trail  = longitud (en puntos) de la cola */
function renderFlow(p, pts, drawn, base, heads, trail, cx, cy, cz, span, rotX, rotY, color) {
  const W = p.width, H = p.height;
  const scale = Math.min(W, H) * 0.80 / span;
  const halfW = W / 2, halfH = H / 2;
  const cX=Math.cos(rotX), sX=Math.sin(rotX);
  const cY=Math.cos(rotY), sY=Math.sin(rotY);
  const r=color[0], g=color[1], b=color[2];

  p.background(255);
  if (drawn < 2) return;

  // ── estructura tenue ya revelada ──
  p.noFill();
  p.strokeJoin(p.ROUND);
  p.strokeWeight(0.9);
  p.stroke(r, g, b, 34);
  p.beginShape();
  for (let i = 0; i < drawn; i++) {
    const ax=pts[i*3]-cx, ay=pts[i*3+1]-cy, az=pts[i*3+2]-cz;
    const bx= ax*cY + az*sY;
    const bz=-ax*sY + az*cY;
    const by= ay*cX - bz*sX;
    p.vertex(halfW + bx*scale, halfH - by*scale);
  }
  p.endShape();

  const hr = Math.max(1.4, Math.min(W, H) * 0.008);

  // ── cometas ──
  for (let k = 0; k < heads; k++) {
    const head = (base + Math.floor(k * drawn / heads)) % drawn;
    const start = Math.max(1, head - trail);

    let i0 = start - 1;
    let ax=pts[i0*3]-cx, ay=pts[i0*3+1]-cy, az=pts[i0*3+2]-cz;
    let bx= ax*cY+az*sY, bz=-ax*sY+az*cY, by=ay*cX-bz*sX;
    let prevX=halfW+bx*scale, prevY=halfH-by*scale;

    const denom = (head - start) || 1;
    for (let i = start; i <= head; i++) {
      const a2=pts[i*3]-cx, b2=pts[i*3+1]-cy, c2=pts[i*3+2]-cz;
      const bx2= a2*cY+c2*sY, bz2=-a2*sY+c2*cY, by2=b2*cX-bz2*sX;
      const x=halfW+bx2*scale, y=halfH-by2*scale;
      const f=(i-start)/denom;                 // 0 cola → 1 cabeza
      p.strokeWeight(0.4 + f*1.0);
      p.stroke(r, g, b, 40 + f*215);
      p.line(prevX, prevY, x, y);
      prevX=x; prevY=y;
    }

    // cabeza brillante con halo
    const hax=pts[head*3]-cx, hay=pts[head*3+1]-cy, haz=pts[head*3+2]-cz;
    const hbx= hax*cY+haz*sY, hbz=-hax*sY+haz*cY, hby=hay*cX-hbz*sX;
    const hx=halfW+hbx*scale, hy=halfH-hby*scale;
    p.noStroke();
    p.fill(r, g, b, 50);  p.circle(hx, hy, hr*2.2);
    p.fill(r, g, b, 255); p.circle(hx, hy, hr);
  }

  applyDither(p);
}

/* ═══ HERO ═══ */
function makeHero(holder) {
  const N = 32000, GROW = 200;
  const FG = [36, 62, 196];

  return new p5(p => {
    let pts, cx, cy, cz, span, total;
    let rotX = 0.25, rotY = 0;
    let renderN = 0, base = 0;

    const dt = 0.006;
    function lorenz(x,y,z) {
      const σ=10, ρ=28, β=8/3;
      return [σ*(y-x), x*(ρ-z)-y, x*y-β*z];
    }

    function sizeOf() {
      const w = (holder.clientWidth || 600) * PIXEL_SCALE;
      const h = (holder.clientHeight || 600) * PIXEL_SCALE;
      return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
    }

    p.setup = function() {
      const [w,h] = sizeOf();
      const c = p.createCanvas(w, h);
      c.parent(holder);
      p.pixelDensity(1); p.noSmooth();
      p.frameRate(30);
      const r = precompute(lorenz, [0.1,0,0], dt, N);
      pts=r.pts; cx=r.cx; cy=r.cy; cz=r.cz; span=r.span; total=r.count;
    };

    p.windowResized = function() {
      const [w,h] = sizeOf();
      p.resizeCanvas(w, h);
    };

    p.mouseDragged = function() {
      const over = p.mouseX>=0&&p.mouseX<=p.width&&p.mouseY>=0&&p.mouseY<=p.height;
      if(!over) return;
      rotY += (p.mouseX-p.pmouseX)*0.010;
      rotX += (p.mouseY-p.pmouseY)*0.010;
      rotX = Math.max(-1.4, Math.min(1.4, rotX));
    };

    p.draw = function() {
      if(!p.mouseIsPressed) rotY += 0.0035;
      if(renderN < total) renderN = Math.min(renderN+GROW, total);
      base = (base + GROW) % Math.max(1, renderN);
      const trail = Math.max(40, (total*0.05)|0);
      renderFlow(p, pts, renderN, base, 3, trail, cx, cy, cz, span, rotX, rotY, FG);
    };
  }, holder);
}

/* ═══ LIGHTBOX ═══ */
let lightboxInst = null;

function openLightbox(def) {
  const overlay = document.getElementById("lightbox");
  overlay.classList.add("open");
  document.getElementById("lightbox-title").textContent = def.name;
  const holder = document.getElementById("lightbox-holder");
  holder.innerHTML = "";

  const N = 60000;
  const fg = def.color ? hexToRgb(def.color) : [36,62,196];
  const speedEl = document.getElementById("lb-speed");

  lightboxInst = new p5(p => {
    let pts, cx, cy, cz, span, total;
    let rotX = 0.3, rotY = 0;
    let renderN = 0, base = 0;
    let broken = false;

    function sizeOf() {
      const w = (holder.clientWidth || 600) * PIXEL_SCALE;
      const h = (holder.clientHeight || 600) * PIXEL_SCALE;
      return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
    }

    p.setup = function() {
      const [w,h] = sizeOf();
      const c = p.createCanvas(w, h);
      c.parent(holder);
      p.pixelDensity(1); p.noSmooth();
      p.frameRate(30);
      try {
        let deriv;
        if(def._lorenz) {
          deriv=(x,y,z)=>{const σ=10,ρ=28,β=8/3;return[σ*(y-x),x*(ρ-z)-y,x*y-β*z];};
        } else {
          deriv = buildDeriv(def);
        }
        const r = precompute(deriv, def.init||[0.1,0,0], def.dt||0.006, N);
        pts=r.pts; cx=r.cx; cy=r.cy; cz=r.cz; span=r.span; total=r.count;
      } catch { broken=true; }
    };

    p.windowResized = function() {
      const [w,h] = sizeOf();
      p.resizeCanvas(w, h);
    };

    p.mouseDragged = function() {
      const over=p.mouseX>=0&&p.mouseX<=p.width&&p.mouseY>=0&&p.mouseY<=p.height;
      if(!over) return;
      rotY += (p.mouseX-p.pmouseX)*0.010;
      rotX += (p.mouseY-p.pmouseY)*0.010;
      rotX = Math.max(-1.4, Math.min(1.4, rotX));
    };

    p.replay = function() { renderN = 0; base = 0; };

    p.draw = function() {
      if(broken){p.background(255);p.noLoop();return;}
      rotY += 0.0035;
      const grow = parseInt(speedEl && speedEl.value) || 800;
      if(renderN < total) renderN = Math.min(renderN+grow, total);
      base = (base + grow) % Math.max(1, renderN);
      const trail = Math.max(60, (total*0.05)|0);
      renderFlow(p, pts, renderN, base, 3, trail, cx, cy, cz, span, rotX, rotY, fg);
    };
  }, holder);
}

function closeLightbox() {
  if(lightboxInst){lightboxInst.remove();lightboxInst=null;}
  document.getElementById("lightbox").classList.remove("open");
  document.getElementById("lightbox-holder").innerHTML="";
}

/* ═══ GALLERY CARDS ═══ */
const galleryInstances = new Map();

const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    const inst = galleryInstances.get(e.target);
    if(!inst) return;
    if(e.isIntersecting) {
      if(inst.resetAnim) inst.resetAnim();
      inst.loop();
    } else {
      inst.noLoop();
    }
  });
}, {threshold:0.05});

let editingId = null;

function makeCard(def, isUser) {
  const N = 16000, GROW = 130;

  const card = document.createElement("div");
  card.className = "card";
  if(def.id) card.dataset.id = def.id;

  const eqText =
    "dx = "+def.dx+"\ndy = "+def.dy+"\ndz = "+def.dz+
    (def.params ? "\n[ "+def.params+" ]" : "");

  card.innerHTML =
    (isUser ? '<span class="own-tag">propio</span>' : "")+
    '<div class="card-wrap"></div>'+
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
  wrap.title = "clic para ver en grande";

  wrap.addEventListener("click", () => openLightbox(def));

  card.querySelector(".t-eq").addEventListener("click", () => {
    card.querySelector(".card-eq").classList.toggle("show");
  });

  if(isUser) {
    card.querySelector(".t-edit").addEventListener("click", () => startEdit(def, card));
    card.querySelector(".t-del").addEventListener("click", () => {
      if(!confirm('¿Eliminar "'+def.name+'"?')) return;
      removeSnippet(def.id);
      const inst = galleryInstances.get(wrap);
      if(inst){inst.remove();galleryInstances.delete(wrap);}
      io.unobserve(wrap);
      card.remove();
    });
  }

  document.getElementById("gallery").appendChild(card);

  const fg = hexToRgb(def.color);

  const inst = new p5(p => {
    let pts, cx, cy, cz, span, total;
    let rotY = 0;
    let renderN = 0, base = 0;
    let broken = false;

    p.resetAnim = () => { renderN = 0; base = 0; };

    function sizeOf() {
      const w = (wrap.clientWidth || 300) * PIXEL_SCALE;
      const h = (wrap.clientHeight || 300) * PIXEL_SCALE;
      return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
    }

    p.setup = function() {
      const [w,h] = sizeOf();
      const c = p.createCanvas(w, h);
      c.parent(wrap);
      p.pixelDensity(1); p.noSmooth();
      p.frameRate(30);
      let deriv;
      try {
        deriv = buildDeriv(def);
        const test = deriv(def.init[0], def.init[1], def.init[2]);
        if(!test.every(isFinite)) throw new Error("diverges");
      } catch { broken=true; return; }
      try {
        const r = precompute(deriv, def.init, def.dt, N);
        pts=r.pts; cx=r.cx; cy=r.cy; cz=r.cz; span=r.span; total=r.count;
      } catch { broken=true; }
    };

    p.windowResized = function() {
      const [w,h] = sizeOf();
      p.resizeCanvas(w, h);
    };

    p.draw = function() {
      if(broken){
        p.background(255);
        p.fill(180,60,60); p.noStroke();
        p.textSize(11); p.textAlign(p.CENTER,p.CENTER);
        p.text("error", p.width/2, p.height/2);
        p.noLoop(); return;
      }
      rotY += 0.005;
      if(renderN < total) renderN = Math.min(renderN+GROW, total);
      base = (base + GROW) % Math.max(1, renderN);
      const trail = Math.max(40, (total*0.05)|0);
      renderFlow(p, pts, renderN, base, 2, trail, cx, cy, cz, span, 0.3, rotY, fg);
    };
  }, wrap);

  galleryInstances.set(wrap, inst);
  io.observe(wrap);
}

/* ── navegación entre pestañas ── */
function showSection(sec) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.sec === sec));
  document.querySelectorAll(".sec").forEach(s => s.classList.remove("active"));
  document.getElementById("sec-" + sec).classList.add("active");
  // el atractor hero solo vive en la pestaña creative coding
  document.getElementById("hero").style.display = (sec === "cc") ? "block" : "none";
}

/* ── Edit ── */
function startEdit(def, card) {
  editingId = def.id;
  const sf = document.getElementById("snippet-form");
  sf.querySelector('[name="name"]').value   = def.name;
  sf.querySelector('[name="params"]').value = def.params || "";
  sf.querySelector('[name="dt"]').value     = def.dt || "";
  sf.querySelector('[name="color"]').value  = def.color || "#243ec4";
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
  sf.querySelector('[name="color"]').value = "#243ec4";
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

  makeHero(document.getElementById("hero-holder"));

  document.getElementById("btn-expand-hero").addEventListener("click", () => {
    openLightbox({name:"Lorenz", color:"#243ec4", dt:0.006, _lorenz:true, init:[0.1,0,0]});
  });

  // navigation
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => showSection(btn.dataset.sec));
  });

  // lightbox close
  document.getElementById("lightbox").addEventListener("click", e => {
    if(e.target === e.currentTarget) closeLightbox();
  });
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", e => { if(e.key==="Escape") closeLightbox(); });

  // reiniciar la formación del atractor en el visor
  document.getElementById("lb-replay").addEventListener("click", () => {
    if(lightboxInst && lightboxInst.replay) lightboxInst.replay();
  });

  // gallery
  DEFAULTS.forEach(d => makeCard(d, false));
  loadSnippets().forEach(s => makeCard(s, true));

  // snippet form
  const sf = document.getElementById("snippet-form");
  sf.addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(sf);
    const dtVal = parseFloat(f.get("dt"));
    const def = {
      name:   (f.get("name") || "sin nombre").trim(),
      color:  f.get("color") || "#243ec4",
      params: (f.get("params") || "").trim(),
      dx: f.get("dx").trim(), dy: f.get("dy").trim(), dz: f.get("dz").trim(),
      dt: isFinite(dtVal) && dtVal > 0 ? dtVal : 0.01,
      init: [0.1, 0, 0]
    };
    try { buildDeriv(def)(1,1,1); }
    catch(err) { alert("Error en las ecuaciones:\n"+err.message); return; }

    if(editingId) {
      def.id = editingId;
      const all = loadSnippets();
      const idx = all.findIndex(s => s.id === editingId);
      if(idx !== -1) all[idx] = def;
      saveSnippets(all);

      const oldCard = document.querySelector('[data-id="'+editingId+'"]');
      if(oldCard) {
        const wrap = oldCard.querySelector(".card-wrap");
        const inst = galleryInstances.get(wrap);
        if(inst){inst.remove();galleryInstances.delete(wrap);}
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
      sf.querySelector('[name="color"]').value = "#243ec4";
    }
  });

  document.getElementById("fill-demo").addEventListener("click", () => {
    const d = {name:"Lorenz propio", params:"a=10, b=28, c=2.6667",
      dx:"a*(y-x)", dy:"x*(b-z)-y", dz:"x*y-c*z", dt:"0.006"};
    for(const [k,v] of Object.entries(d))
      sf.querySelector('[name="'+k+'"]').value = v;
  });

  document.getElementById("cancel-edit").addEventListener("click", cancelEdit);

  // poems
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
  if(!poems.length) {
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
      if(!confirm("¿Borrar este poema?")) return;
      savePoems(loadPoems().filter(x => x.id !== pm.id));
      renderPoems();
    });
    list.appendChild(el);
  });
}
