/* ============================================================
   PANDORA — pointer-rings.js
   ------------------------------------------------------------
   Efecto de puntero "anillos expansivos" replicado con three.js
   y shaders (motor WebGL independiente del de los atractores).
   ------------------------------------------------------------
   · Cada anillo se dibuja como una franja fina en un shader de
     pantalla completa; el color es ADITIVO, así que donde dos
     anillos se cruzan la luz se SUMA sola → el punto de cruce
     brilla más que el resto del trazo, sin dibujar ninguna
     "estrellita" a mano.
   · Ese resultado (con zonas sobre-expuestas en los cruces) se
     pasa por un bloom real de 2 pasadas (blur horizontal +
     vertical, downsample) y se compone en pantalla → el brillo
     de los cruces "sangra" hacia fuera como un flare óptico.
   · Todo en tinta azul (nunca blanco), sobre un escenario oscuro
     para que el bloom tenga contraste.
   Expone window.PandoraRings = { start, stop, resize }.
   No comparte contexto con el renderer de sketch.js.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;

  const MAX_RINGS = 24;
  const LIFE = 1250;                 // ms de vida de un anillo
  const COLOR = [0.14, 0.25, 0.79];  // azul tinta (≈ #243ec4) en aditivo
  const RES = 0.75;                  // escala del pase nítido vs CSS px
  const BLUR_RES = 0.5;              // escala de los pases de blur (downsample)

  const QUAD_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const RINGS_FRAG = `
    precision highp float;
    uniform vec2  uRes;
    uniform vec3  uColor;
    uniform vec3  uRing[${MAX_RINGS}];   // x, y (px), radius (px)
    uniform float uAlpha[${MAX_RINGS}];
    uniform int   uCount;
    uniform vec3  uCursor;               // x, y, radius
    uniform float uCursorA;
    varying vec2  vUv;
    void main() {
      vec2 p = vUv * uRes;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < ${MAX_RINGS}; i++) {
        if (i >= uCount) break;
        vec3 rg = uRing[i];
        float d = abs(length(p - rg.xy) - rg.z);
        float core  = smoothstep(2.4, 0.0, d);
        float skirt = exp(-(d*d) / (2.0*18.0*18.0)) * 0.55;
        acc += uColor * (core + skirt) * uAlpha[i];
      }
      float dc = length(p - uCursor.xy);
      float cGlow = exp(-(dc*dc) / (2.0*9.0*9.0));
      float cCore = smoothstep(3.0, 0.0, dc);
      acc += uColor * (cGlow * 1.1 + cCore) * uCursorA;
      gl_FragColor = vec4(acc, 1.0);
    }
  `;

  const BLUR_FRAG = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uDir;      // paso de texel * dirección (1,0) u (0,1)
    varying vec2 vUv;
    void main() {
      vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
      vec2 o1 = uDir * 1.3846153846;
      vec2 o2 = uDir * 3.2307692308;
      sum += texture2D(uTex, vUv + o1).rgb * 0.3162162162;
      sum += texture2D(uTex, vUv - o1).rgb * 0.3162162162;
      sum += texture2D(uTex, vUv + o2).rgb * 0.0702702703;
      sum += texture2D(uTex, vUv - o2).rgb * 0.0702702703;
      gl_FragColor = vec4(sum, 1.0);
    }
  `;

  const COMPOSITE_FRAG = `
    precision highp float;
    uniform sampler2D uSharp;
    uniform sampler2D uBloom;
    uniform float uBloomStrength;
    varying vec2 vUv;
    void main() {
      vec3 s = texture2D(uSharp, vUv).rgb;
      vec3 b = texture2D(uBloom, vUv).rgb * uBloomStrength;
      vec3 c = 1.0 - (1.0 - s) * (1.0 - b);   // screen blend, evita recorte duro
      float a = clamp(max(max(c.r, c.g), c.b) * 1.35, 0.0, 1.0);
      gl_FragColor = vec4(c, a);
    }
  `;

  let renderer, quad, passScene, camera;
  let matRings, matBlurH, matBlurV, matComposite;
  let rtScene, rtBlurA, rtBlurB;
  let canvas, running = false, raf = 0;
  let w = 1, h = 1;

  const rings = [];
  const pointer = { x: 0, y: 0, seen: false };
  let lastSpawn = 0, lastX = 0, lastY = 0;

  function makeTarget(rw, rh) {
    return new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false
    });
  }

  function init(cv) {
    canvas = cv;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);
    quad = new THREE.Mesh(geo, null);
    passScene = new THREE.Scene();
    passScene.add(quad);

    const ringUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Vector3(COLOR[0], COLOR[1], COLOR[2]) },
      uRing: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector3()) },
      uAlpha: { value: new Float32Array(MAX_RINGS) },
      uCount: { value: 0 },
      uCursor: { value: new THREE.Vector3(-999, -999, 9) },
      uCursorA: { value: 0 }
    };
    matRings = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: RINGS_FRAG, uniforms: ringUniforms, depthTest: false, depthWrite: false });

    matBlurH = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } }, depthTest: false, depthWrite: false });
    matBlurV = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2(0, 1) } }, depthTest: false, depthWrite: false });

    matComposite = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: { uSharp: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 1.35 } },
      transparent: true, depthTest: false, depthWrite: false
    });

    rtScene = makeTarget(2, 2);
    rtBlurA = makeTarget(2, 2);
    rtBlurB = makeTarget(2, 2);
  }

  function resize() {
    if (!renderer) return;
    w = Math.max(1, canvas.clientWidth || innerWidth);
    h = Math.max(1, canvas.clientHeight || innerHeight);
    renderer.setSize(w, h, false);

    const sw = Math.max(1, Math.round(w * RES)),  sh = Math.max(1, Math.round(h * RES));
    const bw = Math.max(1, Math.round(w * BLUR_RES)), bh = Math.max(1, Math.round(h * BLUR_RES));
    rtScene.setSize(sw, sh);
    rtBlurA.setSize(bw, bh);
    rtBlurB.setSize(bw, bh);
    matRings.uniforms.uRes.value.set(sw, sh);
    matBlurH.uniforms.uDir.value.set(1 / bw, 0);
    matBlurV.uniforms.uDir.value.set(0, 1 / bh);
  }

  function spawn(x, y, r0, amp) {
    if (rings.length >= MAX_RINGS) rings.shift();
    rings.push({ x, y, r0, born: performance.now(), amp: amp || 1 });
  }

  function onMove(e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true;
    const now = performance.now();
    const moved = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    if (now - lastSpawn > 70 && moved > 14) {
      spawn(e.clientX, e.clientY, 70 + Math.random() * 90, 1);
      lastSpawn = now; lastX = e.clientX; lastY = e.clientY;
    }
  }
  function onDown(e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true;
    spawn(e.clientX, e.clientY, 230 + Math.random() * 120, 1.5);
    spawn(e.clientX, e.clientY, 120 + Math.random() * 60, 1);
  }
  function onLeave() { pointer.seen = false; }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function renderPass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(passScene, camera);
  }

  function frame() {
    if (!running) return;
    const now = performance.now();
    const u = matRings.uniforms;
    const ringArr = u.uRing.value, alphaArr = u.uAlpha.value;
    let n = 0;
    for (let i = rings.length - 1; i >= 0; i--) {
      const o = rings[i];
      const p = (now - o.born) / LIFE;
      if (p >= 1) { rings.splice(i, 1); continue; }
      const r = easeOut(p) * o.r0 * RES;
      const a = (1 - p) * (1 - p) * o.amp;
      if (n < MAX_RINGS) {
        ringArr[n].set(o.x * RES, (h - o.y) * RES, r);
        alphaArr[n] = a;
        n++;
      }
    }
    u.uCount.value = n;
    u.uCursor.value.set(pointer.x * RES, (h - pointer.y) * RES, 5 * RES);
    u.uCursorA.value = pointer.seen ? 0.85 : 0;

    renderPass(matRings, rtScene);

    matBlurH.uniforms.uTex.value = rtScene.texture;
    renderPass(matBlurH, rtBlurA);
    matBlurV.uniforms.uTex.value = rtBlurA.texture;
    renderPass(matBlurV, rtBlurB);

    matComposite.uniforms.uSharp.value = rtScene.texture;
    matComposite.uniforms.uBloom.value = rtBlurB.texture;
    renderPass(matComposite, null);

    raf = requestAnimationFrame(frame);
  }

  function start(cv) {
    if (!THREE) return;
    if (!renderer) init(cv);
    resize();
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown);
    addEventListener("pointerleave", onLeave);
    addEventListener("resize", resize);
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onDown);
    removeEventListener("pointerleave", onLeave);
    removeEventListener("resize", resize);
    rings.length = 0;
    if (renderer) {
      renderer.setRenderTarget(null);
      renderer.clear();
    }
  }

  window.PandoraRings = { start, stop, resize };
})();
