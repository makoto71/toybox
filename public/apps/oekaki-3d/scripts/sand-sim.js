/**
 * GPUすな (落下する砂) シミュレーション
 *
 * すいさい (watercolor-sim) と同じピンポンRT構成で、砂を
 * UV空間の下方向 (-V) へ落として積もらせるセルオートマトン風のパス。
 *
 * レイヤー構成 (simSize x simSize の half-float RT):
 *   - sand : RGB = 色×量 (premultiplied)  A = 浮遊している砂の量
 *   - dep  : 同形式。定着した砂
 *
 * 砂のふるまい:
 *   - 下のセルに空きがあれば落ちる (紙目で落下速度が揺らぎ、筋になる)
 *   - 山が高くなると左右に崩れる (toppling)
 *   - 下が詰まっている・最下段に着いた砂から定着していく
 *   - 描き終わってしばらくすると定着を加速し、最後に焼き込み
 *
 * 表示はストローク中〜定着まで material.map をコンポジットRTへ差し替える。
 *
 * 注意: 重力は UV の -V 方向なので、モデルの UV 展開によっては世界座標の
 * 「下」とは一致しない (パネル絵としての割り切り。すいさいの流れと同じ)。
 */

import * as THREE from 'three';
import { makeSimTarget, makePingPong, makePaperTexture } from './watercolor-sim.js';

const SIM_SIZE = 512;
const SUBSTEPS = 2;
const MAX_STEP_DT = 1 / 30;
const BAKE_DELAY_MS = 8000;      // 最後のスタンプからこれだけ経ったら焼き込み
const SETTLE_BOOST_AFTER_MS = 2500; // 描き終わってからの急速定着の開始
const SAND_PER_SPLAT = 0.55;
// 粒ノイズの周波数 (UVあたりのセル数)。コンポジットRT/焼き込みRTは
// キャンバス解像度 (2048想定) なので、シム解像度より細かい粒を出せる
const GRAIN_FREQ_FINE = 2800;
const GRAIN_FREQ_COARSE = 1120;

let shared = null;

/** SceneManager から renderer を渡して初期化する。WebGL2 + float RT 非対応なら null。 */
export function initSandSim(renderer) {
    if (shared) return shared;
    try {
        shared = new SandSim(renderer);
    } catch (e) {
        console.warn('GPU sand sim unavailable, falling back to glitter stamps:', e);
        shared = null;
    }
    return shared;
}

export function getSandSim() {
    return shared;
}

/* ---------------- shaders ---------------- */

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

// 落下 + 山くずれを適用した後の砂と、定着率の計算。
// dep パスと sand パスの両方が「全く同じ flowed 値」を見ることで保存性を保つ
// (watercolor-sim の depositK と同じ構成)。
const SAND_FLOW_CHUNK = /* glsl */`
const float CAP = 1.0;

float flowDown(float fromA, float toA, float r) {
    return r * min(fromA, max(0.0, CAP - toA));
}
// 山くずれ: 高低差の一部を低い側へ。両セルが同じ式を評価するので保存的
float flowSide(float a, float b, float r) {
    return r * 0.5 * max(0.0, a - b - 0.06);
}

vec4 flowedSand(sampler2D sandTex, sampler2D paperTex, vec2 uv, float texel, float dt) {
    vec2 up = vec2(0.0, texel);
    vec2 rightV = vec2(texel, 0.0);
    vec4 self = texture2D(sandTex, uv);
    vec4 above = texture2D(sandTex, uv + up);
    vec4 below = texture2D(sandTex, uv - up);
    vec4 left = texture2D(sandTex, uv - rightV);
    vec4 right = texture2D(sandTex, uv + rightV);

    // 落下レートは「流出元セル」の紙目で揺らす (受け側も同じ式を評価できる)
    float paperSelf = texture2D(paperTex, uv * 7.0).r;
    float paperAbove = texture2D(paperTex, (uv + up) * 7.0).r;
    float rSelf = clamp(28.0 * dt, 0.0, 0.48) * (0.55 + 0.9 * paperSelf);
    float rAbove = clamp(28.0 * dt, 0.0, 0.48) * (0.55 + 0.9 * paperAbove);
    float rSide = min(0.15, 8.0 * dt);

    // 最下段は地面 (流出しない)。最上段は clamp の自己サンプルで湧かないように
    float atBottom = step(uv.y, texel);
    float atTop = step(1.0 - texel, uv.y);

    float outDown = (1.0 - atBottom) * flowDown(self.a, below.a, rSelf);
    float inDown = (1.0 - atTop) * flowDown(above.a, self.a, rAbove);
    float outL = flowSide(self.a, left.a, rSide);
    float outR = flowSide(self.a, right.a, rSide);
    float inL = flowSide(left.a, self.a, rSide);
    float inR = flowSide(right.a, self.a, rSide);

    float totalOut = outDown + outL + outR;
    float fracOut = totalOut / max(self.a, 1e-5);
    vec3 inRgb =
        above.rgb * (inDown / max(above.a, 1e-5)) +
        left.rgb  * (inL / max(left.a, 1e-5)) +
        right.rgb * (inR / max(right.a, 1e-5));

    float newA = self.a - totalOut + inDown + inL + inR;
    vec3 newRgb = self.rgb * (1.0 - fracOut) + inRgb;
    return vec4(max(newRgb, vec3(0.0)), max(newA, 0.0));
}

// 定着率: 下が詰まっている・最下段・紙目の凹部で定着。時間経過でブースト
float stickK(sampler2D sandTex, sampler2D paperTex, vec2 uv, float texel, float dt, float settleBoost) {
    vec4 below = texture2D(sandTex, uv - vec2(0.0, texel));
    float atBottom = step(uv.y, texel);
    float blocked = max(atBottom, smoothstep(0.5, 0.9, below.a));
    float paper = texture2D(paperTex, uv * 7.0).r;
    float rate = 0.12 + 2.5 * blocked + 0.5 * (1.0 - paper) + settleBoost;
    return 1.0 - exp(-rate * dt);
}
`;

// 砂のざらざら感: UV固定のハッシュノイズで粒ごとの明度むらと被覆のまばらさを作る。
// 時間に依存しないので明滅はせず、定着 (bake) 前後で見た目が変わらない。
const GRAIN_CHUNK = /* glsl */`
float hash21(vec2 p) {
    // 高周波セルで sin の引数が大きくなりすぎると fp32 精度で縞が出るため折り返す
    p = mod(p, 1024.0);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float sandGrain(vec2 uv) {
    float g1 = hash21(floor(uv * ${GRAIN_FREQ_FINE.toFixed(1)}));
    float g2 = hash21(floor(uv * ${GRAIN_FREQ_COARSE.toFixed(1)}) + 7.3);
    return mix(g1, g2, 0.5);
}
// col/cover を粒感つきに変換する (composite と bake で共通)
vec4 grained(vec3 col, float cover, vec2 uv) {
    float g = sandGrain(uv);
    vec3 c = col * (0.78 + 0.44 * g);            // 粒ごとの明暗
    float cv = min(cover * (0.6 + 0.8 * g), 1.0); // 薄いところは粒がまばらに
    return vec4(c, cv);
}
`;

const SAND_STEP_FRAG = /* glsl */`
uniform sampler2D sandTex;
uniform sampler2D paperTex;
uniform float dt;
uniform float texel;
uniform float settleBoost;
varying vec2 vUv;
${SAND_FLOW_CHUNK}
void main() {
    vec4 s = flowedSand(sandTex, paperTex, vUv, texel, dt);
    float k = stickK(sandTex, paperTex, vUv, texel, dt, settleBoost);
    s *= (1.0 - k);
    // 微量の砂は消す (いつまでも残ってちらつかないように)
    if (s.a < 0.0008) s = vec4(0.0);
    gl_FragColor = s;
}
`;

const DEPOSIT_FRAG = /* glsl */`
uniform sampler2D sandTex;
uniform sampler2D depTex;
uniform sampler2D paperTex;
uniform float dt;
uniform float texel;
uniform float settleBoost;
varying vec2 vUv;
${SAND_FLOW_CHUNK}
void main() {
    vec4 dep = texture2D(depTex, vUv);
    vec4 s = flowedSand(sandTex, paperTex, vUv, texel, dt);
    float k = stickK(sandTex, paperTex, vUv, texel, dt, settleBoost);
    gl_FragColor = min(dep + s * k, vec4(6.0));
}
`;

const SPLAT_FRAG = /* glsl */`
uniform sampler2D sandTex;
uniform vec2 center;
uniform float radius;
uniform vec3 color;
uniform float amt;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(sandTex, vUv);
    float d = distance(vUv, center);
    float g = exp(-d * d / (radius * radius * 0.5));
    float add = amt * g;
    c.a = min(c.a + add, 1.6);
    c.rgb += color * add;
    gl_FragColor = c;
}
`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D baseTex;
uniform sampler2D sandTex;
uniform sampler2D depTex;
varying vec2 vUv;
${GRAIN_CHUNK}
void main() {
    // baseTex は sRGB テクスチャなのでサンプル時に自動でリニア化される
    vec3 base = texture2D(baseTex, vUv).rgb;
    vec4 tot = texture2D(sandTex, vUv) + texture2D(depTex, vUv);
    float amount = tot.a;
    vec3 col = tot.rgb / max(amount, 1e-4);
    float cover = smoothstep(0.01, 0.30, amount);
    vec4 g = grained(col, cover, vUv);
    gl_FragColor = vec4(mix(base, g.rgb, g.a), 1.0);
}
`;

// 焼き込み用: 砂の色+被覆率を straight-alpha で出力 (source-over で base に乗せる)。
// canvas の上下と UV の上下が逆なので V を反転して読む。
const BAKE_FRAG = /* glsl */`
uniform sampler2D sandTex;
uniform sampler2D depTex;
varying vec2 vUv;
${GRAIN_CHUNK}
void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 tot = texture2D(sandTex, uv) + texture2D(depTex, uv);
    float amount = tot.a;
    vec3 col = tot.rgb / max(amount, 1e-4);
    float cover = smoothstep(0.01, 0.30, amount);
    vec4 g = grained(col, cover, uv);
    gl_FragColor = vec4(pow(g.rgb, vec3(1.0 / 2.2)), g.a);
}
`;

const COPY_FRAG = /* glsl */`
uniform sampler2D srcTex;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(srcTex, vUv);
}
`;

function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/* ---------------- sim ---------------- */

export class SandSim {
    constructor(renderer, simSize = SIM_SIZE) {
        const gl = renderer.getContext();
        if (!renderer.capabilities.isWebGL2 || !gl.getExtension('EXT_color_buffer_float')) {
            throw new Error('WebGL2 + EXT_color_buffer_float required');
        }
        this.renderer = renderer;
        this.simSize = simSize;

        this.sand = makePingPong(simSize);
        this.dep = makePingPong(simSize);
        // cancelStroke 用のバックアップ
        this.sandBak = makeSimTarget(simSize);
        this.depBak = makeSimTarget(simSize);

        /** テクスチャ解像度ごとのコンポジットRTキャッシュ */
        this._compositeRTs = new Map();
        /**
         * 焼き込み用リソース (RT/読み出しバッファ/中継キャンバス) のサイズ別キャッシュ。
         * シム解像度ではなくキャンバス解像度で焼き込むことで、定着時に粒が潰れない。
         */
        this._bakeResources = new Map();

        this.paperTex = makePaperTexture();

        this._scene = new THREE.Scene();
        this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this._scene.add(this._mesh);

        const texel = 1 / simSize;
        const mat = (frag, uniforms) => new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: frag,
            uniforms,
            depthTest: false,
            depthWrite: false,
        });
        this._stepMat = mat(SAND_STEP_FRAG, {
            sandTex: { value: null },
            paperTex: { value: this.paperTex },
            dt: { value: 0 },
            texel: { value: texel },
            settleBoost: { value: 0 },
        });
        this._depMat = mat(DEPOSIT_FRAG, {
            sandTex: { value: null },
            depTex: { value: null },
            paperTex: { value: this.paperTex },
            dt: { value: 0 },
            texel: { value: texel },
            settleBoost: { value: 0 },
        });
        this._splatMat = mat(SPLAT_FRAG, {
            sandTex: { value: null },
            center: { value: new THREE.Vector2() },
            radius: { value: 0.05 },
            color: { value: new THREE.Vector3() },
            amt: { value: SAND_PER_SPLAT },
        });
        this._compositeMat = mat(COMPOSITE_FRAG, {
            baseTex: { value: null },
            sandTex: { value: null },
            depTex: { value: null },
        });
        this._bakeMat = mat(BAKE_FRAG, {
            sandTex: { value: null },
            depTex: { value: null },
        });
        this._copyMat = mat(COPY_FRAG, { srcTex: { value: null } });

        /** @type {object|null} PaintableModel の surface */
        this._surface = null;
        this._compRT = null;
        this._materialSwapped = false;
        this._hasSand = false;
        this._snapHasSand = false;
        this._lastSplatTime = 0;

        this._clearSim();
    }

    get attachedSurface() {
        return this._surface;
    }

    get isWet() {
        return this._hasSand;
    }

    /* ---------- render plumbing ---------- */

    _pass(material, target) {
        this._mesh.material = material;
        const prevTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(target);
        this.renderer.render(this._scene, this._camera);
        this.renderer.setRenderTarget(prevTarget);
    }

    _copy(srcRT, dstRT) {
        this._copyMat.uniforms.srcTex.value = srcRT.texture;
        this._pass(this._copyMat, dstRT);
    }

    _clearTarget(rt) {
        const prevTarget = this.renderer.getRenderTarget();
        const prevColor = new THREE.Color();
        this.renderer.getClearColor(prevColor);
        const prevAlpha = this.renderer.getClearAlpha();
        this.renderer.setRenderTarget(rt);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear(true, false, false);
        this.renderer.setClearColor(prevColor, prevAlpha);
        this.renderer.setRenderTarget(prevTarget);
    }

    _clearSim() {
        for (const pp of [this.sand, this.dep]) {
            this._clearTarget(pp.read);
            this._clearTarget(pp.write);
        }
        this._hasSand = false;
    }

    _getBakeResources(size) {
        let r = this._bakeResources.get(size);
        if (!r) {
            const rt = new THREE.WebGLRenderTarget(size, size, {
                type: THREE.UnsignedByteType,
                format: THREE.RGBAFormat,
                depthBuffer: false,
            });
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            r = {
                rt,
                pixels: new Uint8Array(size * size * 4),
                canvas,
                ctx: canvas.getContext('2d'),
            };
            this._bakeResources.set(size, r);
        }
        return r;
    }

    _getCompositeRT(size) {
        let rt = this._compositeRTs.get(size);
        if (!rt) {
            rt = new THREE.WebGLRenderTarget(size, size, {
                type: THREE.HalfFloatType,
                format: THREE.RGBAFormat,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: false,
            });
            rt.texture.anisotropy = 16;
            this._compositeRTs.set(size, rt);
        }
        return rt;
    }

    _renderComposite() {
        if (!this._surface || !this._compRT) return;
        const u = this._compositeMat.uniforms;
        u.baseTex.value = this._surface.texture;
        u.sandTex.value = this.sand.read.texture;
        u.depTex.value = this.dep.read.texture;
        this._pass(this._compositeMat, this._compRT);
    }

    _swapMaterialIn() {
        if (this._materialSwapped || !this._surface) return;
        const m = this._surface.material;
        m.map = this._compRT.texture;
        m.emissiveMap = this._compRT.texture;
        m.needsUpdate = true;
        this._materialSwapped = true;
    }

    _restoreMaterial() {
        if (!this._materialSwapped || !this._surface) return;
        const m = this._surface.material;
        m.map = this._surface.texture;
        m.emissiveMap = this._surface.texture;
        m.needsUpdate = true;
        this._materialSwapped = false;
    }

    /* ---------- public API ---------- */

    /**
     * 描画先サーフェスを切り替える。別サーフェスに砂が残っていたら
     * 先に焼き込んでから移る (すいさいと同じ割り切り)。
     */
    attachSurface(surface) {
        if (this._surface === surface) return;
        if (this._surface) this.bakeNow();
        this._surface = surface;
        this._compRT = this._getCompositeRT(surface.baseCanvas.width);
        this._clearSim();
        this._renderComposite();
    }

    /**
     * 砂を1点 (または前回位置からの線分に沿って) 振りかける。
     * @param {{x:number,y:number}} uv        現在位置 (UV, y上向き)
     * @param {{x:number,y:number}|null} prevUv
     * @param {number} radiusUv               ブラシ半径 (UV単位)
     * @param {number[]} rgb255               ブラシ色 (sRGB 0-255)
     */
    splat(uv, prevUv, radiusUv, rgb255) {
        if (!this._surface) return;
        this._swapMaterialIn();

        const lin = rgb255.map((c) => srgbToLinear(Math.max(0, Math.min(255, c)) / 255));

        let dist = 0;
        if (prevUv) dist = Math.hypot(uv.x - prevUv.x, uv.y - prevUv.y);
        const spacing = Math.max(radiusUv * 0.6, 1e-4);
        const count = prevUv ? Math.min(10, Math.max(1, Math.ceil(dist / spacing))) : 1;

        for (let i = 1; i <= count; i++) {
            const t = i / count;
            const cx = prevUv ? prevUv.x + (uv.x - prevUv.x) * t : uv.x;
            const cy = prevUv ? prevUv.y + (uv.y - prevUv.y) * t : uv.y;

            const u = this._splatMat.uniforms;
            u.sandTex.value = this.sand.read.texture;
            u.center.value.set(cx, cy);
            u.radius.value = radiusUv;
            u.color.value.set(lin[0], lin[1], lin[2]);
            u.amt.value = SAND_PER_SPLAT / count;
            this._pass(this._splatMat, this.sand.write);
            this.sand.swap();
        }

        this._hasSand = true;
        this._lastSplatTime = performance.now();
        this._renderComposite();
    }

    /** ストローク開始時のスナップショット (2本指ジェスチャでのキャンセル用) */
    snapshot() {
        if (!this._surface) return;
        this._copy(this.sand.read, this.sandBak);
        this._copy(this.dep.read, this.depBak);
        this._snapHasSand = this._hasSand;
    }

    /** snapshot 時点へ巻き戻す */
    restore() {
        if (!this._surface) return;
        this._copy(this.sandBak, this.sand.read);
        this._copy(this.depBak, this.dep.read);
        this._hasSand = this._snapHasSand;
        if (!this._hasSand) {
            this._restoreMaterial();
        } else {
            this._renderComposite();
        }
    }

    /** 毎フレーム呼ぶ。砂が残っている間だけシミュレーションを進める。 */
    update(dt) {
        if (!this._surface || !this._hasSand) return;

        const since = performance.now() - this._lastSplatTime;
        // 描き終わってしばらくしたら定着を加速 (いつまでも流れていないように)
        const settleBoost = since > SETTLE_BOOST_AFTER_MS
            ? Math.min(7, (since - SETTLE_BOOST_AFTER_MS) / 800)
            : 0;

        const stepDt = Math.min(dt || 1 / 60, MAX_STEP_DT) / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) {
            // dep が先 (両パスが同じ sand.read から同一の flowed 値を計算する)
            const du = this._depMat.uniforms;
            du.sandTex.value = this.sand.read.texture;
            du.depTex.value = this.dep.read.texture;
            du.dt.value = stepDt;
            du.settleBoost.value = settleBoost;
            this._pass(this._depMat, this.dep.write);
            this.dep.swap();

            const su = this._stepMat.uniforms;
            su.sandTex.value = this.sand.read.texture;
            su.dt.value = stepDt;
            su.settleBoost.value = settleBoost;
            this._pass(this._stepMat, this.sand.write);
            this.sand.swap();
        }

        this._renderComposite();

        if (since > BAKE_DELAY_MS) this.bakeNow();
    }

    /**
     * 砂 (浮遊+定着) を base キャンバスへ source-over で焼き込み、
     * CanvasTexture 表示に戻す。
     */
    bakeNow() {
        const surface = this._surface;
        if (!surface) return;
        if (this._hasSand) {
            const s = surface.baseCanvas.width;
            const bake = this._getBakeResources(s);

            const bu = this._bakeMat.uniforms;
            bu.sandTex.value = this.sand.read.texture;
            bu.depTex.value = this.dep.read.texture;
            this._pass(this._bakeMat, bake.rt);

            this.renderer.readRenderTargetPixels(bake.rt, 0, 0, s, s, bake.pixels);
            const img = new ImageData(new Uint8ClampedArray(bake.pixels), s, s);
            bake.ctx.putImageData(img, 0, 0);

            const bctx = surface.baseCtx;
            bctx.drawImage(bake.canvas, 0, 0, surface.baseCanvas.width, surface.baseCanvas.height);

            // display を再合成 (PaintableModel.refreshDisplay 相当)
            const dctx = surface.displayCtx;
            const w = surface.displayCanvas.width;
            const h = surface.displayCanvas.height;
            dctx.clearRect(0, 0, w, h);
            dctx.drawImage(surface.baseCanvas, 0, 0);
            if (surface.hasStroke) {
                dctx.globalAlpha = surface.strokeOpacity;
                dctx.globalCompositeOperation = surface.strokeBlend ?? 'source-over';
                dctx.drawImage(surface.strokeCanvas, 0, 0);
                dctx.globalCompositeOperation = 'source-over';
                dctx.globalAlpha = 1.0;
            }
            surface.texture.needsUpdate = true;
        }
        this._clearSim();
        this._restoreMaterial();
    }

    /** 砂を捨ててサーフェスから離れる (モデル切替・まっしろにもどす用) */
    discardWet() {
        if (!this._surface) return;
        this._restoreMaterial();
        this._clearSim();
        this._surface = null;
        this._compRT = null;
    }
}
