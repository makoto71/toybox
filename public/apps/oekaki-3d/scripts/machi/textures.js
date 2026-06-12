/**
 * まちモード用の動的生成テクスチャ群。
 * 画像ファイルは使わず、すべて Canvas 2D で生成する。
 */

import * as THREE from 'three';

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

function toTexture(canvas, renderer, { repeat = true } = {}) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
    }
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    tex.anisotropy = Math.min(4, maxAniso);
    return tex;
}

/** ピクセル単位のノイズを薄く重ねる */
function addNoise(ctx, w, h, amount, rng) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (rng() - 0.5) * 2 * amount;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
}

export function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** アスファルト: 暗いグレー + 粒状ノイズ + 補修跡 */
export function makeAsphaltTexture(renderer) {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rng = mulberry32(0xA5FA17);
    ctx.fillStyle = '#45484d';
    ctx.fillRect(0, 0, S, S);
    // 大きめの濃淡ムラ
    for (let i = 0; i < 14; i++) {
        const x = rng() * S, y = rng() * S, r = 30 + rng() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = rng() < 0.5;
        g.addColorStop(0, dark ? 'rgba(40,42,46,0.35)' : 'rgba(92,96,102,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
    }
    addNoise(ctx, S, S, 14, rng);
    // 骨材の白い粒
    for (let i = 0; i < 420; i++) {
        const v = 110 + (rng() * 70) | 0;
        ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rng() * 0.3})`;
        ctx.fillRect(rng() * S, rng() * S, 1, 1);
    }
    return toTexture(c, renderer);
}

/** 歩道コンクリート: 明るいグレー + タイル目地 */
export function makeConcreteTexture(renderer) {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rng = mulberry32(0xC0DCBE);
    ctx.fillStyle = '#c3c5c6';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
        const x = rng() * S, y = rng() * S, r = 25 + rng() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rng() < 0.5 ? 'rgba(150,152,154,0.25)' : 'rgba(215,217,218,0.3)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
    }
    addNoise(ctx, S, S, 10, rng);
    // 目地 (1タイル = 128px)
    ctx.strokeStyle = 'rgba(120,123,126,0.85)';
    ctx.lineWidth = 2;
    for (let p = 0; p <= S; p += 128) {
        ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(S, p + 0.5); ctx.stroke();
    }
    return toTexture(c, renderer);
}

/** 草地: 緑のまだらノイズ */
export function makeGrassTexture(renderer) {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rng = mulberry32(0x67A55);
    ctx.fillStyle = '#74a14e';
    ctx.fillRect(0, 0, S, S);
    // ムラは弱めに (タイルリピートが目立たないように)
    for (let i = 0; i < 12; i++) {
        const x = rng() * S, y = rng() * S, r = 25 + rng() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rng() < 0.5 ? 'rgba(95,130,65,0.14)' : 'rgba(135,168,95,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
    }
    addNoise(ctx, S, S, 13, rng);
    // 草の短いストローク
    for (let i = 0; i < 500; i++) {
        const x = rng() * S, y = rng() * S;
        const v = rng();
        ctx.strokeStyle = v < 0.5 ? 'rgba(60,95,40,0.5)' : 'rgba(150,190,105,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 3, y - 1 - rng() * 3);
        ctx.stroke();
    }
    return toTexture(c, renderer);
}

/**
 * 建物の窓テクスチャ (1セル = 1窓×1階分)。
 * 壁はほぼ白で描き、メッシュ側の頂点カラーで色味を付ける。
 * @returns {THREE.Texture[]} 3種類
 */
export function makeWindowTextures(renderer) {
    const S = 128;
    const rng = mulberry32(0x111D0);

    const drawGlass = (ctx, x, y, w, h) => {
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#aac3da');
        g.addColorStop(0.55, '#c8dcec');
        g.addColorStop(1, '#90a8be');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        // 空の映り込みの斜めハイライト
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = 'rgba(235,244,250,0.55)';
        ctx.beginPath();
        ctx.moveTo(x - 10, y + h);
        ctx.lineTo(x + w * 0.45, y - 10);
        ctx.lineTo(x + w * 0.7, y - 10);
        ctx.lineTo(x + 5, y + h);
        ctx.closePath();
        ctx.fill();
        // たまにカーテン/ブラインド
        if (rng() < 0.35) {
            ctx.fillStyle = 'rgba(240,236,224,0.85)';
            ctx.fillRect(x, y, w, h * (0.25 + rng() * 0.4));
        }
        ctx.restore();
    };

    const textures = [];

    // タイプ0: オフィス (大きなガラス + 十字マリオン)
    {
        const c = makeCanvas(S, S);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#f3f1ec';
        ctx.fillRect(0, 0, S, S);
        // 階の境目の影
        ctx.fillStyle = 'rgba(60,60,60,0.12)';
        ctx.fillRect(0, 0, S, 5);
        drawGlass(ctx, 14, 18, 100, 88);
        ctx.strokeStyle = '#8d959c';
        ctx.lineWidth = 4;
        ctx.strokeRect(14, 18, 100, 88);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(64, 106); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14, 62); ctx.lineTo(114, 62); ctx.stroke();
        addNoise(ctx, S, S, 5, rng);
        textures.push(toTexture(c, renderer));
    }

    // タイプ1: マンション (窓 + ベランダ手すり)
    {
        const c = makeCanvas(S, S);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#f1eee8';
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = 'rgba(60,60,60,0.10)';
        ctx.fillRect(0, 0, S, 4);
        drawGlass(ctx, 22, 16, 84, 62);
        ctx.strokeStyle = '#97928a';
        ctx.lineWidth = 3;
        ctx.strokeRect(22, 16, 84, 62);
        ctx.beginPath(); ctx.moveTo(64, 16); ctx.lineTo(64, 78); ctx.stroke();
        // ベランダ
        ctx.fillStyle = 'rgba(70,70,75,0.18)';
        ctx.fillRect(10, 84, 108, 34);
        ctx.fillStyle = '#d8d3c9';
        ctx.fillRect(10, 88, 108, 26);
        ctx.strokeStyle = 'rgba(120,115,105,0.7)';
        ctx.lineWidth = 2;
        for (let x = 14; x < 118; x += 9) {
            ctx.beginPath(); ctx.moveTo(x, 88); ctx.lineTo(x, 114); ctx.stroke();
        }
        ctx.strokeRect(10, 88, 108, 26);
        addNoise(ctx, S, S, 5, rng);
        textures.push(toTexture(c, renderer));
    }

    // タイプ2: 縦長窓が2本 (商業ビル風)
    {
        const c = makeCanvas(S, S);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#efece6';
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = 'rgba(60,60,60,0.12)';
        ctx.fillRect(0, 0, S, 6);
        for (const x of [18, 72]) {
            drawGlass(ctx, x, 20, 38, 88);
            ctx.strokeStyle = '#8a9199';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, 20, 38, 88);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, 64); ctx.lineTo(x + 38, 64); ctx.stroke();
        }
        addNoise(ctx, S, S, 5, rng);
        textures.push(toTexture(c, renderer));
    }

    return textures;
}

/**
 * 空: 縦グラデーション + 太陽/月 + 雲 (equirect でシーン背景に)。
 * 地平線の色は machi/index.js の各時間帯のフォグ色と一致させること。
 * @param {'asa'|'yugata'|'yoru'} time
 */
export function makeSkyTexture(renderer, time = 'asa') {
    const W = 1024, H = 512;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const rng = mulberry32(0x5C4);

    const STOPS = {
        asa: [
            [0.0, '#3f76c4'], [0.30, '#6f9fd8'], [0.48, '#b5cde6'],
            [0.56, '#e6edf4'], [0.62, '#dfe8f2'], [1.0, '#d4dde8'],
        ],
        yugata: [
            [0.0, '#3a4a8a'], [0.26, '#7a6aa6'], [0.42, '#c9849a'],
            [0.52, '#f0a878'], [0.58, '#eec39a'], [1.0, '#d8a884'],
        ],
        yoru: [
            [0.0, '#050a18'], [0.32, '#0a1226'], [0.50, '#0d1628'],
            [0.58, '#101a2c'], [1.0, '#0c1422'],
        ],
    };
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    for (const [p, col] of STOPS[time]) grad.addColorStop(p, col);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (time === 'yoru') {
        // 星 (地平線より上)
        for (let i = 0; i < 240; i++) {
            const x = rng() * W;
            const y = rng() * H * 0.52;
            const r = rng() < 0.12 ? 1.6 : 0.9;
            ctx.fillStyle = `rgba(255,255,255,${0.35 + rng() * 0.6})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 月 + 光彩
        const mx = W * 0.62, my = H * 0.17;
        const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 90);
        halo.addColorStop(0, 'rgba(220,230,255,0.5)');
        halo.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#f2f4e8';
        ctx.beginPath();
        ctx.arc(mx, my, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,190,200,0.45)';
        for (const [ox, oy, or] of [[-7, -4, 5], [6, 7, 4], [3, -8, 3]]) {
            ctx.beginPath();
            ctx.arc(mx + ox, my + oy, or, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // 太陽の光彩 (夕方は低く・大きく・赤く)
        const sx = time === 'yugata' ? W * 0.13 : W * 0.64;
        const sy = time === 'yugata' ? H * 0.46 : H * 0.18;
        const sr = time === 'yugata' ? 180 : 130;
        const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        if (time === 'yugata') {
            sun.addColorStop(0, 'rgba(255,210,150,0.98)');
            sun.addColorStop(0.18, 'rgba(255,170,100,0.65)');
            sun.addColorStop(1, 'rgba(255,160,90,0)');
        } else {
            sun.addColorStop(0, 'rgba(255,252,235,0.95)');
            sun.addColorStop(0.25, 'rgba(255,248,220,0.5)');
            sun.addColorStop(1, 'rgba(255,248,220,0)');
        }
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, W, H);
    }

    // 雲 (楕円の重なり)。夜は少なく薄く、夕方は下面が焼ける
    const cloudCount = time === 'yoru' ? 5 : 15;
    for (let i = 0; i < cloudCount; i++) {
        const cx = rng() * W;
        const cy = H * (0.12 + rng() * 0.32);
        const scale = 0.6 + rng() * 1.3;
        const alpha = (time === 'yoru' ? 0.08 : 0.35) + rng() * (time === 'yoru' ? 0.06 : 0.4);
        const puffs = 4 + (rng() * 4) | 0;
        for (let p = 0; p < puffs; p++) {
            const px = cx + (rng() - 0.5) * 90 * scale;
            const py = cy + (rng() - 0.5) * 18 * scale;
            const rx = (22 + rng() * 30) * scale;
            const ry = rx * (0.32 + rng() * 0.2);
            const g = ctx.createRadialGradient(px, py, 0, px, py, rx);
            if (time === 'yugata') {
                g.addColorStop(0, `rgba(255,225,205,${alpha})`);
                g.addColorStop(0.7, `rgba(245,170,140,${alpha * 0.55})`);
                g.addColorStop(1, 'rgba(245,170,140,0)');
            } else {
                g.addColorStop(0, `rgba(255,255,255,${alpha})`);
                g.addColorStop(0.7, `rgba(252,253,255,${alpha * 0.5})`);
                g.addColorStop(1, 'rgba(255,255,255,0)');
            }
            ctx.save();
            ctx.translate(px, py);
            ctx.scale(1, ry / rx);
            ctx.translate(-px, -py);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, rx, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    const tex = toTexture(c, renderer, { repeat: false });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
}

/**
 * 夜の窓明かり用 emissiveMap (makeWindowTextures の3タイプに対応)。
 * 4x4 窓セル (512px) に、ところどころ灯った窓を描く。
 * texture.repeat = 0.25 を設定済みなので、壁UV (1単位 = 1窓) にそのまま使える。
 * @returns {THREE.Texture[]} 3種類
 */
export function makeNightWindowTextures(renderer) {
    const CELL = 128, GRID = 4, S = CELL * GRID;
    const rng = mulberry32(0x90171);

    // 各タイプのガラス矩形 (makeWindowTextures のセル内座標と一致させる)
    const GLASS_RECTS = [
        [[14, 18, 100, 88]],
        [[22, 16, 84, 62]],
        [[18, 20, 38, 88], [72, 20, 38, 88]],
    ];

    return GLASS_RECTS.map((rects) => {
        const c = makeCanvas(S, S);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, S, S);
        for (let gy = 0; gy < GRID; gy++) {
            for (let gx = 0; gx < GRID; gx++) {
                for (const [x, y, w, h] of rects) {
                    const roll = rng();
                    if (roll > 0.5) continue; // 半分は消灯
                    const dim = roll > 0.32;  // 一部はぼんやり
                    const ox = gx * CELL, oy = gy * CELL;
                    const g = ctx.createLinearGradient(ox + x, oy + y, ox + x, oy + y + h);
                    if (dim) {
                        g.addColorStop(0, '#4a4030');
                        g.addColorStop(1, '#383023');
                    } else {
                        g.addColorStop(0, '#ffd98c');
                        g.addColorStop(1, '#e8a850');
                    }
                    ctx.fillStyle = g;
                    ctx.fillRect(ox + x, oy + y, w, h);
                }
            }
        }
        const tex = toTexture(c, renderer);
        tex.repeat.set(1 / GRID, 1 / GRID);
        return tex;
    });
}

/** 円形グロー (街灯の光だまり・加算合成用) */
export function makeGlowTexture(renderer) {
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c, renderer, { repeat: false });
}
