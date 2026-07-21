/* ============================================================
   PANDORA — pointer.js
   ------------------------------------------------------------
   Coordinador de los dos efectos de puntero:
   · "tinta"  → halftone spotlight (rejilla de puntos + aro),
                dibujado en 2D sobre el canvas #fx-halftone.
   · "ondas"  → anillos expansivos con bloom real, dibujados con
                three.js/shaders por pointer-rings.js sobre un
                escenario oscuro (#fx-stage) + canvas WebGL
                (#fx-rings). Ver ese archivo para el detalle.
   Alternar con el botón #fx-toggle o la tecla "D"; se recuerda
   en localStorage. No toca sketch.js ni el motor de atractores.
   ============================================================ */
(function () {
  "use strict";

  const halftone = document.getElementById("fx-halftone");
  const ringsCv  = document.getElementById("fx-rings");
  const ring     = document.getElementById("cursor-ring");
  const toggle   = document.getElementById("fx-toggle");
  if (!halftone || !ring) return;

  /* ══ MODO "tinta" — halftone spotlight ══ */
  const ctx = halftone.getContext("2d");
  let DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resizeHalftone() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    halftone.width  = Math.floor(innerWidth  * DPR);
    halftone.height = Math.floor(innerHeight * DPR);
    halftone.style.width  = innerWidth  + "px";
    halftone.style.height = innerHeight + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resizeHalftone();
  addEventListener("resize", resizeHalftone);

  const target = { x: innerWidth / 2, y: innerHeight / 2 };
  const ease   = { x: target.x, y: target.y };
  let radius = 120, radiusTo = 120, seen = false;
  ring.style.opacity = "0";

  const GRID = 12, DOT = 4.0, INK = "36,62,196";
  const HOT_SEL =
    "a,button,.nav-item,.card-wrap,.card-btn,.copy-btn,.lb-btn," +
    ".lb-close,input,textarea,summary,[role=button]";

  addEventListener("pointermove", (e) => {
    target.x = e.clientX; target.y = e.clientY;
    if (!seen) { ease.x = target.x; ease.y = target.y; ring.style.opacity = ""; }
    seen = true;
    const hot = e.target && e.target.closest && e.target.closest(HOT_SEL);
    ring.classList.toggle("hot", !!hot);
    radiusTo = hot ? 165 : 120;
  }, { passive: true });
  addEventListener("pointerdown", () => { radiusTo *= 0.7; });
  addEventListener("pointerup",   () => { radiusTo = ring.classList.contains("hot") ? 165 : 120; });
  addEventListener("pointerleave", () => { seen = false; });

  /* Un ÚNICO bucle persistente: siempre re-agenda. Sólo dibuja la
     rejilla de tinta cuando el modo activo es "tinta"; en "ondas"
     limpia y no-opera. Así alternar de modo nunca deja el bucle
     muerto (era la causa de que la tinta "no volviera"). */
  function frameHalftone() {
    requestAnimationFrame(frameHalftone);
    if (mode !== "tinta") return;

    ease.x += (target.x - ease.x) * 0.2;
    ease.y += (target.y - ease.y) * 0.2;
    ring.style.transform = "translate(" + ease.x + "px," + ease.y + "px)";
    radius += (radiusTo - radius) * 0.12;

    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (seen) {
      const R = radius, cx = target.x, cy = target.y, R2 = R * R;
      const x0 = Math.max(0, Math.floor((cx - R) / GRID)) * GRID;
      const y0 = Math.max(0, Math.floor((cy - R) / GRID)) * GRID;
      const x1 = Math.min(innerWidth,  cx + R);
      const y1 = Math.min(innerHeight, cy + R);
      for (let y = y0; y <= y1; y += GRID) {
        for (let x = x0; x <= x1; x += GRID) {
          const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const t = 1 - Math.sqrt(d2) / R;
          const r = DOT * t;
          if (r < 0.35) continue;
          ctx.fillStyle = "rgba(" + INK + "," + (0.2 + 0.55 * t).toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  /* ══ coordinador de modo ══ */
  const KEY = "pandora_fxmode";
  let mode = localStorage.getItem(KEY) === "ondas" ? "ondas" : "tinta";

  function applyMode() {
    const ondas = mode === "ondas";
    document.body.classList.toggle("fx-dark", ondas);
    halftone.style.display = ondas ? "none" : "";
    ring.style.display     = ondas ? "none" : "";
    if (ringsCv) ringsCv.style.display = ondas ? "block" : "none";
    if (toggle) toggle.textContent = ondas ? "✦ tinta" : "✦ ondas";
    try { localStorage.setItem(KEY, mode); } catch (e) {}

    if (ondas) {
      if (window.PandoraRings && ringsCv) window.PandoraRings.start(ringsCv);
      if (window.PandoraLife) window.PandoraLife.start();
    } else {
      if (window.PandoraRings) window.PandoraRings.stop();
      if (window.PandoraLife) window.PandoraLife.stop();
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
  function toggleMode() { mode = mode === "tinta" ? "ondas" : "tinta"; applyMode(); }
  if (toggle) toggle.addEventListener("click", toggleMode);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode === "ondas") { mode = "tinta"; applyMode(); }
  });
  applyMode();
  requestAnimationFrame(frameHalftone);   // bucle persistente único
})();
