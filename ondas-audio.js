/* ============================================================
   PANDORA — ondas-audio.js
   ------------------------------------------------------------
   Sonido etéreo del modo "ondas": cada clic arpegia un acorde
   SUSPENDIDO (sus2 / sus4) o MAJ7, todos diatónicos a Do mayor
   para que cualquier secuencia de clics suene cohesionada, como
   campanas bajo el agua.
   · Voces = pares de senos con detune leve (batido lento) y
     envolvente larga → timbre de cuenco / vidrio.
   · Pseudo-reverb barata: eco con retroalimentación filtrada
     en graves (delay + lowpass) compartido por todas las voces.
   · La posición del clic pinta el sonido: X → paneo estéreo,
     Y → octava (arriba agudo, abajo grave).
   Además, splash() = sonido de INMERSIÓN al entrar al modo:
   glissando grave que se hunde con el filtro cerrándose, más
   burbujas que suben mientras "se llena el vaso".
   El AudioContext se crea perezosamente dentro de un gesto del
   usuario (política de autoplay).
   Expone window.PandoraSound = { start, stop, splash }.
   ============================================================ */
(function () {
  "use strict";

  const VOL = 0.55;         // ganancia maestra
  const STRUM = 0.055;      // s entre notas del arpegio
  const DUR = 3.2;          // s de cola de cada voz

  /* acordes en semitonos sobre la raíz — todos en Do mayor */
  const CHORDS = [
    { rootHz: 261.63, iv: [0, 4, 7, 11] },   // Cmaj7
    { rootHz: 174.61, iv: [0, 4, 7, 11] },   // Fmaj7
    { rootHz: 196.00, iv: [0, 5, 7, 12] },   // Gsus4
    { rootHz: 293.66, iv: [0, 2, 7, 12] },   // Dsus2
    { rootHz: 220.00, iv: [0, 2, 7, 12] },   // Asus2
    { rootHz: 164.81, iv: [0, 5, 7, 12] }    // Esus4
  ];

  let ac = null, master = null, delaySend = null;
  let lastChord = -1;

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = VOL;
    // compresor suave al final: permite acordes generosos sin recorte
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
    return ac;
  }

  function note(a, freq, t, x01, i, amp) {
    amp = (amp || 1) * Math.max(0.06, 0.26 - i * 0.03);
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

  function strum(x01, y01) {
    const a = ensure(); if (!a) return;
    if (a.state === "suspended") a.resume();
    let ci;
    do { ci = Math.floor(Math.random() * CHORDS.length); }
    while (CHORDS.length > 1 && ci === lastChord);
    lastChord = ci;
    const ch = CHORDS[ci];
    const oct = y01 < 0.33 ? 2 : (y01 > 0.8 ? 0.5 : 1);
    const t0 = a.currentTime + 0.01;
    for (let i = 0; i < ch.iv.length; i++) {
      note(a, ch.rootHz * Math.pow(2, ch.iv[i] / 12) * oct, t0 + i * STRUM, x01, i);
    }
    // brillo final: raíz una octava arriba, muy queda
    note(a, ch.rootHz * 2 * oct, t0 + ch.iv.length * STRUM, x01, ch.iv.length, 0.4);
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
    strum(e.clientX / innerWidth, e.clientY / innerHeight);
  }

  function start() { addEventListener("pointerdown", onDown); }
  function stop() {
    removeEventListener("pointerdown", onDown);
    if (ac && ac.state === "running") ac.suspend();
  }

  window.PandoraSound = { start: start, stop: stop, splash: splash };
})();
