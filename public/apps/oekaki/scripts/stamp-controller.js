/**
 * スタンプコントローラ
 * 押している間にスタンプが大きくなり、離したタイミングでメインキャンバスへ確定する。
 * 色は呼び出し側（InputHandler 経由のユーザー選択色）で指定する。
 * 押下位置から指を動かすと中心まわりに回転する。
 */

/** スタンプ定義（ピッカーのサムネイル用にデフォルト色を持つ） */
export const STAMPS = [
    { id: 'star', url: 'stamps/star.svg', label: 'ほし', color: '#FFC93D' },
    { id: 'heart', url: 'stamps/heart.svg', label: 'ハート', color: '#FF6B81' },
    { id: 'flower', url: 'stamps/flower.svg', label: 'はな', color: '#FF4757' },
    { id: 'sun', url: 'stamps/sun.svg', label: 'たいよう', color: '#FFA502' },
    { id: 'cloud', url: 'stamps/cloud.svg', label: 'くも', color: '#70A1FF' },
    { id: 'circle', url: 'stamps/circle.svg', label: 'まる', color: '#1E90FF' },
];

/** マスク用カラー（不透明な単色なら何でも良い。'source-in' でアルファだけ使う） */
const MASK_COLOR = '#000000';

/** SVG を色つき Image / blob URL に変換するローダ（キャッシュ付き） */
class StampLoader {
    constructor() {
        this.svgTextCache = new Map();   // url -> Promise<string>
        this.dataUrlCache = new Map();   // `${url}|${color}` -> Promise<string>
        this.imageCache = new Map();     // `${url}|${color}` -> Promise<HTMLImageElement>
    }

    getSvgText(url) {
        if (!this.svgTextCache.has(url)) {
            this.svgTextCache.set(url, fetch(url).then(r => r.text()));
        }
        return this.svgTextCache.get(url);
    }

    getDataUrl(url, color) {
        const key = `${url}|${color}`;
        if (this.dataUrlCache.has(key)) return this.dataUrlCache.get(key);
        const promise = (async () => {
            const svgText = await this.getSvgText(url);
            const tinted = svgText.replace(/currentColor/g, color);
            const blob = new Blob([tinted], { type: 'image/svg+xml;charset=utf-8' });
            return URL.createObjectURL(blob);
        })();
        this.dataUrlCache.set(key, promise);
        return promise;
    }

    getImage(url, color) {
        const key = `${url}|${color}`;
        if (this.imageCache.has(key)) return this.imageCache.get(key);
        const promise = (async () => {
            const dataUrl = await this.getDataUrl(url, color);
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = dataUrl;
            });
            return img;
        })();
        this.imageCache.set(key, promise);
        return promise;
    }
}

const sharedLoader = new StampLoader();

/** 指定スタンプの色つき画像 URL を返す（UIサムネイル用） */
export async function getStampImageUrl(shapeId, colorOverride) {
    const stamp = STAMPS.find(s => s.id === shapeId) || STAMPS[0];
    const color = colorOverride || stamp.color;
    return sharedLoader.getDataUrl(stamp.url, color);
}

export class StampController {
    /**
     * @param {object} deps
     * @param {import('./canvas.js').CanvasManager} deps.canvasManager
     */
    constructor({ canvasManager }) {
        this.cm = canvasManager;
        this.loader = sharedLoader;

        // アクティブなスタンプ状態（押下中のみ存在）
        // { shapeId, x, y, radius, colorSpec, image, angle, startAngle }
        this.active = null;

        // 成長アニメーション
        this._growing = false;
        this._raf = null;

        // 成長パラメータ（キャンバス座標基準、A4=2480×3508 を想定）
        this._initialRadius = 60;     // 押した瞬間の半径
        this._maxRadius = 520;        // これ以上は大きくならない
        this._growRate = 260;         // px/秒（約2秒で最大）

        // 確定時の透過度（ペンと揃える）
        this._stampOpacity = 0.6;
        // 回転を始めるまでの不感帯（中心からの距離・キャンバス座標）
        this._rotateDeadZone = 30;
    }

    /**
     * キャンバス上のポインタダウン（InputHandler から呼ばれる）。
     * 指定位置にスタンプを置き、離されるまで徐々に大きくする。
     * @param {number} canvasX
     * @param {number} canvasY
     * @param {string} shapeId
     * @param {string|object} colorSpec - { type:'solid', color } / { type:'gradient', colors:[a,b] } / 文字列
     */
    async onCanvasPointerDown(canvasX, canvasY, shapeId, colorSpec) {
        // 念のため前回の未確定があれば確定
        if (this.active) this.commit();

        const stamp = STAMPS.find(s => s.id === shapeId) || STAMPS[0];
        this.active = {
            shapeId: stamp.id,
            x: canvasX,
            y: canvasY,
            radius: this._initialRadius,
            colorSpec: colorSpec || { type: 'solid', color: stamp.color },
            image: null,
            angle: 0,
            startAngle: null,
        };
        this._startGrowth();

        // マスク画像（アルファのみ利用、色は composite で塗り直す）
        const img = await this.loader.getImage(stamp.url, MASK_COLOR);
        if (!this.active) return; // 読み込み前に確定された場合
        this.active.image = img;
        this.render();
    }

    /**
     * 押下中の指の移動：中心からの角度差分で回転させる。
     */
    onCanvasPointerMove(canvasX, canvasY) {
        if (!this.active) return;
        const dx = canvasX - this.active.x;
        const dy = canvasY - this.active.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this._rotateDeadZone) return;

        const a = Math.atan2(dy, dx);
        if (this.active.startAngle === null) {
            // 初回の有効移動：基準角度を記録（このとき angle は 0 のまま）
            this.active.startAngle = a;
            return;
        }
        this.active.angle = a - this.active.startAngle;
        this.render();
    }

    /** ポインタアップ：成長を止めて確定 */
    onCanvasPointerUp() {
        if (!this.active) return;
        this._stopGrowth();
        this.commit();
    }

    /** アクティブスタンプを main-canvas に焼き付けてクリア */
    commit() {
        if (!this.active) return;
        const ctx = this.cm.mainCtx;
        ctx.save();
        ctx.globalAlpha = this._stampOpacity;
        this._drawStampTo(ctx, this.active);
        ctx.restore();
        this.active = null;
        this._clearOverlay();
    }

    /** スタンプモードを抜けるときなどに呼ぶ */
    deactivate() {
        this._stopGrowth();
        if (this.active) this.commit();
    }

    render() {
        this._clearOverlay();
        if (!this.active) return;
        this._drawStampTo(this.cm.overlayCtx, this.active);
    }

    // --- 内部 ---

    _startGrowth() {
        this._stopGrowth();
        this._growing = true;
        const startTime = performance.now();
        const startR = this.active.radius;
        const tick = (now) => {
            if (!this._growing || !this.active) return;
            const dt = (now - startTime) / 1000;
            const r = Math.min(this._maxRadius, startR + this._growRate * dt);
            this.active.radius = r;
            this.render();
            if (r < this._maxRadius && this._growing) {
                this._raf = requestAnimationFrame(tick);
            }
        };
        this._raf = requestAnimationFrame(tick);
    }

    _stopGrowth() {
        this._growing = false;
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }

    _clearOverlay() {
        const c = this.cm.overlayCanvas;
        this.cm.overlayCtx.clearRect(0, 0, c.width, c.height);
    }

    _drawStampTo(ctx, stamp) {
        if (!stamp.image) return;
        const r = stamp.radius;
        const size = r * 2;

        // オフスクリーンでマスク画像を任意の色／グラデーションに塗り替える
        const off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        const offCtx = off.getContext('2d');
        offCtx.drawImage(stamp.image, 0, 0, size, size);
        offCtx.globalCompositeOperation = 'source-in';
        offCtx.fillStyle = this._resolveFillStyle(offCtx, stamp.colorSpec, size);
        offCtx.fillRect(0, 0, size, size);

        // 中心まわりに回転して描画
        ctx.save();
        ctx.translate(stamp.x, stamp.y);
        if (stamp.angle) ctx.rotate(stamp.angle);
        ctx.drawImage(off, -r, -r, size, size);
        ctx.restore();
    }

    _resolveFillStyle(ctx, colorSpec, size) {
        if (colorSpec && colorSpec.type === 'gradient') {
            const g = ctx.createLinearGradient(0, 0, size, size);
            g.addColorStop(0, colorSpec.colors[0]);
            g.addColorStop(1, colorSpec.colors[1]);
            return g;
        }
        if (typeof colorSpec === 'string') return colorSpec;
        if (colorSpec && colorSpec.type === 'solid') return colorSpec.color;
        return '#000';
    }
}
