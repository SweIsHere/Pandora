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
   · Bajo los anillos flota un VELO etéreo (cáusticas de seno
     deformado, tipo aurora) animado en el mismo shader, y el
     composite final aplica un DITHERING ordenado (Bayer 4×4)
     ligero que da grano de grabado a los degradados.
   · Al ENTRAR al modo, una superficie de agua con oleaje sube
     desde abajo ("llenado del vaso" / inmersión): todo lo que
     queda bajo el menisco se enciende, lo demás espera.
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
    uniform float uTime;
    uniform float uFill;
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

      // llenado del vaso: superficie con oleaje que sube (uFill 0→1);
      // sd < 0 = sumergido. El oleaje se calma al terminar de llenar.
      float filling = step(0.0001, uFill) * (1.0 - step(0.999, uFill));
      float lvl = uFill * uRes.y * 1.18;
      float wob = sin(p.x * 0.016 + uTime * 2.4) * 9.0
                + sin(p.x * 0.043 - uTime * 1.6) * 5.0;
      float surfY = lvl + wob * (1.0 - 0.85 * uFill);
      float sd = p.y - surfY;
      float under = smoothstep(2.0, -14.0, sd);

      // velo etéreo: cáusticas de seno deformado (aurora lenta).
      // Cada iteración pliega el dominio y suma un filamento suave;
      // al elevar al cuadrado sólo sobreviven las vetas más claras.
      vec2 av = vUv; av.x *= uRes.x / max(uRes.y, 1.0);
      float tt = uTime * 0.10;
      vec2 aq = av * 2.8;
      float veil = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        aq += 0.45 * vec2(
          sin(aq.y * 1.60 + tt * (1.0 + fk * 0.40) + fk * 1.7),
          cos(aq.x * 1.35 - tt * (1.4 - fk * 0.25) + fk * 2.3));
        veil += 1.0 / (1.0 + 11.0 * abs(sin(aq.x + cos(aq.y + tt))));
      }
      veil *= 0.3333;
      vec3 veilTint = mix(uColor, vec3(0.16, 0.42, 0.62),
                          0.5 + 0.5 * sin(av.x * 1.3 + tt * 2.0));
      acc += veilTint * veil * veil * 0.55 * under;

      // volumen sumergido + claridad junto a la superficie
      acc += uColor * under * 0.035;
      acc += uColor * exp(-abs(sd) / 55.0) * under * 0.14;

      // menisco: línea con glow y espuma que chispea a lo largo
      float line = exp(-sd * sd / (2.0 * 3.0 * 3.0))
                 + 0.45 * exp(-sd * sd / (2.0 * 15.0 * 15.0));
      float foam = 0.6 + 0.4 * sin(p.x * 0.11 + uTime * 7.0)
                             * sin(p.x * 0.053 - uTime * 4.2);
      acc += mix(uColor, vec3(0.32, 0.58, 0.85), 0.45) * line * foam * 1.15 * filling;

      // burbujas que suben hacia la superficie mientras se llena
      for (int b = 0; b < 6; b++) {
        float fb = float(b);
        float bx = fract(sin((fb + 1.0) * 12.9898) * 43758.5453);
        float sp = 0.22 + 0.09 * fract(sin((fb + 1.0) * 78.233) * 12543.21);
        float prog = fract(uTime * sp + fb * 0.618);
        vec2 bp = vec2(bx * uRes.x + sin(uTime * 2.0 + fb * 2.1) * 9.0,
                       prog * max(surfY - 8.0, 0.0));
        float bd = length(p - bp);
        float br = 2.2 + 1.3 * fract(fb * 0.417);
        acc += uColor * exp(-bd * bd / (2.0 * br * br))
             * (0.5 + 0.5 * (1.0 - prog)) * filling * 1.1;
      }

      for (int i = 0; i < ${MAX_RINGS}; i++) {
        if (i >= uCount) break;
        vec3 rg = uRing[i];
        float d = abs(length(p - rg.xy) - rg.z);
        float core  = smoothstep(2.4, 0.0, d);
        float skirt = exp(-(d*d) / (2.0*24.0*24.0)) * 0.5;
        acc += uColor * (core + skirt) * uAlpha[i] * under;
      }
      float dc = length(p - uCursor.xy);
      float cGlow = exp(-(dc*dc) / (2.0*9.0*9.0));
      float cCore = smoothstep(3.0, 0.0, dc);
      acc += uColor * (cGlow * 1.1 + cCore) * uCursorA * under;
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
    // Bayer 2×2 compacto; anidándolo a media escala se obtiene la
    // matriz 4×4 sin tablas ni operadores de bits (GLSL ES 1.0).
    float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    void main() {
      vec3 s = texture2D(uSharp, vUv).rgb;
      vec3 b = texture2D(uBloom, vUv).rgb * uBloomStrength;
      vec3 c = 1.0 - (1.0 - s) * (1.0 - b);   // screen blend, evita recorte duro
      // dithering ordenado: cuantiza a pocos niveles con umbral Bayer 4×4
      // en celdas de 2px → los degradados del velo/bloom se deshacen en
      // grano de grabado bien visible
      float bay = bayer2(gl_FragCoord.xy * 0.25) * 0.25 + bayer2(gl_FragCoord.xy * 0.5);
      c = floor(c * 12.0 + bay) / 12.0;
      float a = clamp(max(max(c.r, c.g), c.b) * 1.35, 0.0, 1.0);
      gl_FragColor = vec4(c, a);
    }
  `;

  let renderer, quad, passScene, camera;
  let matRings, matBlurH, matBlurV, matComposite;
  let rtScene, rtBlurA, rtBlurB;
  let canvas, running = false, raf = 0;
  let w = 1, h = 1;
  let fillStart = 0;                 // inicio de la animación de llenado
  const FILL_MS = 2600;

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
      uTime: { value: 0 },
      uFill: { value: 0 },
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
    // El <canvas> es un elemento REEMPLAZADO: con width/height auto no se
    // estira a `inset:0`, conserva su tamaño intrínseco (300×150) y su
    // clientWidth miente. Medimos el viewport y dejamos que three fije el
    // estilo CSS (updateStyle = true) para que el canvas llene la pantalla.
    w = Math.max(1, innerWidth);
    h = Math.max(1, innerHeight);
    renderer.setSize(w, h, true);

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
    u.uTime.value = now * 0.001;
    const fp = Math.min(1, (now - fillStart) / FILL_MS);
    u.uFill.value = fp * fp * (3 - 2 * fp);   // smoothstep: arranca y remata suave
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
    fillStart = performance.now();   // cada entrada al modo re-llena el vaso
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
