/**
 * 描画可能な3Dモデルの基底クラス。
 * 1つ以上の「描画サーフェス」を持ち、各サーフェスは
 *   - baseCanvas    : 確定済みのレイヤー
 *   - strokeCanvas  : 進行中のストローク (不透明で描画)
 *   - displayCanvas : テクスチャに渡す合成結果 (base + stroke@α)
 * の3枚で構成される。pointerup時に stroke を base に α合成して確定する。
 */

import * as THREE from 'three';
import { attachOutline, disposeOutline } from '../outline.js';

const DEFAULT_TEXTURE_SIZE = 2048;
const STROKE_OPACITY = 0.6;

function makeCanvas(size, fillColor) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, 0, size, size);
    }
    return { canvas: c, ctx };
}

function createPaintSurface(textureSize) {
    const base = makeCanvas(textureSize, '#ffffff');
    const stroke = makeCanvas(textureSize, null);
    const display = makeCanvas(textureSize, '#ffffff');

    const texture = new THREE.CanvasTexture(display.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 16;

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: texture,
        emissiveIntensity: 0.3,
        roughness: 0.85,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });

    return {
        baseCanvas: base.canvas,
        baseCtx: base.ctx,
        strokeCanvas: stroke.canvas,
        strokeCtx: stroke.ctx,
        displayCanvas: display.canvas,
        displayCtx: display.ctx,
        texture,
        material,
        hasStroke: false,
        strokeOpacity: STROKE_OPACITY,
    };
}

/**
 * カラー指定 (文字列 / {type:'solid'} / {type:'gradient'}) を
 * Canvas の fillStyle/strokeStyle に解決する。
 */
function resolveStyle(ctx, colorSpec) {
    if (colorSpec && colorSpec.type === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, ctx.canvas.width, ctx.canvas.height);
        g.addColorStop(0, colorSpec.colors[0]);
        g.addColorStop(1, colorSpec.colors[1]);
        return g;
    }
    if (typeof colorSpec === 'string') return colorSpec;
    if (colorSpec && colorSpec.type === 'solid') return colorSpec.color;
    return '#000';
}

function refreshDisplay(surface, dx0, dy0, dw, dh) {
    if (dw <= 0 || dh <= 0) return;
    const dctx = surface.displayCtx;
    dctx.clearRect(dx0, dy0, dw, dh);
    dctx.drawImage(surface.baseCanvas, dx0, dy0, dw, dh, dx0, dy0, dw, dh);
    if (surface.hasStroke) {
        dctx.globalAlpha = surface.strokeOpacity;
        dctx.drawImage(surface.strokeCanvas, dx0, dy0, dw, dh, dx0, dy0, dw, dh);
        dctx.globalAlpha = 1.0;
    }
    surface.texture.needsUpdate = true;
}

/**
 * UV空間上の線分(または点)をストローク/ベースキャンバスに描き、
 * displayキャンバスの該当矩形だけを再合成する。
 */
function paintOnSurface(surface, prevPx, currPx, colorSpec, sizePx, opacity) {
    const useStrokeLayer = opacity < 1;
    const ctx = useStrokeLayer ? surface.strokeCtx : surface.baseCtx;

    const style = resolveStyle(ctx, colorSpec);
    ctx.fillStyle = style;
    ctx.strokeStyle = style;
    ctx.lineWidth = sizePx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let minX, minY, maxX, maxY;
    if (prevPx) {
        ctx.beginPath();
        ctx.moveTo(prevPx.x, prevPx.y);
        ctx.lineTo(currPx.x, currPx.y);
        ctx.stroke();
        minX = Math.min(prevPx.x, currPx.x);
        maxX = Math.max(prevPx.x, currPx.x);
        minY = Math.min(prevPx.y, currPx.y);
        maxY = Math.max(prevPx.y, currPx.y);
    } else {
        ctx.beginPath();
        ctx.arc(currPx.x, currPx.y, sizePx / 2, 0, Math.PI * 2);
        ctx.fill();
        minX = maxX = currPx.x;
        minY = maxY = currPx.y;
    }

    if (useStrokeLayer) {
        surface.hasStroke = true;
        surface.strokeOpacity = opacity;
    }

    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    const pad = sizePx / 2 + 2;
    const dx0 = Math.max(0, Math.floor(minX - pad));
    const dy0 = Math.max(0, Math.floor(minY - pad));
    const dx1 = Math.min(w, Math.ceil(maxX + pad));
    const dy1 = Math.min(h, Math.ceil(maxY + pad));
    refreshDisplay(surface, dx0, dy0, dx1 - dx0, dy1 - dy0);
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [0, 0, 0];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function lerpHex(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return [
        Math.round(A[0] + (B[0] - A[0]) * t),
        Math.round(A[1] + (B[1] - A[1]) * t),
        Math.round(A[2] + (B[2] - A[2]) * t),
    ];
}

function rgbaStr(rgb, alpha) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * colorSpec を 1点の RGB タプルに解決する。
 * gradient の場合はキャンバス対角の位置で 2色を補間する (135deg 相当)。
 */
function sampleColorRgb(colorSpec, x, y, w, h) {
    if (colorSpec && colorSpec.type === 'gradient') {
        const t = Math.max(0, Math.min(1, (x + y) / (w + h)));
        return lerpHex(colorSpec.colors[0], colorSpec.colors[1], t);
    }
    if (typeof colorSpec === 'string') return hexToRgb(colorSpec);
    if (colorSpec && colorSpec.type === 'solid') return hexToRgb(colorSpec.color);
    return [0, 0, 0];
}

/**
 * エアブラシ: 中心から滑らかに減衰するソフトな円形スタンプを 1発だけ落とす。
 * - 各スタンプは低アルファ (中心 ~0.14 → 外周 0)
 * - pointermove で連続発射されるため同じ場所に滞在すると徐々に濃くなる
 * - グラデーション色は位置で補間 (キャンバス対角)
 *
 * strokeCanvas には source-over で α が積み上がるため、
 * strokeOpacity=1 で display/base へ素直に転写する。
 */
function sprayOnSurface(surface, cx, cy, colorSpec, sizePx) {
    const ctx = surface.strokeCtx;
    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;

    const radius = Math.max(2, sizePx / 2);
    const rgb = sampleColorRgb(colorSpec, cx, cy, w, h);

    // ふわっと減衰する放射状グラデーション (ソフトエッジ)
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, rgbaStr(rgb, 0.14));
    grad.addColorStop(0.55, rgbaStr(rgb, 0.06));
    grad.addColorStop(1, rgbaStr(rgb, 0));

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 微細なグレイン感を加える (低密度・低アルファのドットを散布)
    const grainCount = Math.max(2, Math.floor(radius / 4));
    const grainAlpha = 0.06;
    const grainColor = rgbaStr(rgb, grainAlpha);
    ctx.fillStyle = grainColor;
    for (let i = 0; i < grainCount; i++) {
        const r = Math.sqrt(Math.random()) * radius;
        const theta = Math.random() * Math.PI * 2;
        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r;
        ctx.beginPath();
        ctx.arc(px, py, 0.6, 0, Math.PI * 2);
        ctx.fill();
    }

    surface.hasStroke = true;
    surface.strokeOpacity = 1;

    const pad = radius + 2;
    const dx0 = Math.max(0, Math.floor(cx - pad));
    const dy0 = Math.max(0, Math.floor(cy - pad));
    const dx1 = Math.min(w, Math.ceil(cx + pad));
    const dy1 = Math.min(h, Math.ceil(cy + pad));
    refreshDisplay(surface, dx0, dy0, dx1 - dx0, dy1 - dy0);
}

/**
 * シェイプをストロークキャンバスに 1つ描く。
 * 塗りは resolveStyle と同じカラースペックを受け取る。
 * opacity は strokeOpacity として扱い、endStroke 時に base に合成される。
 */
function stampShapeOnSurface(surface, cx, cy, shape, colorSpec, sizePx, opacity) {
    const r = sizePx / 2;
    const ctx = surface.strokeCtx;
    const style = resolveStyle(ctx, colorSpec);
    ctx.fillStyle = style;
    ctx.beginPath();
    _drawShapePath(ctx, cx, cy, r, shape);
    ctx.fill();

    surface.hasStroke = true;
    surface.strokeOpacity = opacity;

    const pad = r + 2;
    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    refreshDisplay(
        surface,
        Math.max(0, Math.floor(cx - pad)),
        Math.max(0, Math.floor(cy - pad)),
        Math.min(w, Math.ceil(cx + pad)) - Math.max(0, Math.floor(cx - pad)),
        Math.min(h, Math.ceil(cy + pad)) - Math.max(0, Math.floor(cy - pad)),
    );
}

/** cx,cy を中心に半径 r のシェイプパスを作る (fill は呼び出し側) */
function _drawShapePath(ctx, cx, cy, r, shape) {
    switch (shape) {
        case 'circle':
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            break;
        case 'triangle': {
            // 上向き正三角形
            const h = r * Math.sqrt(3);
            ctx.moveTo(cx,            cy - r * 2 / Math.sqrt(3));
            ctx.lineTo(cx + r,        cy + h / Math.sqrt(3) / Math.sqrt(3));
            ctx.lineTo(cx - r,        cy + h / Math.sqrt(3) / Math.sqrt(3));
            ctx.closePath();
            break;
        }
        case 'star': {
            const outer = r;
            const inner = r * 0.4;
            const points = 5;
            for (let i = 0; i < points * 2; i++) {
                const angle = (Math.PI / points) * i - Math.PI / 2;
                const rad   = i % 2 === 0 ? outer : inner;
                const x = cx + Math.cos(angle) * rad;
                const y = cy + Math.sin(angle) * rad;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
            break;
        }
        case 'heart': {
            // 数式ハート (キュービック曲線)
            const s = r * 0.9;
            ctx.moveTo(cx, cy + s * 0.8);
            ctx.bezierCurveTo(cx - s * 2, cy - s * 0.5, cx - s * 2, cy - s * 1.8, cx, cy - s * 0.5);
            ctx.bezierCurveTo(cx + s * 2, cy - s * 1.8, cx + s * 2, cy - s * 0.5, cx, cy + s * 0.8);
            ctx.closePath();
            break;
        }
        default:
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
}

function commitStroke(surface) {
    if (!surface.hasStroke) return;
    surface.baseCtx.globalAlpha = surface.strokeOpacity;
    surface.baseCtx.drawImage(surface.strokeCanvas, 0, 0);
    surface.baseCtx.globalAlpha = 1.0;
    surface.strokeCtx.clearRect(0, 0, surface.strokeCanvas.width, surface.strokeCanvas.height);
    surface.hasStroke = false;
}

function discardStroke(surface) {
    if (!surface.hasStroke) return;
    surface.strokeCtx.clearRect(0, 0, surface.strokeCanvas.width, surface.strokeCanvas.height);
    surface.hasStroke = false;
}

function clearSurface(surface) {
    surface.baseCtx.fillStyle = '#ffffff';
    surface.baseCtx.fillRect(0, 0, surface.baseCanvas.width, surface.baseCanvas.height);
    surface.strokeCtx.clearRect(0, 0, surface.strokeCanvas.width, surface.strokeCanvas.height);
    surface.displayCtx.fillStyle = '#ffffff';
    surface.displayCtx.fillRect(0, 0, surface.displayCanvas.width, surface.displayCanvas.height);
    surface.hasStroke = false;
    surface.texture.needsUpdate = true;
}

function disposeSurface(surface) {
    surface.texture.dispose();
    surface.material.dispose();
}

export { createPaintSurface, paintOnSurface, sprayOnSurface, stampShapeOnSurface, commitStroke, clearSurface, disposeSurface, STROKE_OPACITY };

export class PaintableModel {
    /**
     * @param {THREE.BufferGeometry} geometry
     * @param {object} [options]
     * @param {number} [options.surfaceCount=1]
     * @param {number} [options.textureSize=2048]
     */
    constructor(geometry, { surfaceCount = 1, textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
        this.geometry = geometry;
        this.surfaces = [];

        for (let i = 0; i < surfaceCount; i++) {
            this.surfaces.push(createPaintSurface(textureSize));
        }

        const materials = this.surfaces.map((s) => s.material);
        this.mesh = new THREE.Mesh(
            geometry,
            surfaceCount === 1 ? materials[0] : materials,
        );

        this._outline = attachOutline(this.mesh, geometry);
    }

    clear() {
        for (const s of this.surfaces) clearSurface(s);
    }

    /**
     * ストローク開始の宣言。pen/spray は strokeCanvas に描かれるため
     * baseCanvas の退避は不要。
     */
    beginStroke() {}

    /**
     * 進行中の(まだ commit されていない)ストロークを破棄する。
     */
    cancelStroke() {
        for (const s of this.surfaces) discardStroke(s);
        for (const s of this.surfaces) {
            refreshDisplay(s, 0, 0, s.displayCanvas.width, s.displayCanvas.height);
        }
    }

    surfaceIndexFor(intersection) {
        if (this.surfaces.length === 1) return 0;
        const idx = intersection?.face?.materialIndex;
        return typeof idx === 'number' ? idx : 0;
    }

    /**
     * @param {THREE.Intersection} intersection
     * @param {{surfaceIndex:number, uv:{x:number,y:number}}|null} prev
     * @param {string|object} color  // 文字列 or {type:'solid'|'gradient',...}
     * @param {number} sizePx
     * @param {number} [opacity=1]
     */
    paint(intersection, prev, color, sizePx, opacity = 1) {
        const surfaceIndex = this.surfaceIndexFor(intersection);
        const surface = this.surfaces[surfaceIndex];
        const uv = intersection.uv;
        if (!uv) return prev ?? null;

        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;
        const x = uv.x * w;
        const y = (1 - uv.y) * h;

        const sameSurface = prev && prev.surfaceIndex === surfaceIndex;
        const seamGuard = 0.4;
        const dx = sameSurface ? Math.abs(uv.x - prev.uv.x) : 1;
        const dy = sameSurface ? Math.abs(uv.y - prev.uv.y) : 1;
        const connect = sameSurface && dx < seamGuard && dy < seamGuard;
        const prevPx = connect ? { x: prev.uv.x * w, y: (1 - prev.uv.y) * h } : null;

        paintOnSurface(surface, prevPx, { x, y }, color, sizePx, opacity);
        return { surfaceIndex, uv: { x: uv.x, y: uv.y } };
    }

    /**
     * スプレー (エアブラシ): UV位置にソフトなスタンプを 1発落とす。
     * 連続呼び出しで徐々に濃くなる。
     */
    spray(intersection, color, sizePx) {
        const surfaceIndex = this.surfaceIndexFor(intersection);
        const surface = this.surfaces[surfaceIndex];
        const uv = intersection.uv;
        if (!uv) return;
        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;
        sprayOnSurface(surface, uv.x * w, (1 - uv.y) * h, color, sizePx);
    }

    /**
     * もようブラシ: UV位置にシェイプを 1つスタンプする。
     * @param {THREE.Intersection} intersection
     * @param {string|object} color
     * @param {number} sizePx
     * @param {'circle'|'triangle'|'star'|'heart'} shape
     * @param {number} opacity
     */
    stampShape(intersection, color, sizePx, shape, opacity = 1) {
        const surfaceIndex = this.surfaceIndexFor(intersection);
        const surface = this.surfaces[surfaceIndex];
        const uv = intersection.uv;
        if (!uv) return;
        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;
        stampShapeOnSurface(surface, uv.x * w, (1 - uv.y) * h, shape, color, sizePx, opacity);
    }

    endStroke() {
        for (const s of this.surfaces) commitStroke(s);
    }

    dispose() {
        for (const s of this.surfaces) disposeSurface(s);
        if (this._outline) disposeOutline(this._outline);
        this.geometry.dispose();
    }
}
