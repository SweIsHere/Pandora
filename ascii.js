/* ============================================================
   PANDORA — ascii.js
   ------------------------------------------------------------
   Dos capas ASCII en tinta azul:

   1) BANNER de cabecera  (#ascii-banner)
      Retrato de pandora.jpg con DITHERING (Floyd–Steinberg, 1-bit):
      tinta azul difundida en patrón sobre fondo casi blanco.
      Recorte "cover" centrado en la línea de los ojos.

   2) FONDO de la página  (#koi-bg)
      Koi PROCEDURALES (cuerpo ondulante + cola) que nadan y se
      envuelven por los bordes. Se dibujan en un canvas oculto a
      resolución de rejilla, se leen sus píxeles y se estampan
      como glifos ASCII → peces "de fondo", detrás del contenido.

   Ambas capas leen píxeles con getImageData, así que el sitio
   debe servirse por HTTP (p. ej. `python -m http.server`); con
   file:// el canvas queda "tainted" y la lectura falla.
   ============================================================ */
(function () {
  "use strict";

  /* ── util: ruido de gradiente interleaved → dither ordenado ── */
  const TAU = Math.PI * 2;
  const fract = (v) => v - Math.floor(v);
  function ign(x, y) {
    return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
  }
  function debounce(fn, ms) {
    let t = 0;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ════════════════════════════════════════════════════════════
     1) BANNER — retrato ASCII de pandora.jpg
     ════════════════════════════════════════════════════════════ */
  function initBanner() {
    const host = document.getElementById("ascii-banner");
    if (!host) return;

    const cv = document.createElement("canvas");
    cv.className = "ascii-canvas";
    host.appendChild(cv);
    const ctx = cv.getContext("2d");

    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });

    const img = new Image();
    let ready = false;

    img.onload = () => { ready = true; render(); };
    img.onerror = () => { host.classList.add("ascii-fail"); };
    img.src = "pandora.jpg";

    function render() {
      if (!ready) return;
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (W < 2 || H < 2) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const PX = W < 620 ? 1 : 2;              // tamaño del píxel de dithering (px) — más resolución
      const cols = Math.max(1, Math.ceil(W / PX));
      const rows = Math.max(1, Math.ceil(H / PX));
      off.width = cols;
      off.height = rows;

      // recorte "cover" centrado en la LÍNEA DE LOS OJOS (fracción de alto)
      const FOCUS_Y = 0.20;                    // ojos ≈ 20% desde arriba
      const ir = img.width / img.height, gr = cols / rows;
      let sw, sh, sx, sy;
      if (ir > gr) {
        sh = img.height; sw = sh * gr;
        sx = (img.width - sw) / 2; sy = 0;
      } else {
        sw = img.width; sh = sw / gr; sx = 0;
        sy = Math.max(0, Math.min(img.height - sh, img.height * FOCUS_Y - sh / 2));
      }
      octx.clearRect(0, 0, cols, rows);
      octx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
      const d = octx.getImageData(0, 0, cols, rows).data;

      // DITHERING (Floyd–Steinberg, 1-bit): se toma la tinta (ink = 1-lum)
      // y se binariza difundiendo el error a los vecinos → la ilusión de tono
      // nace del PATRÓN de puntos azules. Fondo casi blanco intacto en los
      // claros; el rostro/pelo/ojos se pueblan de tinta azul.
      const n = cols * rows;
      const buf = new Float32Array(n);
      for (let p = 0; p < n; p++) {
        const i = p * 4;
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        buf[p] = Math.pow(Math.max(0, 1 - lum), 0.85);   // gamma → sombreado en la cara
      }

      ctx.fillStyle = "#1c3ef0";               // tinta azul (más intensa)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const p = y * cols + x;
          const nv = buf[p] > 0.5 ? 1 : 0;     // umbral
          const err = buf[p] - nv;
          if (x + 1 < cols)                buf[p + 1]        += err * 0.4375;   // 7/16 →
          if (y + 1 < rows) {
            if (x > 0)                     buf[p + cols - 1] += err * 0.1875;   // 3/16 ↙
            buf[p + cols] += err * 0.3125;                                      // 5/16 ↓
            if (x + 1 < cols)              buf[p + cols + 1] += err * 0.0625;   // 1/16 ↘
          }
          if (nv) ctx.fillRect(x * PX, y * PX, PX, PX);
        }
      }
    }

    addEventListener("resize", debounce(render, 150));
  }

  /* ════════════════════════════════════════════════════════════
     2) FONDO — koi ASCII procedurales
     ════════════════════════════════════════════════════════════ */
  function initKoi() {
    const cv = document.getElementById("koi-bg");
    if (!cv) return;
    const ctx = cv.getContext("2d");

    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });

    const RAMP = " .:-=+*o#";
    const CELL = 8, LH = 14;                 // celda de la rejilla (px)
    let W = 0, H = 0, cols = 0, rows = 0, dpr = 1;
    const koi = [];

    function resize() {
      W = innerWidth; H = innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(W / CELL));
      rows = Math.max(1, Math.floor(H / LH));
      off.width = cols;
      off.height = rows;
      const want = Math.max(8, Math.min(20, Math.round(cols / 13)));
      while (koi.length < want) koi.push(makeKoi(true));
      koi.length = Math.min(koi.length, want);
    }

    function makeKoi(anywhere) {
      // koi PEQUEÑO, con rumbo libre (cualquier dirección)
      const len = 6 + Math.random() * 5;
      return {
        ang: Math.random() * TAU,            // rumbo (rad)
        x: Math.random() * cols,
        y: Math.random() * rows,
        len,
        wid: 1.2 + Math.random() * 1.1,
        speed: 4.5 + Math.random() * 6,      // celdas/segundo
        swim: Math.random() * TAU,           // fase de ondulación (se integra en el tiempo)
        swimRate: 7 + Math.random() * 4,     // rad/seg de coleteo
        turnFreq: 0.15 + Math.random() * 0.35, // Hz del serpenteo del rumbo
        turnPhase: Math.random() * TAU,
        turnAmp: 0.5 + Math.random() * 0.9   // rad/seg de amplitud de giro
      };
    }

    // Dibuja el koi orientado SIEMPRE según su rumbo (k.ang). La CABEZA va
    // en +x (el sentido de avance) y la cola en -x, así nada de cabeza. La
    // onda del cuerpo viaja de la cabeza (u=0) a la cola (u=1) con una única
    // fase de nado integrada en el tiempo → coleteo continuo y coherente.
    function drawKoi(k) {
      octx.save();
      octx.translate(k.x, k.y);
      octx.rotate(k.ang);

      const segs = 9;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;                    // 0 cabeza … 1 cola
        const along = (0.75 - u) * k.len;      // cabeza en +x (avance), cola en -x
        const wob = Math.sin(k.swim - u * 3.4) * (u * k.wid * 1.2);
        const r = k.wid * Math.sin(Math.PI * (0.14 + u * 0.82));
        const a = 0.92 * (1 - u * 0.42);
        octx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
        octx.beginPath();
        octx.arc(along, wob, Math.max(0.5, r), 0, TAU);
        octx.fill();
      }
      // aleta caudal en el extremo -x (cola), coletea con la misma fase
      const bx = -0.25 * k.len;
      const by = Math.sin(k.swim - 3.4) * (k.wid * 1.2);
      const flap = Math.sin(k.swim) * k.wid * 0.9;
      octx.fillStyle = "rgba(255,255,255,0.5)";
      octx.beginPath();
      octx.moveTo(bx, by);
      octx.lineTo(bx - k.len * 0.32, by - k.wid * 1.5 + flap);
      octx.lineTo(bx - k.len * 0.32, by + k.wid * 1.5 + flap);
      octx.closePath();
      octx.fill();
      octx.restore();
    }

    let raf = 0, last = 0;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      let dt = (now - last) / 1000;            // segundos reales → nado consistente
      last = now;
      if (!(dt > 0)) return;
      if (dt > 0.05) dt = 0.05;                // acota saltos tras pausa/lag

      const secs = now * 0.001;
      for (const k of koi) {
        // serpenteo suave del rumbo → nado libre y errático pero fluido
        k.ang += Math.sin(secs * k.turnFreq * TAU + k.turnPhase) * k.turnAmp * dt;
        k.swim += k.swimRate * dt;
        k.x += Math.cos(k.ang) * k.speed * dt;
        k.y += Math.sin(k.ang) * k.speed * dt;
        // rebote suave en los bordes (reflexión del rumbo)
        if (k.x < 1)        { k.x = 1;        k.ang = Math.PI - k.ang; }
        if (k.x > cols - 1) { k.x = cols - 1; k.ang = Math.PI - k.ang; }
        if (k.y < 1)        { k.y = 1;        k.ang = -k.ang; }
        if (k.y > rows - 1) { k.y = rows - 1; k.ang = -k.ang; }
      }

      // pintar formas y leer píxeles
      octx.clearRect(0, 0, cols, rows);
      for (const k of koi) drawKoi(k);
      const d = octx.getImageData(0, 0, cols, rows).data;

      // estampar glifos
      ctx.clearRect(0, 0, W, H);
      ctx.font = (LH - 2) + 'px "Courier New", ui-monospace, monospace';
      ctx.textBaseline = "top";
      const last2 = RAMP.length - 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const a = d[(y * cols + x) * 4 + 3] / 255;
          if (a < 0.09) continue;
          let li = a * last2 + (ign(x, y) - 0.5) * 1.1;   // dither ordenado
          li = Math.max(0, Math.min(last2, Math.round(li)));
          const ch = RAMP[li];
          if (ch === " ") continue;
          const b = 0.45 + 0.55 * a;
          ctx.fillStyle = "rgba(" +
            Math.round(58 * b) + "," + Math.round(104 * b) + "," + Math.round(228 * b) +
            "," + (0.45 + 0.5 * a).toFixed(2) + ")";
          ctx.fillText(ch, x * CELL, y * LH);
        }
      }
    }

    resize();
    addEventListener("resize", debounce(resize, 150));
    raf = requestAnimationFrame(frame);
  }

  /* ── boot ── */
  function boot() { initBanner(); initKoi(); }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
