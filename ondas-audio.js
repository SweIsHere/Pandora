/* ============================================================
   PANDORA — ondas-audio.js
   ------------------------------------------------------------
   Sonido etéreo del modo "ondas". Dos capas:

   · NOTAS (clic) — cada clic toca UNA sola nota (no un acorde),
     tomada de la pentatónica de Do mayor para que toda secuencia
     de clics suene cohesionada, como campanas bajo el agua.
     La X elige el grado de la escala; la Y, la octava; también
     pinta el paneo estéreo. Timbre = par de senos con detune
     leve (batido lento) y envolvente larga → cuenco / vidrio.

   · CHISPAS (movimiento) — mientras el ratón se desplaza brotan
     pequeñas notas CRISTALINAS (parciales de campana/vidrio,
     agudas y brillantes), como un carillón. Se disparan cada vez
     que el cursor acumula algo de distancia; la Y elige el tono
     (agudo arriba), la X el paneo, y la velocidad el brillo.

   Reverb barata compartida: eco con retroalimentación filtrada
   en graves (delay + lowpass). splash() = inmersión al entrar.
   El AudioContext se crea perezosamente dentro de un gesto del
   usuario (política de autoplay).
   Expone window.PandoraSound = { start, stop, splash }.
   ============================================================ */
(function () {
  "use strict";

  const VOL = 0.55;         // ganancia maestra
  const DUR = 3.2;          // s de cola de cada nota

  /* pentatónica de Do mayor (una octava base): Do Re Mi Sol La */
  const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00];

  /* cuantiza v∈[0,1] a la pentatónica repartida en 2 octavas */
  function scaleFreq(v) {
    const span = PENTA.length * 2;
    let i = Math.round(Math.max(0, Math.min(1, v)) * (span - 1));
    const oct = Math.floor(i / PENTA.length);
    const deg = i % PENTA.length;
    return PENTA[deg] * Math.pow(2, oct - 1); // centrado ~una octava abajo
  }

  let ac = null, master = null, delaySend = null, sparkBus = null;

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = VOL;
    // compresor suave al final: evita recortes con voces generosas
    if (ac.createDynamicsCompressor) {
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      master.connect(comp); comp.connect(ac.destination);
    } else {
      master.connect(ac.destination);
    }
    // eco con retroalimentación amortiguada = reverb de bolsillo
    const delay = ac.createDelay(1.0); delay.delayTime.value = 0.31;
    const damp = ac.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 1500;
    const fb = ac.createGain(); fb.gain.value = 0.44;
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    const wet = ac.createGain(); wet.gain.value = 0.5;
    delay.connect(wet); wet.connect(master);
    delaySend = delay;
    // bus de chispas: low-pass global velado + envío generoso a la reverb
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850; lp.Q.value = 0.5;
    const revSend = ac.createGain(); revSend.gain.value = 0.75; // más cola que las notas de clic
    lp.connect(master); lp.connect(revSend); revSend.connect(delay);
    sparkBus = lp;
    return ac;
  }

  /* ─── una nota individual (clic) ─── */
  function note(a, freq, t, x01, amp) {
    amp = (amp || 1) * 0.24;
    const o1 = a.createOscillator(); o1.type = "sine"; o1.frequency.value = freq;
    const o2 = a.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 1.003;
    const g = a.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + DUR);
    o1.connect(g); o2.connect(g);
    let out = g;
    if (a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (x01 * 2 - 1) * 0.6 + (Math.random() * 0.2 - 0.1)));
      g.connect(p); out = p;
    }
    out.connect(master); out.connect(delaySend);
    o1.start(t); o2.start(t);
    o1.stop(t + DUR + 0.1); o2.stop(t + DUR + 0.1);
  }

  function pluck(x01, y01) {
    const a = ensure(); if (!a) return;
    if (a.state === "suspended") a.resume();
    // X → grado de la escala · Y → octava (arriba agudo, abajo grave)
    const deg = Math.max(0, Math.min(PENTA.length - 1, Math.floor(x01 * PENTA.length)));
    const oct = y01 < 0.33 ? 2 : (y01 > 0.8 ? 0.5 : 1);
    note(a, PENTA[deg] * oct, a.currentTime + 0.01, x01, 1);
  }

  /* ─── chispas cristalinas (movimiento) ─── */
  const SPARK_DIST = 95;    // px acumulados por chispa (espaciadas)
  const SPARK_MIN_MS = 160; // ~6 chispas/s como máximo
  let lastX = 0, lastY = 0, lastMoveT = 0, lastSparkT = 0, accDist = 0, seeded = false;

  /* una nota onírica: senos velados con detune leve, ataque suave */
  function sparkle(x01, y01, amp) {
    const a = ensure(); if (!a) return;
    const t = a.currentTime + 0.005;
    // pentatónica 1–2 octavas arriba, según la altura (agudo arriba)
    const deg = Math.max(0, Math.min(PENTA.length - 1, Math.floor((1 - y01) * PENTA.length)));
    const oct = Math.random() < 0.45 ? 4 : 2;
    const f = PENTA[deg] * oct;
    // par de senos con batido lento → halo difuso, nada de filo de vidrio
    const o1 = a.createOscillator(); o1.type = "sine"; o1.frequency.value = f;
    const o2 = a.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 1.006;
    // lowpass velado: quita los agudos que sonaban cristalinos
    const lp = a.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.value = f * 2.2; lp.Q.value = 0.4;
    const g  = a.createGain();
    const A = 0.05 + Math.random() * 0.04;   // ataque suave: se cuela, no pincha
    const D = 1.4 + Math.random() * 1.2;     // cola larga y difusa
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + A);
    g.gain.exponentialRampToValueAtTime(0.0001, t + A + D);
    o1.connect(lp); o2.connect(lp); lp.connect(g);
    let out = g;
    if (a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (x01 * 2 - 1) * 0.7));
      g.connect(p); out = p;
    }
    out.connect(sparkBus);   // low-pass global + reverb del bus de chispas
    o1.start(t); o2.start(t);
    o1.stop(t + A + D + 0.05); o2.stop(t + A + D + 0.05);
  }

  function onMove(e) {
    const a = ensure(); if (!a) return;
    if (a.state === "suspended") a.resume();
    const now = performance.now();
    if (!seeded) { lastX = e.clientX; lastY = e.clientY; lastMoveT = now; seeded = true; return; }
    const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    const speed = dist / Math.max(1, now - lastMoveT); // px/ms
    lastX = e.clientX; lastY = e.clientY; lastMoveT = now;
    accDist += dist;
    if (accDist >= SPARK_DIST && now - lastSparkT >= SPARK_MIN_MS) {
      accDist = 0; lastSparkT = now;
      const amp = Math.min(0.075, 0.025 + speed * 0.035);
      sparkle(e.clientX / innerWidth, e.clientY / innerHeight, amp);
    }
  }

  /* inmersión: acompaña la animación de "llenado del vaso" */
  function splash() {
    const a = ensure(); if (!a) return;
    if (a.state === "suspended") a.resume();
    const t = a.currentTime + 0.02;
    // glissando que se hunde (La3 → Do1) con el filtro cerrándose
    const o = a.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(65.4, t + 1.6);
    const lp = a.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 1.6);
    const g = a.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    o.connect(lp); lp.connect(g); g.connect(master); g.connect(delaySend);
    o.start(t); o.stop(t + 2.4);
    // burbujas: blips cortos que suben de tono, repartidos en el llenado
    for (let i = 0; i < 6; i++) {
      const tb = t + 0.15 + Math.random() * 1.3;
      const fb = 480 + Math.random() * 520;
      const ob = a.createOscillator(); ob.type = "sine";
      ob.frequency.setValueAtTime(fb, tb);
      ob.frequency.exponentialRampToValueAtTime(fb * 1.6, tb + 0.09);
      const gb = a.createGain();
      gb.gain.setValueAtTime(0, tb);
      gb.gain.linearRampToValueAtTime(0.06, tb + 0.02);
      gb.gain.exponentialRampToValueAtTime(0.0001, tb + 0.18);
      ob.connect(gb); gb.connect(master); gb.connect(delaySend);
      ob.start(tb); ob.stop(tb + 0.22);
    }
  }

  function onDown(e) {
    // el botón de alternar modo no debe sonar (cerraría el modo con cola)
    if (e.target && e.target.closest && e.target.closest("#fx-toggle")) return;
    pluck(e.clientX / innerWidth, e.clientY / innerHeight);
  }

  function start() {
    seeded = false; accDist = 0;
    addEventListener("pointerdown", onDown);
    addEventListener("pointermove", onMove, { passive: true });
  }
  function stop() {
    removeEventListener("pointerdown", onDown);
    removeEventListener("pointermove", onMove);
    seeded = false;
    if (ac && ac.state === "running") ac.suspend();
  }

  window.PandoraSound = { start: start, stop: stop, splash: splash };
})();
