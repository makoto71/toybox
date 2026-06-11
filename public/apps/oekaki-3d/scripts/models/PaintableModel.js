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
import { getWatercolorSim } from '../watercolor-sim.js';
import { getSmudgeSim } from '../smudge-sim.js';
import { getSandSim } from '../sand-sim.js';

/** 利用可能なGPUシミュレーションを列挙する (未対応環境の null は除く) */
function allSims() {
    return [getWatercolorSim(), getSmudgeSim(), getSandSim()].filter(Boolean);
}

/**
 * この surface に乗っている他のシミュレーションを焼き込んで落ち着かせる。
 * material.map の差し替えは同時に1つのシムしかできないため、
 * 別のシム系ブラシを使い始める前に必ず呼ぶ。
 */
function settleOtherSims(surface, except) {
    for (const sim of allSims()) {
        if (sim !== except && sim.attachedSurface === surface) sim.bakeNow();
    }
}

const DEFAULT_TEXTURE_SIZE = 2048;
const STROKE_OPACITY = 0.6;

function makeCanvas(size, fillColor, ctxOptions) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', ctxOptions);
    if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, 0, size, size);
    }
    return { canvas: c, ctx };
}

function createPaintSurface(textureSize) {
    const base = makeCanvas(textureSize, '#ffffff');
    const stroke = makeCanvas(textureSize, null);
    // display はすいさいの色拾い (getImageData) で頻繁に読むため CPU 側に置く
    const display = makeCanvas(textureSize, '#ffffff', { willReadFrequently: true });

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
        // ストロークを base/display に合成するときの合成モード。
        // すいさいは 'multiply' にして重ね塗りで色が混ざる (グレーズ) ようにする。
        strokeBlend: 'source-over',
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
        dctx.globalCompositeOperation = surface.strokeBlend ?? 'source-over';
        dctx.drawImage(surface.strokeCanvas, dx0, dy0, dw, dh, dx0, dy0, dw, dh);
        dctx.globalCompositeOperation = 'source-over';
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
            // MDN canvas tutorial の 6 ベジェハート。
            // 元座標系は 150x150 で中心 (75, 72.5)、横幅 110。r/55 で正規化して幅 2r にスケール。
            const k = r / 55;
            const px = (x) => cx + (x - 75) * k;
            const py = (y) => cy + (y - 72.5) * k;
            ctx.moveTo(px(75), py(40));
            ctx.bezierCurveTo(px(75),  py(37),   px(70),  py(25),   px(50),  py(25));
            ctx.bezierCurveTo(px(20),  py(25),   px(20),  py(62.5), px(20),  py(62.5));
            ctx.bezierCurveTo(px(20),  py(80),   px(40),  py(102),  px(75),  py(120));
            ctx.bezierCurveTo(px(110), py(102),  px(130), py(80),   px(130), py(62.5));
            ctx.bezierCurveTo(px(130), py(62.5), px(130), py(25),   px(100), py(25));
            ctx.bezierCurveTo(px(85),  py(25),   px(75),  py(37),   px(75),  py(40));
            ctx.closePath();
            break;
        }
        default:
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
}

/* ---------------- すいさい (watercolor) ---------------- */

const WATERCOLOR_ALPHA = 0.20;   // スタンプ中心の不透明度 (低くして重なりで濃くなる)
const WATERCOLOR_PICKUP = 0.30;  // 下地の色を筆が拾う割合
const WATERCOLOR_REFRESH = 0.45; // 筆から新しい絵の具が供給される割合

/**
 * 単定数 Kubelka-Munk 近似でチャンネルごとに2色を混ぜる。
 * RGB の線形補間と違い、絵の具らしい減法混色になる (青+黄→緑)。
 * @param {number[]} a RGB (0-255)
 * @param {number[]} b RGB (0-255)
 * @param {number} t b の割合 (0-1)
 */
function kmMixRgb(a, b, t) {
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const ra = Math.min(0.99, Math.max(0.004, a[i] / 255));
        const rb = Math.min(0.99, Math.max(0.004, b[i] / 255));
        const ksA = (1 - ra) ** 2 / (2 * ra);
        const ksB = (1 - rb) ** 2 / (2 * rb);
        const ks = ksA * (1 - t) + ksB * t;
        const r = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
        out[i] = Math.round(r * 255);
    }
    return out;
}

/**
 * display キャンバスの小領域を平均して、筆の下にある色を拾う。
 * (display = base + 進行中ストロークの合成なので、描いた直後の色も拾える)
 */
function sampleSurfaceColor(surface, cx, cy, radius) {
    const w = surface.displayCanvas.width;
    const h = surface.displayCanvas.height;
    const r = Math.max(2, Math.min(10, radius * 0.3));
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(w, Math.ceil(cx + r));
    const y1 = Math.min(h, Math.ceil(cy + r));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const data = surface.displayCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < data.length; i += 8) { // 1ピクセルおきに間引き
        rr += data[i];
        gg += data[i + 1];
        bb += data[i + 2];
        n++;
    }
    return n ? [rr / n, gg / n, bb / n] : null;
}

/**
 * すいさい: にじんだソフトエッジのスタンプを線分に沿って打つ。
 * - 本体はランダムに揺らいだ放射グラデーション
 * - ときどき衛星ブロブを散らして「にじみ」を出す
 * - 外周に少し濃いリング (顔料がフチに溜まる水彩特有のエッジ)
 * - 細かい粒状感 (顔料のグラニュレーション)
 * blend='multiply' のとき重ね塗りがグレーズになり下地と混ざる。
 */
function watercolorOnSurface(surface, prevPx, currPx, rgb, sizePx, blend) {
    const ctx = surface.strokeCtx;
    const radius = Math.max(3, sizePx / 2);
    const dark = [
        Math.round(rgb[0] * 0.72),
        Math.round(rgb[1] * 0.72),
        Math.round(rgb[2] * 0.72),
    ];

    const stampAt = (x, y) => {
        const r = radius * (0.85 + Math.random() * 0.3);

        // 本体
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgbaStr(rgb, WATERCOLOR_ALPHA));
        grad.addColorStop(0.7, rgbaStr(rgb, WATERCOLOR_ALPHA * 0.8));
        grad.addColorStop(1, rgbaStr(rgb, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // にじみ (衛星ブロブ)
        if (Math.random() < 0.45) {
            const theta = Math.random() * Math.PI * 2;
            const d = r * (0.5 + Math.random() * 0.5);
            const br = r * (0.35 + Math.random() * 0.35);
            const bx = x + Math.cos(theta) * d;
            const by = y + Math.sin(theta) * d;
            const g2 = ctx.createRadialGradient(bx, by, 0, bx, by, br);
            g2.addColorStop(0, rgbaStr(rgb, WATERCOLOR_ALPHA * 0.5));
            g2.addColorStop(1, rgbaStr(rgb, 0));
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }

        // エッジの濃淡
        ctx.strokeStyle = rgbaStr(dark, 0.05);
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.93, 0, Math.PI * 2);
        ctx.stroke();

        // 粒状感
        const grains = Math.max(2, Math.floor(r / 6));
        ctx.fillStyle = rgbaStr(dark, 0.08);
        for (let i = 0; i < grains; i++) {
            const gr = Math.sqrt(Math.random()) * r * 0.9;
            const th = Math.random() * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(x + Math.cos(th) * gr, y + Math.sin(th) * gr, 0.5 + Math.random(), 0, Math.PI * 2);
            ctx.fill();
        }
    };

    let minX, maxX, minY, maxY;
    if (prevPx) {
        const dist = Math.hypot(currPx.x - prevPx.x, currPx.y - prevPx.y);
        const steps = Math.min(32, Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.35))));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            stampAt(prevPx.x + (currPx.x - prevPx.x) * t, prevPx.y + (currPx.y - prevPx.y) * t);
        }
        minX = Math.min(prevPx.x, currPx.x);
        maxX = Math.max(prevPx.x, currPx.x);
        minY = Math.min(prevPx.y, currPx.y);
        maxY = Math.max(prevPx.y, currPx.y);
    } else {
        stampAt(currPx.x, currPx.y);
        minX = maxX = currPx.x;
        minY = maxY = currPx.y;
    }

    surface.hasStroke = true;
    surface.strokeOpacity = 1;
    surface.strokeBlend = blend;

    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    const pad = radius * 1.9 + 3;
    refreshDisplay(surface,
        Math.max(0, Math.floor(minX - pad)),
        Math.max(0, Math.floor(minY - pad)),
        Math.min(w, Math.ceil(maxX + pad)) - Math.max(0, Math.floor(minX - pad)),
        Math.min(h, Math.ceil(maxY + pad)) - Math.max(0, Math.floor(minY - pad)),
    );
}

/**
 * きらきら: 選択色と白を混ぜた輝点をランダムに散らす。
 */
function glitterOnSurface(surface, cx, cy, colorSpec, sizePx) {
    const ctx = surface.strokeCtx;
    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    const radius = Math.max(4, sizePx / 2);
    const rgb = sampleColorRgb(colorSpec, cx, cy, w, h);
    const count = Math.max(8, Math.floor(radius * 0.7));

    for (let i = 0; i < count; i++) {
        const r = Math.sqrt(Math.random()) * radius * 1.3;
        const theta = Math.random() * Math.PI * 2;
        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r;
        const dotR = 0.6 + Math.random() * 2.2;
        const alpha = 0.35 + Math.random() * 0.6;
        const mix = Math.random() * 0.6;
        const rr = Math.round(rgb[0] + (255 - rgb[0]) * mix);
        const gg = Math.round(rgb[1] + (255 - rgb[1]) * mix);
        const bb = Math.round(rgb[2] + (255 - rgb[2]) * mix);
        ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
    }

    surface.hasStroke = true;
    surface.strokeOpacity = 1;

    const pad = radius * 1.4 + 3;
    refreshDisplay(surface,
        Math.max(0, Math.floor(cx - pad)),
        Math.max(0, Math.floor(cy - pad)),
        Math.min(w, Math.ceil(cx + pad)) - Math.max(0, Math.floor(cx - pad)),
        Math.min(h, Math.ceil(cy + pad)) - Math.max(0, Math.floor(cy - pad)),
    );
}

/**
 * はけ: ストローク方向に対して垂直に bristleCount 本の細線を描く。
 */
function bristleOnSurface(surface, prevPx, currPx, colorSpec, sizePx, opacity) {
    const ctx = surface.strokeCtx;
    const style = resolveStyle(ctx, colorSpec);
    const halfWidth = sizePx / 2;

    let perpX = 1, perpY = 0;
    if (prevPx) {
        const ddx = currPx.x - prevPx.x;
        const ddy = currPx.y - prevPx.y;
        const len = Math.hypot(ddx, ddy);
        if (len > 0.5) { perpX = -ddy / len; perpY = ddx / len; }
    }

    const bristleCount = 14;
    for (let i = 0; i < bristleCount; i++) {
        const t = (i / (bristleCount - 1) - 0.5) * 2;
        const offset = t * halfWidth + (Math.random() - 0.5) * sizePx * 0.12;
        const ox = perpX * offset;
        const oy = perpY * offset;

        ctx.strokeStyle = style;
        ctx.globalAlpha = 0.3 + Math.random() * 0.5;
        ctx.lineWidth = 0.8 + Math.random() * 1.4;
        ctx.lineCap = 'round';

        ctx.beginPath();
        if (prevPx) {
            ctx.moveTo(prevPx.x + ox, prevPx.y + oy);
            ctx.lineTo(currPx.x + ox, currPx.y + oy);
        } else {
            ctx.arc(currPx.x + ox, currPx.y + oy, ctx.lineWidth / 2, 0, Math.PI * 2);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    surface.hasStroke = true;
    surface.strokeOpacity = opacity;

    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    const pad = halfWidth + 2;
    const minX = prevPx ? Math.min(prevPx.x, currPx.x) : currPx.x;
    const maxX = prevPx ? Math.max(prevPx.x, currPx.x) : currPx.x;
    const minY = prevPx ? Math.min(prevPx.y, currPx.y) : currPx.y;
    const maxY = prevPx ? Math.max(prevPx.y, currPx.y) : currPx.y;
    refreshDisplay(surface,
        Math.max(0, Math.floor(minX - pad)),
        Math.max(0, Math.floor(minY - pad)),
        Math.min(w, Math.ceil(maxX + pad)) - Math.max(0, Math.floor(minX - pad)),
        Math.min(h, Math.ceil(maxY + pad)) - Math.max(0, Math.floor(minY - pad)),
    );
}

/**
 * くさ: 中心から放射状に短い線を描く。
 */
function grassOnSurface(surface, currPx, colorSpec, sizePx, opacity) {
    const ctx = surface.strokeCtx;
    const style = resolveStyle(ctx, colorSpec);
    const radius = sizePx / 2;
    const strandCount = Math.max(5, Math.floor(radius * 0.45));

    ctx.strokeStyle = style;
    ctx.lineCap = 'round';

    for (let i = 0; i < strandCount; i++) {
        const rootAngle = Math.random() * Math.PI * 2;
        const rootDist = Math.sqrt(Math.random()) * radius * 0.4;
        const rx = currPx.x + Math.cos(rootAngle) * rootDist;
        const ry = currPx.y + Math.sin(rootAngle) * rootDist;
        const tipAngle = rootAngle + (Math.random() - 0.5) * 0.6;
        const strandLen = (radius - rootDist) * (0.5 + Math.random() * 0.6) + radius * 0.2;

        ctx.globalAlpha = 0.5 + Math.random() * 0.4;
        ctx.lineWidth = 0.8 + Math.random() * 1.0;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + Math.cos(tipAngle) * strandLen, ry + Math.sin(tipAngle) * strandLen);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    surface.hasStroke = true;
    surface.strokeOpacity = opacity;

    const w = surface.baseCanvas.width;
    const h = surface.baseCanvas.height;
    const pad = radius + 2;
    refreshDisplay(surface,
        Math.max(0, Math.floor(currPx.x - pad)),
        Math.max(0, Math.floor(currPx.y - pad)),
        Math.min(w, Math.ceil(currPx.x + pad)) - Math.max(0, Math.floor(currPx.x - pad)),
        Math.min(h, Math.ceil(currPx.y + pad)) - Math.max(0, Math.floor(currPx.y - pad)),
    );
}

function commitStroke(surface) {
    if (!surface.hasStroke) return;
    surface.baseCtx.globalAlpha = surface.strokeOpacity;
    surface.baseCtx.globalCompositeOperation = surface.strokeBlend ?? 'source-over';
    surface.baseCtx.drawImage(surface.strokeCanvas, 0, 0);
    surface.baseCtx.globalCompositeOperation = 'source-over';
    surface.baseCtx.globalAlpha = 1.0;
    surface.strokeCtx.clearRect(0, 0, surface.strokeCanvas.width, surface.strokeCanvas.height);
    surface.hasStroke = false;
    surface.strokeBlend = 'source-over';
}

function discardStroke(surface) {
    if (!surface.hasStroke) return;
    surface.strokeCtx.clearRect(0, 0, surface.strokeCanvas.width, surface.strokeCanvas.height);
    surface.hasStroke = false;
    surface.strokeBlend = 'source-over';
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

export { createPaintSurface, paintOnSurface, sprayOnSurface, stampShapeOnSurface, glitterOnSurface, bristleOnSurface, grassOnSurface, watercolorOnSurface, commitStroke, clearSurface, disposeSurface, STROKE_OPACITY };

export class PaintableModel {
    /**
     * @param {THREE.BufferGeometry|null} geometry  null = async subclass (e.g. CarModel)
     * @param {object} [options]
     * @param {number} [options.surfaceCount=1]
     * @param {number} [options.textureSize=2048]
     */
    constructor(geometry, { surfaceCount = 1, textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
        this.geometry = geometry;
        this.surfaces = [];

        if (geometry === null) {
            this.mesh = null;
            this._outline = null;
            return;
        }

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

    /** サブクラスはこれをオーバーライドして自身のサーフェス配列を返す。 */
    _getAllSurfaces() {
        return this.surfaces;
    }

    /**
     * intersection と直前の cursor から描画先サーフェスとキャンバス座標を解決する。
     * サブクラスはこれをオーバーライドしてシーム検出ロジックを差し替える。
     * @returns {{surface, currPx, prevPx, nextPrev}|null}
     */
    _resolveHit(intersection, prev) {
        const surfaceIndex = this.surfaceIndexFor(intersection);
        const surface = this.surfaces[surfaceIndex];
        const uv = intersection.uv;
        if (!uv) return null;

        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;
        const x = uv.x * w;
        const y = (1 - uv.y) * h;

        const sameSurface = prev && prev.surfaceIndex === surfaceIndex;
        const dx = sameSurface ? Math.abs(uv.x - prev.uv.x) : 1;
        const dy = sameSurface ? Math.abs(uv.y - prev.uv.y) : 1;
        const prevPx = (sameSurface && dx < 0.4 && dy < 0.4)
            ? { x: prev.uv.x * w, y: (1 - prev.uv.y) * h }
            : null;

        return {
            surface,
            currPx: { x, y },
            prevPx,
            nextPrev: { surfaceIndex, uv: { x: uv.x, y: uv.y } },
        };
    }

    clear() {
        // GPUシミュレーションの濡れた絵の具・砂などがこのモデルに乗っていたら捨てる
        for (const sim of allSims()) {
            if (this._getAllSurfaces().includes(sim.attachedSurface)) sim.discardWet();
        }
        for (const s of this._getAllSurfaces()) clearSurface(s);
    }

    beginStroke({ tool } = {}) {
        // すいさい用: 筆が運んでいる絵の具の色 (ストロークごとにリセット)
        this._wetColor = null;
        // ゆびのばし2Dフォールバック用: 引きずっている色
        this._smearColor = null;
        // GPUシム用: 最初のスタンプ直前にスナップショットを取る予約
        this._wcNeedSnapshot = tool === 'watercolor';
        this._wcUsedSim = false;
        this._smNeedSnapshot = tool === 'smudge';
        this._smUsedSim = false;
        this._sandNeedSnapshot = tool === 'sand';
        this._sandUsedSim = false;
    }

    cancelStroke() {
        // GPUシムのストロークはスナップショットへ巻き戻す
        if (this._wcUsedSim) {
            getWatercolorSim()?.restore();
            this._wcUsedSim = false;
        }
        if (this._smUsedSim) {
            getSmudgeSim()?.restore();
            this._smUsedSim = false;
        }
        if (this._sandUsedSim) {
            getSandSim()?.restore();
            this._sandUsedSim = false;
        }
        for (const s of this._getAllSurfaces()) discardStroke(s);
        for (const s of this._getAllSurfaces()) {
            refreshDisplay(s, 0, 0, s.displayCanvas.width, s.displayCanvas.height);
        }
    }

    surfaceIndexFor(intersection) {
        if (this.surfaces.length === 1) return 0;
        const idx = intersection?.face?.materialIndex;
        return typeof idx === 'number' ? idx : 0;
    }

    paint(intersection, prev, color, sizePx, opacity = 1) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;
        paintOnSurface(hit.surface, hit.prevPx, hit.currPx, color, sizePx, opacity);
        return hit.nextPrev;
    }

    spray(intersection, color, sizePx) {
        const hit = this._resolveHit(intersection, null);
        if (!hit) return;
        sprayOnSurface(hit.surface, hit.currPx.x, hit.currPx.y, color, sizePx);
    }

    glitter(intersection, color, sizePx) {
        const hit = this._resolveHit(intersection, null);
        if (!hit) return;
        glitterOnSurface(hit.surface, hit.currPx.x, hit.currPx.y, color, sizePx);
    }

    /**
     * すいさい。GPUシミュレーションが使えるときはそちらへ水と顔料を流し込み、
     * 使えない環境では 2D ウェット・ピックアップ描画にフォールバックする。
     */
    watercolor(intersection, prev, color, sizePx) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;

        const sim = getWatercolorSim();
        if (sim) {
            const surface = hit.surface;
            const w = surface.baseCanvas.width;
            const h = surface.baseCanvas.height;
            settleOtherSims(surface, sim);
            sim.attachSurface(surface);
            if (this._wcNeedSnapshot) {
                sim.snapshot();
                this._wcNeedSnapshot = false;
            }
            this._wcUsedSim = true;
            const uv = { x: hit.currPx.x / w, y: 1 - hit.currPx.y / h };
            const prevUv = hit.prevPx
                ? { x: hit.prevPx.x / w, y: 1 - hit.prevPx.y / h }
                : null;
            const brushRgb = sampleColorRgb(color, hit.currPx.x, hit.currPx.y, w, h);
            sim.splat(uv, prevUv, (sizePx / 2) / w, brushRgb);
            return hit.nextPrev;
        }

        return this._watercolor2D(hit, prev, color, sizePx);
    }

    /**
     * 2D フォールバック: 下地の色を拾いながら描く (ウェット・ピックアップ)。
     * 拾った色は KM 混色で筆の色と混ざり、引きずるほど下地の色が乗る。
     * ほぼ白の筆は「水で薄める」扱いにして通常合成 (multiply だと白は無効果のため)。
     */
    _watercolor2D(hit, prev, color, sizePx) {
        const surface = hit.surface;
        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;
        const brushRgb = sampleColorRgb(color, hit.currPx.x, hit.currPx.y, w, h);

        let carried = this._wetColor ?? brushRgb;
        const picked = sampleSurfaceColor(surface, hit.currPx.x, hit.currPx.y, sizePx / 2);
        if (picked) carried = kmMixRgb(carried, picked, WATERCOLOR_PICKUP);
        carried = kmMixRgb(carried, brushRgb, WATERCOLOR_REFRESH);
        this._wetColor = carried;

        const lum = (brushRgb[0] * 0.299 + brushRgb[1] * 0.587 + brushRgb[2] * 0.114);
        const blend = lum > 235 ? 'source-over' : 'multiply';
        watercolorOnSurface(surface, hit.prevPx, hit.currPx, carried, sizePx, blend);
        return hit.nextPrev;
    }

    /**
     * ゆびのばし。GPUワープが使えるときは display を取り込んで引きずり、
     * 使えない環境では下地の色を拾って引き伸ばす2D描画にフォールバックする。
     */
    smudge(intersection, prev, sizePx) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;
        const surface = hit.surface;

        const sim = getSmudgeSim();
        if (sim) {
            settleOtherSims(surface, sim);
            const w = surface.baseCanvas.width;
            const h = surface.baseCanvas.height;
            sim.attachSurface(surface);
            if (this._smNeedSnapshot) {
                sim.snapshot();
                this._smNeedSnapshot = false;
            }
            this._smUsedSim = true;
            const uv = { x: hit.currPx.x / w, y: 1 - hit.currPx.y / h };
            const prevUv = hit.prevPx
                ? { x: hit.prevPx.x / w, y: 1 - hit.prevPx.y / h }
                : null;
            sim.splat(uv, prevUv, (sizePx / 2) / w);
            return hit.nextPrev;
        }

        // 2D フォールバック: 下地の色を拾って進行方向へ引き伸ばす
        const picked = sampleSurfaceColor(surface, hit.currPx.x, hit.currPx.y, sizePx / 2);
        if (picked) {
            this._smearColor = this._smearColor
                ? kmMixRgb(this._smearColor, picked, 0.6)
                : picked;
        }
        if (this._smearColor && hit.prevPx) {
            watercolorOnSurface(surface, hit.prevPx, hit.currPx, this._smearColor, sizePx, 'source-over');
        }
        return hit.nextPrev;
    }

    /**
     * すな。砂を振りかけ、UVの下方向へ流れ落ちて積もる。
     * GPUシミュレーション非対応環境ではスプレーにフォールバック。
     */
    sand(intersection, prev, color, sizePx) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;
        const surface = hit.surface;
        const w = surface.baseCanvas.width;
        const h = surface.baseCanvas.height;

        const sim = getSandSim();
        if (!sim) {
            sprayOnSurface(surface, hit.currPx.x, hit.currPx.y, color, sizePx);
            return hit.nextPrev;
        }

        settleOtherSims(surface, sim);
        sim.attachSurface(surface);
        if (this._sandNeedSnapshot) {
            sim.snapshot();
            this._sandNeedSnapshot = false;
        }
        this._sandUsedSim = true;
        const uv = { x: hit.currPx.x / w, y: 1 - hit.currPx.y / h };
        const prevUv = hit.prevPx
            ? { x: hit.prevPx.x / w, y: 1 - hit.prevPx.y / h }
            : null;
        const rgb = sampleColorRgb(color, hit.currPx.x, hit.currPx.y, w, h);
        sim.splat(uv, prevUv, (sizePx / 2) / w, rgb);
        return hit.nextPrev;
    }

    bristle(intersection, prev, color, sizePx, opacity = 1) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;
        bristleOnSurface(hit.surface, hit.prevPx, hit.currPx, color, sizePx, opacity);
        return hit.nextPrev;
    }

    grass(intersection, prev, color, sizePx, opacity = 1) {
        const hit = this._resolveHit(intersection, prev);
        if (!hit) return prev ?? null;
        grassOnSurface(hit.surface, hit.currPx, color, sizePx, opacity);
        return hit.nextPrev;
    }

    stampShape(intersection, color, sizePx, shape, opacity = 1) {
        const hit = this._resolveHit(intersection, null);
        if (!hit) return;
        stampShapeOnSurface(hit.surface, hit.currPx.x, hit.currPx.y, shape, color, sizePx, opacity);
    }

    endStroke() {
        for (const s of this._getAllSurfaces()) commitStroke(s);
        // ゆびのばしは乾き待ちがないのでストローク終了時に即焼き込む
        if (this._smUsedSim) {
            getSmudgeSim()?.bakeNow();
            this._smUsedSim = false;
        }
    }

    dispose() {
        for (const s of this.surfaces) disposeSurface(s);
        if (this._outline) disposeOutline(this._outline);
        this.geometry.dispose();
    }
}
