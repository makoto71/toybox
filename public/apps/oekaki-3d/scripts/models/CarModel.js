/**
 * Kenney car kit (GLB) を読み込み、freehand描画できるようにするモデル。
 *
 * UV展開の方針:
 *   1. メッシュを toNonIndexed() で三角形ごとに独立化
 *   2. 共有頂点(同位置)を検出し、隣接三角形でかつ法線が近い(dot > 閾値) ものを
 *      Union-Find で連結 → 「チャート」を作る (パネル単位)
 *   3. 各チャートを平均法線に垂直な平面に投影して2D化
 *   4. シェルフパッキングでアトラスに配置
 *
 * ブラシ太さの一貫性:
 *   各メッシュごとに最大可能スケールを求め、モデル内の最小値を「グローバルスケール」
 *   として全メッシュに適用。これによりタイヤと車体で世界座標のブラシ太さが揃う。
 *   小さいメッシュ(タイヤ等)は1024×1024の一部しか使わないが許容。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachOutline, disposeOutline } from '../outline.js';
import {
    createPaintSurface,
    paintOnSurface,
    sprayOnSurface,
    commitStroke,
    clearSurface,
    disposeSurface,
} from './PaintableModel.js';

const loader = new GLTFLoader();
const cache = new Map();

function loadGltf(url) {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
}

const TARGET_SIZE = 2.4;
const TEX_SIZE = 1024;
const NORMAL_DOT_THRESHOLD = 0.85;
const ATLAS_PAD = 0.004;
const TARGET_FILL = 0.55;

/* ---------------- Chart building (no UV/packing yet) ---------------- */

function hashPos(v) {
    return `${v.x.toFixed(5)}|${v.y.toFixed(5)}|${v.z.toFixed(5)}`;
}

function buildCharts(srcGeometry) {
    const geo = srcGeometry.index ? srcGeometry.toNonIndexed() : srcGeometry.clone();
    const pos = geo.attributes.position;
    const triCount = pos.count / 3;

    const posKey = new Array(pos.count);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        posKey[i] = hashPos(tmp);
    }

    const edgeMap = new Map();
    const ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let t = 0; t < triCount; t++) {
        const a = posKey[t * 3];
        const b = posKey[t * 3 + 1];
        const c = posKey[t * 3 + 2];
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            const k = ek(x, y);
            let arr = edgeMap.get(k);
            if (!arr) { arr = []; edgeMap.set(k, arr); }
            arr.push(t);
        }
    }

    const triNormals = new Array(triCount);
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
        v0.fromBufferAttribute(pos, t * 3);
        v1.fromBufferAttribute(pos, t * 3 + 1);
        v2.fromBufferAttribute(pos, t * 3 + 2);
        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        const n = new THREE.Vector3().crossVectors(e1, e2);
        if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
        else n.normalize();
        triNormals[t] = n;
    }

    const parent = new Array(triCount);
    for (let i = 0; i < triCount; i++) parent[i] = i;
    const find = (x) => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
    };

    for (const tris of edgeMap.values()) {
        if (tris.length < 2) continue;
        for (let i = 0; i < tris.length; i++) {
            for (let j = i + 1; j < tris.length; j++) {
                if (triNormals[tris[i]].dot(triNormals[tris[j]]) > NORMAL_DOT_THRESHOLD) {
                    union(tris[i], tris[j]);
                }
            }
        }
    }

    const chartMap = new Map();
    for (let t = 0; t < triCount; t++) {
        const r = find(t);
        let ch = chartMap.get(r);
        if (!ch) {
            ch = { tris: [], avgNormal: new THREE.Vector3() };
            chartMap.set(r, ch);
        }
        ch.tris.push(t);
        ch.avgNormal.add(triNormals[t]);
    }

    const charts = [];
    const triToChart = new Int32Array(triCount);
    const upY = new THREE.Vector3(0, 1, 0);
    const upX = new THREE.Vector3(1, 0, 0);
    for (const ch of chartMap.values()) {
        ch.avgNormal.normalize();
        const n = ch.avgNormal;
        const up = Math.abs(n.y) < 0.9 ? upY : upX;
        ch.tangent = new THREE.Vector3().crossVectors(up, n).normalize();
        ch.bitangent = new THREE.Vector3().crossVectors(n, ch.tangent).normalize();

        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        const vertProj = [];
        for (const t of ch.tris) {
            for (let k = 0; k < 3; k++) {
                const vi = t * 3 + k;
                tmp.fromBufferAttribute(pos, vi);
                const pu = tmp.dot(ch.tangent);
                const pv = tmp.dot(ch.bitangent);
                if (pu < minU) minU = pu;
                if (pu > maxU) maxU = pu;
                if (pv < minV) minV = pv;
                if (pv > maxV) maxV = pv;
                vertProj.push({ vi, pu, pv });
            }
        }
        ch.minU = minU;
        ch.minV = minV;
        ch.w = Math.max(maxU - minU, 1e-3);
        ch.h = Math.max(maxV - minV, 1e-3);
        ch.vertProj = vertProj;

        const chartId = charts.length;
        for (const t of ch.tris) triToChart[t] = chartId;
        charts.push(ch);
    }

    return { geometry: geo, charts, triToChart };
}

/* ---------------- Packing ---------------- */

function packCharts(charts, scale) {
    const sorted = [...charts].sort((a, b) => b.h - a.h);
    const list = [];
    let sx = ATLAS_PAD;
    let sy = ATLAS_PAD;
    let sh = 0;
    for (const c of sorted) {
        const w = c.w * scale;
        const h = c.h * scale;
        if (sx + w + ATLAS_PAD > 1 - ATLAS_PAD) {
            sy += sh + ATLAS_PAD;
            sx = ATLAS_PAD;
            sh = 0;
        }
        if (sy + h + ATLAS_PAD > 1 - ATLAS_PAD) return null;
        list.push({ chart: c, u: sx, v: sy, w, h });
        sx += w + ATLAS_PAD;
        if (h > sh) sh = h;
    }
    return list;
}

function findMaxScale(charts) {
    let totalArea = 0;
    for (const c of charts) totalArea += c.w * c.h;
    if (totalArea <= 0) return 1;
    let scale = Math.sqrt(TARGET_FILL / totalArea);
    for (let attempt = 0; attempt < 30; attempt++) {
        if (packCharts(charts, scale)) return scale;
        scale *= 0.85;
    }
    return scale;
}

function applyPacking(meshInfo, scale) {
    const placements = packCharts(meshInfo.charts, scale) || [];
    const pos = meshInfo.geometry.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (const p of placements) {
        const c = p.chart;
        for (const vp of c.vertProj) {
            const lu = (vp.pu - c.minU) / c.w;
            const lv = (vp.pv - c.minV) / c.h;
            uvs[vp.vi * 2] = p.u + lu * p.w;
            uvs[vp.vi * 2 + 1] = p.v + lv * p.h;
        }
    }
    meshInfo.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/* ---------------- Model ---------------- */

export class CarModel {
    /**
     * @param {{id:string, label:string, url:string}} opts
     */
    constructor({ id, label, url }) {
        this.id = id;
        this.label = label;
        this.url = url;

        this.mesh = new THREE.Group();
        this.mesh.rotation.set(0.15, -0.55, 0);

        this._surfaces = []; // { mesh, canvas, ctx, texture, material, triToChart }
        this.ready = this._load();
    }

    async _load() {
        const gltf = await loadGltf(this.url);
        const root = gltf.scene.clone(true);

        // Pass 1: 各メッシュのチャート構築 + 各メッシュ単独で収まる最大スケール
        const meshInfos = [];
        root.traverse((obj) => {
            if (!obj.isMesh) return;
            const info = buildCharts(obj.geometry);
            const maxScale = findMaxScale(info.charts);
            meshInfos.push({ obj, info, maxScale });
        });
        if (meshInfos.length === 0) return;

        // Pass 2: グローバルスケール = min(各メッシュの最大スケール)
        // → どのメッシュでも世界座標あたりのピクセル数が一定 → ブラシ太さ統一
        let globalScale = Infinity;
        for (const mi of meshInfos) {
            if (mi.maxScale < globalScale) globalScale = mi.maxScale;
        }
        if (!isFinite(globalScale)) globalScale = 1;

        // Pass 3: グローバルスケールでパッキング&UV確定 → 描画用キャンバス/マテリアル
        for (const mi of meshInfos) {
            applyPacking(mi.info, globalScale);
            mi.obj.geometry = mi.info.geometry;

            const paintSurface = createPaintSurface(TEX_SIZE);
            mi.obj.material = paintSurface.material;

            // 塗り絵風アウトライン (細部が出すぎないようにcreaseAngleはやや大きめ)
            const outline = attachOutline(mi.obj, mi.obj.geometry, { creaseAngle: 40, hullScale: 1.03 });

            this._surfaces.push({
                mesh: mi.obj,
                paintSurface,
                outline,
                triToChart: mi.info.triToChart,
            });
        }

        // バウンディングで中央寄せ&スケール正規化
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const s = TARGET_SIZE / (Math.max(size.x, size.y, size.z) || 1);
        root.scale.setScalar(s);
        root.position.set(-center.x * s, -center.y * s, -center.z * s);

        this.mesh.add(root);
    }

    /**
     * @param {THREE.Intersection} intersection
     * @param {{mesh:THREE.Mesh, chartId:number, uv:{x:number,y:number}}|null} prev
     */
    paint(intersection, prev, color, sizePx, opacity = 1) {
        const surface = this._surfaces.find((s) => s.mesh === intersection.object);
        if (!surface) return null;
        const uv = intersection.uv;
        if (!uv) return prev ?? null;

        const ps = surface.paintSurface;
        const w = ps.baseCanvas.width;
        const h = ps.baseCanvas.height;
        const x = uv.x * w;
        const y = (1 - uv.y) * h;

        const chartId = surface.triToChart[intersection.faceIndex];
        const sameChart = prev
            && prev.mesh === surface.mesh
            && prev.chartId === chartId;
        const prevPx = sameChart
            ? { x: prev.uv.x * w, y: (1 - prev.uv.y) * h }
            : null;

        paintOnSurface(ps, prevPx, { x, y }, color, sizePx, opacity);
        return { mesh: surface.mesh, chartId, uv: { x: uv.x, y: uv.y } };
    }

    spray(intersection, color, sizePx) {
        const surface = this._surfaces.find((s) => s.mesh === intersection.object);
        if (!surface) return;
        const uv = intersection.uv;
        if (!uv) return;
        const ps = surface.paintSurface;
        const w = ps.baseCanvas.width;
        const h = ps.baseCanvas.height;
        sprayOnSurface(ps, uv.x * w, (1 - uv.y) * h, color, sizePx);
    }

    endStroke() {
        for (const s of this._surfaces) commitStroke(s.paintSurface);
    }

    clear() {
        for (const s of this._surfaces) clearSurface(s.paintSurface);
    }

    surfaceIndexFor() {
        return 0;
    }

    dispose() {
        for (const s of this._surfaces) {
            disposeSurface(s.paintSurface);
            if (s.outline) disposeOutline(s.outline);
            s.mesh.geometry.dispose();
        }
    }
}
