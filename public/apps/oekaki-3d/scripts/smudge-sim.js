/**
 * GPUゆびのばし (スマッジ) シミュレーション
 *
 * サーフェスの見た目 (display テクスチャ) をピンポンRTへ取り込み、
 * 指の移動方向へピクセルを引きずるワープパス (リキファイの push と同方式) を
 * ストロークに沿って繰り返すことで、絵の具を指でこすってのばした表現にする。
 * バイリニア補間で繰り返しリサンプルされるため、こすった部分が
 * 自然に柔らかくぼけていくのもスマッジらしさとして効く。
 *
 * - RT は sRGB エンコードのまま保持する 8bit RGBA。ワープは値の移動だけ
 *   なのでリニア化は不要で、表示用コンポジットでのみリニアへ戻す。
 * - ストローク中は material.map をコンポジットRTに差し替えてライブ表示し、
 *   endStroke で汚れた矩形だけを baseCanvas に書き戻して CanvasTexture 表示へ復帰。
 * - 乾き待ちの概念はなく、ストローク終了 = 即焼き込み。
 */

import * as THREE from 'three';

const SIM_SIZE = 1024;
const PUSH_STRENGTH = 0.9;  // 移動量のうちピクセルを引きずる割合
const MAX_PUSH_UV = 0.035;  // 1サブスタンプあたりの最大引きずり量 (uv)

let shared = null;

/** SceneManager から renderer を渡して初期化する。WebGL2 非対応なら null。 */
export function initSmudgeSim(renderer) {
    if (shared) return shared;
    try {
        shared = new SmudgeSim(renderer);
    } catch (e) {
        console.warn('GPU smudge sim unavailable, falling back to 2D smear:', e);
        shared = null;
    }
    return shared;
}

export function getSmudgeSim() {
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

// display テクスチャ (sRGB → サンプル時リニア化) を gamma 2.2 で再エンコードして取り込む
const SEED_FRAG = /* glsl */`
uniform sampler2D srcTex;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(srcTex, vUv).rgb;
    gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}
`;

// ブラシ中心からのガウス減衰で、移動方向の上流からピクセルを持ってくる (push warp)
const SMUDGE_FRAG = /* glsl */`
uniform sampler2D colorTex;
uniform vec2 center;
uniform vec2 delta;
uniform float radius;
varying vec2 vUv;
void main() {
    float d = distance(vUv, center);
    float g = exp(-d * d / (radius * radius * 0.5));
    vec2 src = vUv - delta * g;
    gl_FragColor = texture2D(colorTex, src);
}
`;

// 表示用: gamma 値をリニアへ戻して half-float コンポジットRTへ
const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D colorTex;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(colorTex, vUv).rgb;
    gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
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

function makeByteTarget(size) {
    return new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
    });
}

/* ---------------- sim ---------------- */

export class SmudgeSim {
    constructor(renderer, simSize = SIM_SIZE) {
        if (!renderer.capabilities.isWebGL2) {
            throw new Error('WebGL2 required');
        }
        this.renderer = renderer;
        this.simSize = simSize;

        this.color = {
            read: makeByteTarget(simSize),
            write: makeByteTarget(simSize),
            swap() {
                const t = this.read;
                this.read = this.write;
                this.write = t;
            },
        };
        // cancelStroke 用のバックアップ
        this.colorBak = makeByteTarget(simSize);

        this._bakeCanvas = document.createElement('canvas');
        this._bakeCtx = this._bakeCanvas.getContext('2d');

        /** テクスチャ解像度ごとのコンポジットRTキャッシュ */
        this._compositeRTs = new Map();

        this._scene = new THREE.Scene();
        this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this._scene.add(this._mesh);

        const mat = (frag, uniforms) => new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: frag,
            uniforms,
            depthTest: false,
            depthWrite: false,
        });
        this._seedMat = mat(SEED_FRAG, { srcTex: { value: null } });
        this._smudgeMat = mat(SMUDGE_FRAG, {
            colorTex: { value: null },
            center: { value: new THREE.Vector2() },
            delta: { value: new THREE.Vector2() },
            radius: { value: 0.05 },
        });
        this._compositeMat = mat(COMPOSITE_FRAG, { colorTex: { value: null } });
        this._copyMat = mat(COPY_FRAG, { srcTex: { value: null } });

        /** @type {object|null} PaintableModel の surface */
        this._surface = null;
        this._compRT = null;
        this._materialSwapped = false;
        /** @type {{minX:number,minY:number,maxX:number,maxY:number}|null} 汚れ範囲 (UV) */
        this._dirty = null;
        this._snapDirty = null;
    }

    get attachedSurface() {
        return this._surface;
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
        this._compositeMat.uniforms.colorTex.value = this.color.read.texture;
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

    _markDirty(uv, radiusUv) {
        const minX = Math.max(0, uv.x - radiusUv);
        const minY = Math.max(0, uv.y - radiusUv);
        const maxX = Math.min(1, uv.x + radiusUv);
        const maxY = Math.min(1, uv.y + radiusUv);
        if (!this._dirty) {
            this._dirty = { minX, minY, maxX, maxY };
        } else {
            const d = this._dirty;
            d.minX = Math.min(d.minX, minX);
            d.minY = Math.min(d.minY, minY);
            d.maxX = Math.max(d.maxX, maxX);
            d.maxY = Math.max(d.maxY, maxY);
        }
    }

    /* ---------- public API ---------- */

    /**
     * 描画先サーフェスを切り替え、display テクスチャをRTへ取り込む。
     * 別サーフェスにのばしかけの絵が残っていたら先に焼き込む。
     */
    attachSurface(surface) {
        if (this._surface === surface) return;
        if (this._surface) this.bakeNow();
        this._surface = surface;
        this._compRT = this._getCompositeRT(surface.baseCanvas.width);
        this._dirty = null;
        this._seedMat.uniforms.srcTex.value = surface.texture;
        this._pass(this._seedMat, this.color.read);
        this._renderComposite();
    }

    /**
     * 前回位置から現在位置へ向かってピクセルを引きずる。
     * @param {{x:number,y:number}} uv        現在位置 (UV, y上向き)
     * @param {{x:number,y:number}|null} prevUv
     * @param {number} radiusUv               指の半径 (UV単位)
     */
    splat(uv, prevUv, radiusUv) {
        if (!this._surface) return;
        if (!prevUv) return; // 最初の点は方向が無いので何も動かさない

        const dx = uv.x - prevUv.x;
        const dy = uv.y - prevUv.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return;
        this._swapMaterialIn();

        const spacing = Math.max(radiusUv * 0.4, 1e-4);
        const count = Math.min(12, Math.max(1, Math.ceil(dist / spacing)));
        for (let i = 1; i <= count; i++) {
            const t = i / count;
            const cx = prevUv.x + dx * t;
            const cy = prevUv.y + dy * t;
            let px = (dx / count) * PUSH_STRENGTH;
            let py = (dy / count) * PUSH_STRENGTH;
            const plen = Math.hypot(px, py);
            if (plen > MAX_PUSH_UV) {
                px *= MAX_PUSH_UV / plen;
                py *= MAX_PUSH_UV / plen;
            }
            const u = this._smudgeMat.uniforms;
            u.colorTex.value = this.color.read.texture;
            u.center.value.set(cx, cy);
            u.delta.value.set(px, py);
            u.radius.value = radiusUv;
            this._pass(this._smudgeMat, this.color.write);
            this.color.swap();
            this._markDirty({ x: cx, y: cy }, radiusUv * 1.8);
        }
        this._renderComposite();
    }

    /** ストローク開始時のスナップショット (2本指ジェスチャでのキャンセル用) */
    snapshot() {
        if (!this._surface) return;
        this._copy(this.color.read, this.colorBak);
        this._snapDirty = this._dirty ? { ...this._dirty } : null;
    }

    /** snapshot 時点へ巻き戻してサーフェスから離れる */
    restore() {
        if (!this._surface) return;
        this._copy(this.colorBak, this.color.read);
        // キャンバスは変わっていないので、次のストロークで再シードすればよい
        this._restoreMaterial();
        this._surface = null;
        this._compRT = null;
        this._dirty = null;
    }

    /**
     * のばした結果の汚れた矩形だけを baseCanvas に書き戻し、
     * CanvasTexture 表示へ復帰してサーフェスから離れる。
     * 矩形外は一切触らないため、未加工部分の解像度は落ちない。
     */
    bakeNow() {
        const surface = this._surface;
        if (!surface) return;
        if (this._dirty) {
            const S = this.simSize;
            const pad = 2;
            const sx0 = Math.max(0, Math.floor(this._dirty.minX * S) - pad);
            const sy0 = Math.max(0, Math.floor(this._dirty.minY * S) - pad);
            const sx1 = Math.min(S, Math.ceil(this._dirty.maxX * S) + pad);
            const sy1 = Math.min(S, Math.ceil(this._dirty.maxY * S) + pad);
            const sw = sx1 - sx0;
            const sh = sy1 - sy0;
            if (sw > 0 && sh > 0) {
                const buf = new Uint8Array(sw * sh * 4);
                this.renderer.readRenderTargetPixels(this.color.read, sx0, sy0, sw, sh, buf);
                // WebGL の行は下から上なので、canvas 用に上下反転する
                const flipped = new Uint8ClampedArray(sw * sh * 4);
                for (let row = 0; row < sh; row++) {
                    flipped.set(buf.subarray((sh - 1 - row) * sw * 4, (sh - row) * sw * 4), row * sw * 4);
                }
                this._bakeCanvas.width = sw;
                this._bakeCanvas.height = sh;
                this._bakeCtx.putImageData(new ImageData(flipped, sw, sh), 0, 0);

                const W = surface.baseCanvas.width;
                const H = surface.baseCanvas.height;
                const dx = (sx0 / S) * W;
                const dy = ((S - sy1) / S) * H;
                surface.baseCtx.drawImage(this._bakeCanvas, dx, dy, (sw / S) * W, (sh / S) * H);

                // display を再合成 (PaintableModel.refreshDisplay 相当)
                const dctx = surface.displayCtx;
                dctx.clearRect(0, 0, surface.displayCanvas.width, surface.displayCanvas.height);
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
        }
        this._restoreMaterial();
        this._surface = null;
        this._compRT = null;
        this._dirty = null;
    }

    /** のばしかけの結果を捨ててサーフェスから離れる (モデル切替・まっしろにもどす用) */
    discardWet() {
        if (!this._surface) return;
        this._restoreMaterial();
        this._surface = null;
        this._compRT = null;
        this._dirty = null;
    }
}
