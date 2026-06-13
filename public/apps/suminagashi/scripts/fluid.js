// すみながし — WebGL stable-fluids core
// 墨流し用の流体ソルバー。染料は MacCormack 移流でエッジを鋭く保つ。

export function createFluid(canvas) {
  const SIM_RES = 192;
  const PRESSURE_ITERATIONS = 24;
  const VELOCITY_DISSIPATION = 1.2; // 水面が静けさに戻る速さ。低いと渦が巻き、高いと余韻が消える
  const DYE_SHARPEN = 1.0; // にじみで薄まったアルファを戻す強さ (1/秒)。強いと細い筋が千切れる
  const DYE_SHARPEN_GATE = 0.08; // 引き締めを流速でゲート。流速*この値=1.0 で全開、止まると0
  const PRINT_SS = 2; // かみに写すときのスーパーサンプリング倍率 (高解像度で描いて縮小=AA)

  const { gl, ext } = getWebGLContext(canvas);

  // ---------- shaders ----------

  const baseVertex = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const advectionFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 uTexelSize;
    uniform float uDt;
    uniform float uDissipation;
    void main () {
      vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
      vec4 result = texture2D(uSource, coord);
      float decay = 1.0 + uDissipation * uDt;
      gl_FragColor = result / decay;
    }
  `;

  // MacCormack の補正パス。前進・後退の移流結果から二次精度の値を作り、
  // 元フィールドの近傍 4 テクセルでクランプしてリンギングを防ぐ。
  const maccormackFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform sampler2D uForward;
    uniform sampler2D uBack;
    uniform vec2 uTexelSize;
    uniform vec2 uDyeTexelSize;
    uniform float uDt;
    void main () {
      vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
      vec4 fwd = texture2D(uForward, vUv);
      vec4 result = fwd + 0.5 * (texture2D(uSource, vUv) - texture2D(uBack, vUv));
      vec2 st = coord / uDyeTexelSize - 0.5;
      vec2 base = (floor(st) + 0.5) * uDyeTexelSize;
      vec4 d0 = texture2D(uSource, base);
      vec4 d1 = texture2D(uSource, base + vec2(uDyeTexelSize.x, 0.0));
      vec4 d2 = texture2D(uSource, base + vec2(0.0, uDyeTexelSize.y));
      vec4 d3 = texture2D(uSource, base + uDyeTexelSize);
      vec4 mn = min(min(d0, d1), min(d2, d3));
      vec4 mx = max(max(d0, d1), max(d2, d3));
      gl_FragColor = clamp(result, mn, mx);
    }
  `;

  // 移流のにじみ (数値拡散) で薄まったアルファを点ごとに引き締める。
  // ロジスティック曲線で「濃い側は1へ、薄い側は0へ」ゆっくり寄せるだけなので、
  // 近傍参照によるノイズ増幅やギザつきが原理的に起きない。
  // rgb はプリマルチプライ済みなので、色味を保つよう同率でスケールする。
  //
  // 引き締めは流速でゲートする: にじみは水が動いているときだけ生じるので、
  // 流れのある所だけ研ぐ。止まった水面では効かず、縁はその時点の柔らかさで
  // 固定される (放置で縁が段差に潰れてジャギーになるのを防ぐ)。
  const sharpenFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform sampler2D uVelocity;
    uniform float uAmount;
    uniform float uVelGate;
    void main () {
      vec4 c = texture2D(uTexture, vUv);
      float a = clamp(c.a, 0.0, 1.0);
      float gate = clamp(length(texture2D(uVelocity, vUv).xy) * uVelGate, 0.0, 1.0);
      float amt = uAmount * gate;
      float a2 = clamp(a + amt * 4.0 * a * (1.0 - a) * (a - 0.5), 0.0, 1.0);
      float s = a > 1e-4 ? a2 / a : 0.0;
      gl_FragColor = vec4(c.rgb * s, a2);
    }
  `;

  const divergenceFrag = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    void main () {
      vec2 vL = vUv - vec2(uTexelSize.x, 0.0);
      vec2 vR = vUv + vec2(uTexelSize.x, 0.0);
      vec2 vB = vUv - vec2(0.0, uTexelSize.y);
      vec2 vT = vUv + vec2(0.0, uTexelSize.y);
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float B = texture2D(uVelocity, vB).y;
      float T = texture2D(uVelocity, vT).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vB.y < 0.0) { B = -C.y; }
      if (vT.y > 1.0) { T = -C.y; }
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }
  `;

  const clearFrag = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float uValue;
    void main () {
      gl_FragColor = uValue * texture2D(uTexture, vUv);
    }
  `;

  const pressureFrag = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 uTexelSize;
    void main () {
      float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      float divergence = texture2D(uDivergence, vUv).x;
      gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
    }
  `;

  const gradientSubtractFrag = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    void main () {
      float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const splatVelocityFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float uAspect;
    uniform vec2 uPoint;
    uniform vec2 uDelta;
    uniform float uRadius;
    void main () {
      vec2 p = vUv - uPoint;
      p.x *= uAspect;
      vec2 splat = exp(-dot(p, p) / uRadius) * uDelta;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xy + splat, 0.0, 1.0);
    }
  `;

  const splatRadialFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float uAspect;
    uniform vec2 uPoint;
    uniform float uStrength;
    uniform float uRadius;
    void main () {
      vec2 p = vUv - uPoint;
      p.x *= uAspect;
      float g = exp(-dot(p, p) / uRadius);
      vec2 dir = p / max(length(p), 1e-4);
      gl_FragColor = vec4(texture2D(uTarget, vUv).xy + dir * uStrength * g, 0.0, 1.0);
    }
  `;

  // 伝統的マーブリングのしずく変換: 既存の模様を |P'|^2 = |P|^2 + r^2 で外側へ
  // 押し出し、中心に新しいインクを置く。面積保存なので輪が正確に再現される。
  const dropFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float uAspect;
    uniform vec2 uPoint;
    uniform vec4 uColor;
    uniform float uRadius;
    uniform float uEdge;
    void main () {
      vec2 p = vUv - uPoint;
      p.x *= uAspect;
      float d = length(p);
      float r = uRadius;
      float srcD = sqrt(max(d * d - r * r, 0.0));
      vec2 dir = p / max(d, 1e-6);
      vec2 srcP = dir * srcD;
      srcP.x /= uAspect;
      vec4 displaced = texture2D(uTarget, uPoint + srcP);
      float m = 1.0 - smoothstep(r - uEdge, r + uEdge, d);
      gl_FragColor = mix(displaced, uColor, m);
    }
  `;

  // 染料スタンプは加算ではなく上書き。透明(α0)の円で墨をくり抜けるように。
  const splatDyeFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float uAspect;
    uniform vec2 uPoint;
    uniform vec4 uColor;
    uniform float uRadius;
    uniform float uEdge;
    void main () {
      vec2 p = vUv - uPoint;
      p.x *= uAspect;
      float d = length(p);
      float m = 1.0 - smoothstep(uRadius - uEdge, uRadius, d);
      gl_FragColor = mix(texture2D(uTarget, vUv), uColor, m);
    }
  `;

  const displayFrag = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uDye;
    uniform sampler2D uVelocity;
    uniform float uPaper;
    uniform float uAspect;

    float hash (vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float vnoise (vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    void main () {
      vec2 uv = vUv;
      // 和紙の繊維。横長と縦長のノイズを重ねる。
      // 最終1280px幅でも周期が4px以上になるよう高周波成分を抑える
      // (700→320。これより高いと縮小時にモアレ=メッシュ模様が出る)
      float fiber = vnoise(uv * vec2(220.0, 36.0)) * 0.5
                  + vnoise(uv * vec2(36.0, 220.0)) * 0.3
                  + vnoise(uv * 320.0) * 0.2;
      vec2 duv = (vec2(vnoise(uv * 160.0), vnoise(uv * 160.0 + 7.31)) - 0.5) * 0.0022 * uPaper;
      vec4 dye = texture2D(uDye, uv + duv);
      float a = clamp(dye.a, 0.0, 1.0);
      vec3 ink = dye.rgb / max(a, 1e-3);
      // 移流の再サンプリングでにじんだ縁を締める (灰色のもや対策)
      a = smoothstep(0.06, 0.82, a);

      vec2 vel = texture2D(uVelocity, uv).xy;
      float sheen = clamp(length(vel) * 0.012, 0.0, 1.0);
      vec3 water = mix(vec3(0.918, 0.929, 0.925), vec3(0.862, 0.886, 0.886), uv.y * 0.8 + 0.1);
      water += sheen * 0.055;
      vec3 paper = vec3(0.956, 0.933, 0.879) * (0.93 + 0.09 * fiber);
      vec3 bg = mix(water, paper, uPaper);

      // 紙に写すと粒状感(にじみ)がのる。周期4px以上に保ちモアレを防ぐ (480→300)
      float grain = mix(1.0, 0.88 + 0.2 * vnoise(uv * 300.0), uPaper);
      float aa = clamp(a * grain, 0.0, 1.0);
      vec3 inkOnBg = mix(ink, ink * (0.9 + 0.1 * fiber), uPaper);
      vec3 col = mix(bg, inkOnBg, aa);

      vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
      float d = length(q) / max(uAspect, 1.0);
      col *= 1.0 - (0.16 + 0.12 * uPaper) * smoothstep(0.35, 0.85, d);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ---------- GL plumbing ----------

  function getWebGLContext (canvas) {
    const attrs = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    let gl = canvas.getContext('webgl2', attrs);
    const isWebGL2 = !!gl;
    if (!isWebGL2) {
      gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    }
    if (!gl) throw new Error('WebGL not supported');

    let halfFloatTexType;
    let supportLinearFiltering;
    if (isWebGL2) {
      gl.getExtension('EXT_color_buffer_float');
      supportLinearFiltering = true;
      halfFloatTexType = gl.HALF_FLOAT;
    } else {
      const halfFloat = gl.getExtension('OES_texture_half_float');
      supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear');
      halfFloatTexType = halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
    }

    // 染料FBOの初期値が「α=1の黒インク」にならないよう α も 0 でクリアする
    gl.clearColor(0, 0, 0, 0);

    const formatRGBA = isWebGL2
      ? getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType)
      : getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    const formatRG = isWebGL2
      ? getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType)
      : formatRGBA;
    const formatR = isWebGL2
      ? getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType)
      : formatRGBA;

    return {
      gl,
      ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering, isWebGL2 }
    };
  }

  function getSupportedFormat (gl, internalFormat, format, type) {
    if (supportRenderTextureFormat(gl, internalFormat, format, type)) {
      return { internalFormat, format };
    }
    if (internalFormat === gl.R16F) return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
    if (internalFormat === gl.RG16F) return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
    return null;
  }

  function supportRenderTextureFormat (gl, internalFormat, format, type) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return ok;
  }

  function compileShader (type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function createProgram (fragSource) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, baseVertex));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms, bind () { gl.useProgram(program); } };
  }

  const blit = (() => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const elemBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    return (target) => {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  })();

  function createFBO (w, h, internalFormat, format, type, filter) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture, fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }

  function createDoubleFBO (w, h, internalFormat, format, type, filter) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, filter);
    let fbo2 = createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      get read () { return fbo1; },
      get write () { return fbo2; },
      swap () { const t = fbo1; fbo1 = fbo2; fbo2 = t; }
    };
  }

  function getResolution (resolution) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const max = Math.round(resolution * aspect);
    const min = Math.round(resolution);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  // ---------- programs & buffers ----------

  const advectionProgram = createProgram(advectionFrag);
  const maccormackProgram = createProgram(maccormackFrag);
  const sharpenProgram = createProgram(sharpenFrag);
  const divergenceProgram = createProgram(divergenceFrag);
  const clearProgram = createProgram(clearFrag);
  const pressureProgram = createProgram(pressureFrag);
  const gradientProgram = createProgram(gradientSubtractFrag);
  const splatVelProgram = createProgram(splatVelocityFrag);
  const splatRadialProgram = createProgram(splatRadialFrag);
  const splatDyeProgram = createProgram(splatDyeFrag);
  const dropProgram = createProgram(dropFrag);
  const displayProgram = createProgram(displayFrag);

  const filter = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
  let velocity, pressure, divergence, dye, dyeTmpA, dyeTmpB, printFBO, printOut;
  let currentDyeRes = 0;

  // 染料解像度は描画バッファの実寸から決める (構築時に viewport が 0 でも壊れないように)
  function desiredDyeRes () {
    return Math.max(256, Math.min(1280, Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight)));
  }

  function initFramebuffers () {
    currentDyeRes = desiredDyeRes();
    const simRes = getResolution(SIM_RES);
    const dyeRes = getResolution(currentDyeRes);
    velocity = createDoubleFBO(simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, ext.halfFloatTexType, filter);
    pressure = createDoubleFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, ext.halfFloatTexType, gl.NEAREST);
    divergence = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, ext.halfFloatTexType, gl.NEAREST);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, filter);
    dyeTmpA = createFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, filter);
    dyeTmpB = createFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, filter);
    // 印刷FBOは dye 解像度の PRINT_SS 倍で描き、2D canvas 側で等倍に縮小して
    // アンチエイリアスする。テクスチャ上限を超えないよう実効倍率をクランプ。
    printOut = { width: dyeRes.width, height: dyeRes.height };
    const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 4096);
    const longDye = Math.max(dyeRes.width, dyeRes.height);
    const ss = Math.max(1, Math.min(PRINT_SS, maxTex / longDye));
    printFBO = createFBO(
      Math.round(dyeRes.width * ss), Math.round(dyeRes.height * ss),
      ext.isWebGL2 ? gl.RGBA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR
    );
  }
  initFramebuffers();

  function aspect () {
    return canvas.width / canvas.height;
  }

  // ---------- public API ----------

  function step (dt) {
    gl.disable(gl.BLEND);

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(advectionProgram.uniforms.uDt, dt);
    gl.uniform1f(advectionProgram.uniforms.uDissipation, VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.uValue, 0.8);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gradientProgram.bind();
    gl.uniform2f(gradientProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    // 染料: 前進移流 → 後退移流 → MacCormack 補正
    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.uDt, dt);
    gl.uniform1f(advectionProgram.uniforms.uDissipation, 0.0);
    blit(dyeTmpA);

    gl.uniform1i(advectionProgram.uniforms.uSource, dyeTmpA.attach(1));
    gl.uniform1f(advectionProgram.uniforms.uDt, -dt);
    blit(dyeTmpB);

    maccormackProgram.bind();
    gl.uniform2f(maccormackProgram.uniforms.uTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(maccormackProgram.uniforms.uDyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1f(maccormackProgram.uniforms.uDt, dt);
    gl.uniform1i(maccormackProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(maccormackProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1i(maccormackProgram.uniforms.uForward, dyeTmpA.attach(2));
    gl.uniform1i(maccormackProgram.uniforms.uBack, dyeTmpB.attach(3));
    blit(dye.write);
    dye.swap();

    // 引き締め: にじんで薄まったアルファを戻す → 模様が白く痩せない。
    // 流速ゲート付きなので、止まった水面では効かず縁が劣化しない
    sharpenProgram.bind();
    gl.uniform1i(sharpenProgram.uniforms.uTexture, dye.read.attach(0));
    gl.uniform1i(sharpenProgram.uniforms.uVelocity, velocity.read.attach(1));
    gl.uniform1f(sharpenProgram.uniforms.uAmount, Math.min(DYE_SHARPEN * dt, 0.35));
    gl.uniform1f(sharpenProgram.uniforms.uVelGate, DYE_SHARPEN_GATE);
    blit(dye.write);
    dye.swap();
  }

  function splatVelocity (x, y, dx, dy, radius) {
    splatVelProgram.bind();
    gl.uniform1i(splatVelProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatVelProgram.uniforms.uAspect, aspect());
    gl.uniform2f(splatVelProgram.uniforms.uPoint, x, y);
    gl.uniform2f(splatVelProgram.uniforms.uDelta, dx, dy);
    gl.uniform1f(splatVelProgram.uniforms.uRadius, radius);
    blit(velocity.write);
    velocity.swap();
  }

  function splatRadial (x, y, strength, radius) {
    splatRadialProgram.bind();
    gl.uniform1i(splatRadialProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatRadialProgram.uniforms.uAspect, aspect());
    gl.uniform2f(splatRadialProgram.uniforms.uPoint, x, y);
    gl.uniform1f(splatRadialProgram.uniforms.uStrength, strength);
    gl.uniform1f(splatRadialProgram.uniforms.uRadius, radius);
    blit(velocity.write);
    velocity.swap();
  }

  // color: {r,g,b,a} straight。内部ではプリマルチプライで保存する
  function splatDye (x, y, color, radius) {
    splatDyeProgram.bind();
    gl.uniform1i(splatDyeProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform1f(splatDyeProgram.uniforms.uAspect, aspect());
    gl.uniform2f(splatDyeProgram.uniforms.uPoint, x, y);
    gl.uniform4f(splatDyeProgram.uniforms.uColor, color.r * color.a, color.g * color.a, color.b * color.a, color.a);
    gl.uniform1f(splatDyeProgram.uniforms.uRadius, radius);
    gl.uniform1f(splatDyeProgram.uniforms.uEdge, 1.5 * dye.texelSizeY);
    blit(dye.write);
    dye.swap();
  }

  // マーブリングのしずく: 既存模様を押し広げて中心に color を置く
  function splatDrop (x, y, radius, color) {
    dropProgram.bind();
    gl.uniform1i(dropProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform1f(dropProgram.uniforms.uAspect, aspect());
    gl.uniform2f(dropProgram.uniforms.uPoint, x, y);
    gl.uniform4f(dropProgram.uniforms.uColor, color.r * color.a, color.g * color.a, color.b * color.a, color.a);
    gl.uniform1f(dropProgram.uniforms.uRadius, radius);
    gl.uniform1f(dropProgram.uniforms.uEdge, 1.2 * dye.texelSizeY);
    blit(dye.write);
    dye.swap();
  }

  function render () {
    displayProgram.bind();
    gl.uniform1i(displayProgram.uniforms.uDye, dye.read.attach(0));
    gl.uniform1i(displayProgram.uniforms.uVelocity, velocity.read.attach(1));
    gl.uniform1f(displayProgram.uniforms.uPaper, 0.0);
    gl.uniform1f(displayProgram.uniforms.uAspect, aspect());
    blit(null);
  }

  // 和紙モードで FBO に描き、ピクセルを読み出して 2D canvas として返す
  function renderPrint () {
    displayProgram.bind();
    gl.uniform1i(displayProgram.uniforms.uDye, dye.read.attach(0));
    gl.uniform1i(displayProgram.uniforms.uVelocity, velocity.read.attach(1));
    gl.uniform1f(displayProgram.uniforms.uPaper, 1.0);
    gl.uniform1f(displayProgram.uniforms.uAspect, printFBO.width / printFBO.height);
    blit(printFBO);

    const w = printFBO.width;
    const h = printFBO.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, printFBO.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // スーパーサンプル画像を一旦そのまま 2D canvas へ (Y反転)
    const ss = document.createElement('canvas');
    ss.width = w;
    ss.height = h;
    const ssCtx = ss.getContext('2d');
    const img = ssCtx.createImageData(w, h);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      img.data.set(pixels.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
    }
    ssCtx.putImageData(img, 0, 0);

    // 等倍へ高品質縮小 → エッジと和紙グレインがアンチエイリアスされる
    if (w === printOut.width && h === printOut.height) return ss;
    const out = document.createElement('canvas');
    out.width = printOut.width;
    out.height = printOut.height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ss, 0, 0, w, h, 0, 0, out.width, out.height);
    return out;
  }

  function reset () {
    [velocity.read, velocity.write, pressure.read, pressure.write, dye.read, dye.write].forEach((fbo) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, fbo.width, fbo.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
  }

  function resize () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (w <= 0 || h <= 0) return false;
    if (canvas.width === w && canvas.height === h) return false;
    const oldAspect = canvas.width / canvas.height;
    canvas.width = w;
    canvas.height = h;
    const aspectChanged = !Number.isFinite(oldAspect) || Math.abs(oldAspect / (w / h) - 1) > 0.05;
    const resChanged = Math.abs(desiredDyeRes() / currentDyeRes - 1) > 0.2;
    if (aspectChanged || resChanged) initFramebuffers();
    return true;
  }
  resize();

  return { step, splatVelocity, splatRadial, splatDye, splatDrop, render, renderPrint, reset, resize };
}
