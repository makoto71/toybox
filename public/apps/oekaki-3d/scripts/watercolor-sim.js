/**
 * GPU水彩シミュレーション (WebGL2 / three.js)
 *
 * Curtis et al. "Computer-Generated Watercolor" (1997) を簡略化した
 * フラグメントシェーダーのピンポンレンダリングで、UV空間上の絵の具を流体的に動かす。
 *
 * レイヤー構成 (すべて simSize x simSize の half-float RT):
 *   - flow   : R,G = 水の速度(uv/s)  B = 水量(高さ)
 *   - pig    : RGB = 浮遊顔料の吸光度 (水と一緒に流れる)
 *   - dep    : RGB = 沈着顔料の吸光度 (乾いて定着した分)
 *
 * 顔料を「色」ではなく「吸光度 (absorbance)」で持つのがポイント:
 *   表示は透過率 T = exp(-A) を下地に乗算する (Beer-Lambert)。
 *   吸光度は加算で混ざるため、青+黄→緑 のような減法混色が自然に起こる。
 *   ただし生の吸光度は1層でも濃い (鮮やかな色で透過率3%) ので、表示時に
 *   色相を保ったままソフト圧縮し、赤+青がすぐ黒に潰れず紫として見えるようにする。
 *
 * 水彩らしさの要素:
 *   - 水は高低差で流れ、紙の凹凸でゆらぐ (にじみ・指状の広がり)
 *   - 濡れた領域からしか水が広がらない毛細管しきい値 (くっきりした輪郭)
 *   - 乾くほど・水際ほど顔料が定着 (エッジの濃いフチ = edge darkening)
 *   - 紙目で定着量が揺らぐ (グラニュレーション)
 *
 * 描画面との統合:
 *   ストローク中〜乾くまでは material.map をコンポジットRT (base × exp(-A)) に
 *   差し替えてライブ表示し、乾いたら base キャンバスへ multiply で焼き込んで
 *   CanvasTexture に戻す。focus する surface は常に1つ (シングルトン)。
 */

import * as THREE from 'three';

const SIM_SIZE = 512;
const SUBSTEPS = 2;
const MAX_STEP_DT = 1 / 30;
const BAKE_DELAY_MS = 9000;   // 最後のスタンプからこれだけ経ったら焼き込み
const DRY_BOOST_AFTER_MS = 2500; // 描き終わってからの急速乾燥の開始
const WATER_PER_SPLAT = 0.38;
const PIGMENT_PER_SPLAT = 0.5;
const MAX_ABSORBANCE = 3.5;
// 表示時の吸光度ソフト上限。1層分 (≲MAX_ABSORBANCE) はほぼ素通しで、
// 塗り重ねるほど色相を保ったまま漸近的にこの濃さへ飽和する。
const ABSORBANCE_SOFT_CAP = 3.4;

let shared = null;

/** SceneManager から renderer を渡して初期化する。WebGL2 + float RT 非対応なら null。 */
export function initWatercolorSim(renderer) {
    if (shared) return shared;
    try {
        shared = new WatercolorSim(renderer);
    } catch (e) {
        console.warn('GPU watercolor sim unavailable, falling back to 2D brush:', e);
        shared = null;
    }
    return shared;
}

export function getWatercolorSim() {
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

// 吸光度の色相保存圧縮: 最大チャンネルが ABSORBANCE_SOFT_CAP に漸近するよう
// RGB を同率で縮める。1層分はほぼそのまま、赤+青の重なりは黒でなく
// 明るさの残る紫になり、大量に塗り重ねるとゆっくり黒へ近づく。
const COMPRESS_CHUNK = /* glsl */`
vec3 compressAbsorbance(vec3 A) {
    float m = max(A.r, max(A.g, A.b)) / ${ABSORBANCE_SOFT_CAP.toFixed(1)};
    float m2 = m * m;
    float m8 = m2 * m2 * m2 * m2;
    return A / pow(1.0 + m8, 0.125);
}
`;

// 沈着率: 乾くほど・水際(水量勾配が大きい)ほど・紙目の凸部ほど定着する
const DEPOSIT_CHUNK = /* glsl */`
float depositK(float h, float edge, float paper, float dt) {
    float rate = 0.55 + 3.5 * smoothstep(0.10, 0.0, h) + 12.0 * edge;
    rate *= 0.55 + 0.9 * paper;
    float k = 1.0 - exp(-rate * dt);
    return max(k, step(h, 0.0008)); // 水が無くなったら即全定着
}
`;

const FLOW_FRAG = /* glsl */`
uniform sampler2D flowTex;
uniform sampler2D paperTex;
uniform float dt;
uniform float texel;
uniform float evapBoost;
varying vec2 vUv;

void main() {
    vec4 self = texture2D(flowTex, vUv);
    // セミラグランジュ移流 (速度と水量を上流から運ぶ)
    vec2 pos = vUv - self.xy * dt;
    vec4 adv = texture2D(flowTex, pos);
    vec2 vel = adv.xy;
    float h = adv.z;

    float hl = texture2D(flowTex, vUv - vec2(texel, 0.0)).z;
    float hr = texture2D(flowTex, vUv + vec2(texel, 0.0)).z;
    float hb = texture2D(flowTex, vUv - vec2(0.0, texel)).z;
    float ht = texture2D(flowTex, vUv + vec2(0.0, texel)).z;
    float paper = texture2D(paperTex, vUv * 6.0).r;

    // 水たまりの高低差で流れる
    vec2 grad = vec2(hr - hl, ht - hb) * 0.5;
    vel += -grad * 0.5 * dt / texel * 0.01;

    // 紙の凹凸によるゆらぎ (にじみの不規則な指状の広がり)
    float n1 = texture2D(paperTex, vUv * 9.0 + 0.13).r - 0.5;
    float n2 = texture2D(paperTex, vUv * 9.0 + 0.57).r - 0.5;
    vel += vec2(n1, n2) * 0.5 * dt * step(0.003, h);

    // 粘性抵抗
    vel *= exp(-3.0 * dt);

    // 拡散: 十分濡れた隣からしか流れ込まない (毛細管しきい値 → 輪郭がくっきり残る)
    float hmax = max(max(hl, hr), max(hb, ht));
    float avg = (hl + hr + hb + ht) * 0.25;
    float gate = max(step(0.02, h), smoothstep(0.15, 0.30, hmax));
    h += (avg - h) * min(1.0, 1.2 * dt) * gate;

    // 蒸発 + 紙への吸収 (紙目の凸部は早く乾く)
    float evap = (0.07 + 0.06 * paper) * (1.0 + evapBoost);
    h = max(h - evap * dt, 0.0);

    vel *= step(0.001, h);
    gl_FragColor = vec4(vel, h, 1.0);
}
`;

const DEPOSIT_FRAG = /* glsl */`
uniform sampler2D depTex;
uniform sampler2D pigTex;
uniform sampler2D flowTex;
uniform sampler2D paperTex;
uniform float dt;
uniform float texel;
varying vec2 vUv;
${DEPOSIT_CHUNK}
void main() {
    vec3 dep = texture2D(depTex, vUv).rgb;
    vec4 flow = texture2D(flowTex, vUv);
    // pigStep と同じ移流計算で「この位置に届く顔料」を求める
    vec2 pos = vUv - flow.xy * dt;
    vec3 pig = texture2D(pigTex, pos).rgb;

    float hl = texture2D(flowTex, vUv - vec2(texel, 0.0)).z;
    float hr = texture2D(flowTex, vUv + vec2(texel, 0.0)).z;
    float hb = texture2D(flowTex, vUv - vec2(0.0, texel)).z;
    float ht = texture2D(flowTex, vUv + vec2(0.0, texel)).z;
    float edge = length(vec2(hr - hl, ht - hb)) * 0.5;
    float paper = texture2D(paperTex, vUv * 6.0).r;

    float k = depositK(flow.z, edge, paper, dt);
    gl_FragColor = vec4(dep + pig * k, 1.0);
}
`;

const PIGMENT_FRAG = /* glsl */`
uniform sampler2D pigTex;
uniform sampler2D flowTex;
uniform sampler2D paperTex;
uniform float dt;
uniform float texel;
varying vec2 vUv;
${DEPOSIT_CHUNK}
void main() {
    vec4 flow = texture2D(flowTex, vUv);
    vec2 pos = vUv - flow.xy * dt;
    vec3 pig = texture2D(pigTex, pos).rgb;

    float hl = texture2D(flowTex, vUv - vec2(texel, 0.0)).z;
    float hr = texture2D(flowTex, vUv + vec2(texel, 0.0)).z;
    float hb = texture2D(flowTex, vUv - vec2(0.0, texel)).z;
    float ht = texture2D(flowTex, vUv + vec2(0.0, texel)).z;
    float edge = length(vec2(hr - hl, ht - hb)) * 0.5;
    float paper = texture2D(paperTex, vUv * 6.0).r;

    // 沈着した分を引く (deposit パスと同じ k)
    float k = depositK(flow.z, edge, paper, dt);
    pig -= pig * k;

    // 濡れているところは浮遊顔料がわずかに拡散
    vec3 pl = texture2D(pigTex, pos - vec2(texel, 0.0)).rgb;
    vec3 pr = texture2D(pigTex, pos + vec2(texel, 0.0)).rgb;
    vec3 pb = texture2D(pigTex, pos - vec2(0.0, texel)).rgb;
    vec3 pt = texture2D(pigTex, pos + vec2(0.0, texel)).rgb;
    vec3 pavg = (pl + pr + pb + pt) * 0.25;
    pig = mix(pig, pavg, min(1.0, 0.8 * dt) * step(0.003, flow.z));

    gl_FragColor = vec4(max(pig, vec3(0.0)), 1.0);
}
`;

const SPLAT_FLOW_FRAG = /* glsl */`
uniform sampler2D flowTex;
uniform vec2 center;
uniform vec2 impulse;
uniform float radius;
uniform float waterAmt;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(flowTex, vUv);
    float d = distance(vUv, center);
    float g = exp(-d * d / (radius * radius * 0.5));
    c.z = min(c.z + waterAmt * g, 1.2);
    c.xy += impulse * g;
    gl_FragColor = c;
}
`;

const SPLAT_PIG_FRAG = /* glsl */`
uniform sampler2D pigTex;
uniform vec2 center;
uniform float radius;
uniform vec3 absorbance;
uniform float pigAmt;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(pigTex, vUv);
    float d = distance(vUv, center);
    float g = exp(-d * d / (radius * radius * 0.5));
    // クランプを低くすると重ね塗りで色相の比率が潰れて灰色化するため余裕を持たせる
    c.rgb = min(c.rgb + absorbance * (pigAmt * g), vec3(${MAX_ABSORBANCE.toFixed(1)} * 5.0));
    gl_FragColor = c;
}
`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D baseTex;
uniform sampler2D pigTex;
uniform sampler2D depTex;
uniform sampler2D flowTex;
varying vec2 vUv;
${COMPRESS_CHUNK}
void main() {
    // baseTex は sRGB テクスチャなのでサンプル時に自動でリニア化される
    vec3 base = texture2D(baseTex, vUv).rgb;
    vec3 A = compressAbsorbance(texture2D(depTex, vUv).rgb + texture2D(pigTex, vUv).rgb);
    vec3 T = exp(-A);
    float h = texture2D(flowTex, vUv).z;
    // 濡れているところはわずかに暗く (湿り気の表現)
    vec3 col = base * T * (1.0 - 0.10 * smoothstep(0.0, 0.5, h));
    gl_FragColor = vec4(col, 1.0);
}
`;

// 焼き込み用: 透過率を sRGB 近似 (gamma 2.2) にエンコードして出力。
// canvas 2D の multiply は sRGB 空間の乗算だが、純粋なべき乗ガンマでは
// (ab)^(1/g) = a^(1/g) b^(1/g) なので、リニア乗算とほぼ同じ見た目になる。
// canvas の上下と UV の上下が逆なので V を反転して読む。
const BAKE_FRAG = /* glsl */`
uniform sampler2D pigTex;
uniform sampler2D depTex;
varying vec2 vUv;
${COMPRESS_CHUNK}
void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec3 A = compressAbsorbance(texture2D(depTex, uv).rgb + texture2D(pigTex, uv).rgb);
    vec3 T = exp(-A);
    gl_FragColor = vec4(pow(T, vec3(1.0 / 2.2)), 1.0);
}
`;

const COPY_FRAG = /* glsl */`
uniform sampler2D srcTex;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(srcTex, vUv);
}
`;

/* ---------------- helpers ---------------- */

export function makeSimTarget(size) {
    return new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
    });
}

export function makePingPong(size) {
    return {
        read: makeSimTarget(size),
        write: makeSimTarget(size),
        swap() {
            const t = this.read;
            this.read = this.write;
            this.write = t;
        },
    };
}

/** 値ノイズを重ねた紙テクスチャ (R: 紙目の高さ 0-1) */
export function makePaperTexture() {
    const size = 256;
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    const octaves = [
        { res: 16, alpha: 0.45 },  // 大きな紙のうねり
        { res: 64, alpha: 0.30 },  // 繊維っぽいむら
        { res: 256, alpha: 0.18 }, // 細かい粒
    ];
    for (const { res, alpha } of octaves) {
        const t = document.createElement('canvas');
        t.width = t.height = res;
        const tctx = t.getContext('2d');
        const img = tctx.createImageData(res, res);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.floor(Math.random() * 256);
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
        tctx.putImageData(img, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.drawImage(t, 0, 0, size, size);
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(out);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
}

function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** ブラシ色 (sRGB 0-255) → 吸光度 RGB。鮮やかな色ほど補色チャンネルの吸光度が高い。 */
function absorbanceFromRgb(rgb) {
    return rgb.map((c) => {
        const lin = srgbToLinear(Math.max(0, Math.min(255, c)) / 255);
        return Math.min(MAX_ABSORBANCE, -Math.log(Math.max(lin, 0.02)));
    });
}

/* ---------------- sim ---------------- */

export class WatercolorSim {
    constructor(renderer, simSize = SIM_SIZE) {
        const gl = renderer.getContext();
        if (!renderer.capabilities.isWebGL2 || !gl.getExtension('EXT_color_buffer_float')) {
            throw new Error('WebGL2 + EXT_color_buffer_float required');
        }
        this.renderer = renderer;
        this.simSize = simSize;

        this.flow = makePingPong(simSize);
        this.pig = makePingPong(simSize);
        this.dep = makePingPong(simSize);
        // cancelStroke 用のバックアップ
        this.flowBak = makeSimTarget(simSize);
        this.pigBak = makeSimTarget(simSize);
        this.depBak = makeSimTarget(simSize);

        this.bakeRT = new THREE.WebGLRenderTarget(simSize, simSize, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
        });
        this._bakePixels = new Uint8Array(simSize * simSize * 4);
        this._bakeCanvas = document.createElement('canvas');
        this._bakeCanvas.width = this._bakeCanvas.height = simSize;
        this._bakeCtx = this._bakeCanvas.getContext('2d');

        /** テクスチャ解像度ごとのコンポジットRTキャッシュ */
        this._compositeRTs = new Map();

        this.paperTex = makePaperTexture();

        // フルスクリーンパス用シーン
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
        this._flowMat = mat(FLOW_FRAG, {
            flowTex: { value: null },
            paperTex: { value: this.paperTex },
            dt: { value: 0 },
            texel: { value: texel },
            evapBoost: { value: 0 },
        });
        this._depMat = mat(DEPOSIT_FRAG, {
            depTex: { value: null },
            pigTex: { value: null },
            flowTex: { value: null },
            paperTex: { value: this.paperTex },
            dt: { value: 0 },
            texel: { value: texel },
        });
        this._pigMat = mat(PIGMENT_FRAG, {
            pigTex: { value: null },
            flowTex: { value: null },
            paperTex: { value: this.paperTex },
            dt: { value: 0 },
            texel: { value: texel },
        });
        this._splatFlowMat = mat(SPLAT_FLOW_FRAG, {
            flowTex: { value: null },
            center: { value: new THREE.Vector2() },
            impulse: { value: new THREE.Vector2() },
            radius: { value: 0.05 },
            waterAmt: { value: WATER_PER_SPLAT },
        });
        this._splatPigMat = mat(SPLAT_PIG_FRAG, {
            pigTex: { value: null },
            center: { value: new THREE.Vector2() },
            radius: { value: 0.05 },
            absorbance: { value: new THREE.Vector3() },
            pigAmt: { value: PIGMENT_PER_SPLAT },
        });
        this._compositeMat = mat(COMPOSITE_FRAG, {
            baseTex: { value: null },
            pigTex: { value: null },
            depTex: { value: null },
            flowTex: { value: null },
        });
        this._bakeMat = mat(BAKE_FRAG, {
            pigTex: { value: null },
            depTex: { value: null },
        });
        this._copyMat = mat(COPY_FRAG, { srcTex: { value: null } });

        /** @type {object|null} PaintableModel の surface */
        this._surface = null;
        this._compRT = null;
        this._materialSwapped = false;
        this._hasWet = false;
        this._snapWet = false;
        this._lastSplatTime = 0;

        this._clearSim();
    }

    get attachedSurface() {
        return this._surface;
    }

    get isWet() {
        return this._hasWet;
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
        for (const pp of [this.flow, this.pig, this.dep]) {
            this._clearTarget(pp.read);
            this._clearTarget(pp.write);
        }
        this._hasWet = false;
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
        u.pigTex.value = this.pig.read.texture;
        u.depTex.value = this.dep.read.texture;
        u.flowTex.value = this.flow.read.texture;
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
     * 描画先サーフェスを切り替える。別サーフェスに濡れた絵の具が残っていたら
     * 先に焼き込んでから移る (パネルをまたいだ瞬間にそちらは乾く、という割り切り)。
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
     * 絵の具を1点 (または前回位置からの線分に沿って) 落とす。
     * @param {{x:number,y:number}} uv        現在位置 (UV, y上向き)
     * @param {{x:number,y:number}|null} prevUv
     * @param {number} radiusUv               ブラシ半径 (UV単位)
     * @param {number[]} rgb255               ブラシ色 (sRGB 0-255)
     */
    splat(uv, prevUv, radiusUv, rgb255) {
        if (!this._surface) return;
        this._swapMaterialIn();

        const lum = rgb255[0] * 0.299 + rgb255[1] * 0.587 + rgb255[2] * 0.114;
        const waterOnly = lum > 235; // ほぼ白 = 顔料なしの「みずふで」
        const abs = waterOnly ? [0, 0, 0] : absorbanceFromRgb(rgb255);

        // 速度インパルス: ストローク方向に水を押す
        const impulse = new THREE.Vector2(0, 0);
        let dist = 0;
        if (prevUv) {
            impulse.set(uv.x - prevUv.x, uv.y - prevUv.y);
            dist = impulse.length();
            if (dist > 0) impulse.multiplyScalar(Math.min(0.25, dist * 6) / dist);
        }

        // 速いストロークで点が飛ばないよう、線分に沿ってサブスタンプ
        const spacing = Math.max(radiusUv * 0.6, 1e-4);
        const count = prevUv ? Math.min(10, Math.max(1, Math.ceil(dist / spacing))) : 1;

        for (let i = 1; i <= count; i++) {
            const t = i / count;
            const cx = prevUv ? prevUv.x + (uv.x - prevUv.x) * t : uv.x;
            const cy = prevUv ? prevUv.y + (uv.y - prevUv.y) * t : uv.y;

            const fu = this._splatFlowMat.uniforms;
            fu.flowTex.value = this.flow.read.texture;
            fu.center.value.set(cx, cy);
            fu.impulse.value.copy(impulse);
            fu.radius.value = radiusUv;
            fu.waterAmt.value = WATER_PER_SPLAT / count;
            this._pass(this._splatFlowMat, this.flow.write);
            this.flow.swap();

            if (!waterOnly) {
                const pu = this._splatPigMat.uniforms;
                pu.pigTex.value = this.pig.read.texture;
                pu.center.value.set(cx, cy);
                pu.radius.value = radiusUv;
                pu.absorbance.value.set(abs[0], abs[1], abs[2]);
                pu.pigAmt.value = PIGMENT_PER_SPLAT / count;
                this._pass(this._splatPigMat, this.pig.write);
                this.pig.swap();
            }
        }

        this._hasWet = true;
        this._lastSplatTime = performance.now();
        this._renderComposite();
    }

    /** ストローク開始時のスナップショット (2本指ジェスチャでのキャンセル用) */
    snapshot() {
        if (!this._surface) return;
        this._copy(this.flow.read, this.flowBak);
        this._copy(this.pig.read, this.pigBak);
        this._copy(this.dep.read, this.depBak);
        this._snapWet = this._hasWet;
    }

    /** snapshot 時点へ巻き戻す */
    restore() {
        if (!this._surface) return;
        this._copy(this.flowBak, this.flow.read);
        this._copy(this.pigBak, this.pig.read);
        this._copy(this.depBak, this.dep.read);
        this._hasWet = this._snapWet;
        if (!this._hasWet) {
            this._restoreMaterial();
        } else {
            this._renderComposite();
        }
    }

    /** 毎フレーム呼ぶ。濡れている間だけシミュレーションを進める。 */
    update(dt) {
        if (!this._surface || !this._hasWet) return;

        const since = performance.now() - this._lastSplatTime;
        // 描き終わってしばらくしたら乾燥を加速 (いつまでも濡れていないように)
        const evapBoost = since > DRY_BOOST_AFTER_MS
            ? Math.min(6, (since - DRY_BOOST_AFTER_MS) / 1000)
            : 0;

        const stepDt = Math.min(dt || 1 / 60, MAX_STEP_DT) / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) {
            const fu = this._flowMat.uniforms;
            fu.flowTex.value = this.flow.read.texture;
            fu.dt.value = stepDt;
            fu.evapBoost.value = evapBoost;
            this._pass(this._flowMat, this.flow.write);
            this.flow.swap();

            const du = this._depMat.uniforms;
            du.depTex.value = this.dep.read.texture;
            du.pigTex.value = this.pig.read.texture;
            du.flowTex.value = this.flow.read.texture;
            du.dt.value = stepDt;
            this._pass(this._depMat, this.dep.write);
            this.dep.swap();

            const pu = this._pigMat.uniforms;
            pu.pigTex.value = this.pig.read.texture;
            pu.flowTex.value = this.flow.read.texture;
            pu.dt.value = stepDt;
            this._pass(this._pigMat, this.pig.write);
            this.pig.swap();
        }

        this._renderComposite();

        if (since > BAKE_DELAY_MS) this.bakeNow();
    }

    /**
     * 濡れた絵の具を base キャンバスに焼き込み、CanvasTexture 表示に戻す。
     * 透過率 (exp(-A) を sRGB 化したもの) を multiply で乗せるので、
     * 下地のペン画などの解像度を損なわない。
     */
    bakeNow() {
        const surface = this._surface;
        if (!surface) return;
        if (this._hasWet) {
            const bu = this._bakeMat.uniforms;
            bu.pigTex.value = this.pig.read.texture;
            bu.depTex.value = this.dep.read.texture;
            this._pass(this._bakeMat, this.bakeRT);

            const s = this.simSize;
            this.renderer.readRenderTargetPixels(this.bakeRT, 0, 0, s, s, this._bakePixels);
            const img = new ImageData(new Uint8ClampedArray(this._bakePixels), s, s);
            this._bakeCtx.putImageData(img, 0, 0);

            const bctx = surface.baseCtx;
            bctx.globalCompositeOperation = 'multiply';
            bctx.drawImage(this._bakeCanvas, 0, 0, surface.baseCanvas.width, surface.baseCanvas.height);
            bctx.globalCompositeOperation = 'source-over';

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

    /** 濡れた絵の具を捨ててサーフェスから離れる (モデル切替・まっしろにもどす用) */
    discardWet() {
        if (!this._surface) return;
        this._restoreMaterial();
        this._clearSim();
        this._surface = null;
        this._compRT = null;
    }
}
