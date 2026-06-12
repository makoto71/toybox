/**
 * まちモードの街構築。
 *
 * 描画コール数を抑えるため、静的ジオメトリは材質ごとに1メッシュへマージし、
 * 街路樹はインスタンシングで描く。テクスチャはすべて textures.js の動的生成。
 *
 * 座標系: 碁盤目の道路網。縦道路 (NS, Z方向に伸びる) が roadsX の各 x に、
 * 横道路 (EW) が roadsZ の各 z に走る。左側通行。
 *
 * seed から道路間隔・街区のタイプ (公園/商店街/ランドマーク)・建物が決まる。
 * 道路網はすべて graph (roads 配列) 経由で driver / cameras と共有されるので、
 * 生成結果と走行ロジックは常に一致する。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    mulberry32,
    makeAsphaltTexture,
    makeConcreteTexture,
    makeGrassTexture,
    makeWindowTextures,
    makeNightWindowTextures,
    makeGlowTexture,
} from './textures.js';

// ---- レイアウト定数 (graph として driver / cameras と共有) ----
const RW = 2.2;                // 車道の半幅
const LANE = 1.1;              // 車線中心の中心線からのオフセット (左側通行)
const STOP = 4.2;              // 停止線の交差点中心からの距離
const SIDEWALK = 1.6;          // 歩道幅
const CURB_H = 0.12;           // 歩道の縁石高さ
const FLOOR_H = 1.7;           // 建物1階分の高さ

const WALL_TINTS = [0xf2efe9, 0xe9e4d8, 0xdfe3e8, 0xead9c8, 0xd9c6b0, 0xc89e87, 0xc3cccf, 0xe5d3d0];
const ROOF_TINTS = [0x9a9da1, 0x8d9094, 0xa8aaac, 0x96918a];
// 商店街の店先 (壁はパステル、ひさしはビビッド)
const SHOP_TINTS = [0xf7e3c8, 0xf0d6d6, 0xd8e8d4, 0xd6e0ef, 0xf3eccf];
const AWNING_TINTS = [0xe05548, 0x2e9e60, 0x3678c8, 0xf0a030, 0xd45f9e, 0x40a8a0];

// ---- ジオメトリヘルパー ----

/** XZ平面の四角形 (上向き)。uvScale 指定時はワールド座標からUVを取る */
function quadXZ(cx, cz, wx, wz, y, uvScale = 0) {
    const g = new THREE.PlaneGeometry(wx, wz);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y, cz);
    if (uvScale > 0) {
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
        }
    }
    return g;
}

function scaleUV(g, su, sv) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return g;
}

function addVertexColor(g, hex) {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
}

/**
 * 建物の壁4面 (屋根・床なし)。底面中心が原点。
 * UV: u = 0..cols (窓の列数), v = 0..floors (階数) → 窓テクスチャをリピート。
 */
function buildingWalls(w, d, h, floors) {
    const colsW = Math.max(1, Math.round(w / 1.4));
    const colsD = Math.max(1, Math.round(d / 1.4));
    const faces = [
        { a: [-w / 2, d / 2], b: [w / 2, d / 2], n: [0, 0, 1], cols: colsW },
        { a: [w / 2, -d / 2], b: [-w / 2, -d / 2], n: [0, 0, -1], cols: colsW },
        { a: [w / 2, d / 2], b: [w / 2, -d / 2], n: [1, 0, 0], cols: colsD },
        { a: [-w / 2, -d / 2], b: [-w / 2, d / 2], n: [-1, 0, 0], cols: colsD },
    ];
    const pos = [], nor = [], uv = [], idx = [];
    let vi = 0;
    for (const f of faces) {
        pos.push(
            f.a[0], 0, f.a[1],
            f.b[0], 0, f.b[1],
            f.b[0], h, f.b[1],
            f.a[0], h, f.a[1],
        );
        for (let k = 0; k < 4; k++) nor.push(f.n[0], f.n[1], f.n[2]);
        uv.push(0, 0, f.cols, 0, f.cols, floors, 0, floors);
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}

// ---- 信号機 ----

const SIGNAL_PHASES = [
    { NS: 'g', EW: 'r', dur: 7.0 },
    { NS: 'y', EW: 'r', dur: 1.5 },
    { NS: 'r', EW: 'r', dur: 1.0 },
    { NS: 'r', EW: 'g', dur: 7.0 },
    { NS: 'r', EW: 'y', dur: 1.5 },
    { NS: 'r', EW: 'r', dur: 1.0 },
];

const LIGHT_ON = {
    g: new THREE.Color(0x00d98a),
    y: new THREE.Color(0xffd23a),
    r: new THREE.Color(0xff4646),
};
const LIGHT_OFF = new THREE.Color(0x232a2e);

class SignalController {
    /**
     * @param {THREE.InstancedMesh} lightsMesh
     * @param {{axis:'NS'|'EW', kind:'g'|'y'|'r'}[]} lightsInfo インスタンス順のメタ
     */
    constructor(lightsMesh, lightsInfo) {
        this.mesh = lightsMesh;
        this.info = lightsInfo;
        this.phaseIndex = 0;
        this.t = 0;
        this._applyColors();
    }

    /** @param {'NS'|'EW'} axis */
    state(axis) {
        return SIGNAL_PHASES[this.phaseIndex][axis];
    }

    update(dt) {
        this.t += dt;
        const dur = SIGNAL_PHASES[this.phaseIndex].dur;
        if (this.t >= dur) {
            this.t -= dur;
            this.phaseIndex = (this.phaseIndex + 1) % SIGNAL_PHASES.length;
            this._applyColors();
        }
    }

    _applyColors() {
        const phase = SIGNAL_PHASES[this.phaseIndex];
        for (let i = 0; i < this.info.length; i++) {
            const { axis, kind } = this.info[i];
            this.mesh.setColorAt(i, phase[axis] === kind ? LIGHT_ON[kind] : LIGHT_OFF);
        }
        this.mesh.instanceColor.needsUpdate = true;
    }
}

// ---- 街の構築本体 ----

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} seed 街の生成シード
 * @returns {{ group: THREE.Group, graph: object, signals: SignalController,
 *             nightGroup: THREE.Group, windowMats: THREE.MeshLambertMaterial[] }}
 */
export function buildCity(renderer, seed = 0x70AD) {
    const rng = mulberry32(seed);
    const group = new THREE.Group();

    // ---- 道路網: 間隔をシードで揺らす (中心が原点になるように配置) ----
    const gaps = [0, 0, 0].map(() => 23 + rng() * 8);
    const total = gaps[0] + gaps[1] + gaps[2];
    const ROADS = [
        -total / 2,
        -total / 2 + gaps[0],
        -total / 2 + gaps[0] + gaps[1],
        total / 2,
    ];
    const ROAD_END = total / 2 + 13; // 道路の端 (市街地の外へ少し伸ばす)

    // 特別な街区 (3x3): 公園は必ず1つ、商店街・ランドマークは公園と重ならない位置
    const blockKeys = [];
    for (let i = 0; i < ROADS.length - 1; i++) {
        for (let j = 0; j < ROADS.length - 1; j++) blockKeys.push({ i, j });
    }
    const pickBlock = () => blockKeys.splice((rng() * blockKeys.length) | 0, 1)[0];
    const parkBlock = pickBlock();
    const shopBlock = pickBlock();
    const landmarkBlock = pickBlock();

    const texAsphalt = makeAsphaltTexture(renderer);
    const texConcrete = makeConcreteTexture(renderer);
    const texGrass = makeGrassTexture(renderer);
    const texWindows = makeWindowTextures(renderer);
    const texNightWindows = makeNightWindowTextures(renderer);
    const texGlow = makeGlowTexture(renderer);

    const matAsphalt = new THREE.MeshLambertMaterial({ map: texAsphalt });
    const matConcrete = new THREE.MeshLambertMaterial({ map: texConcrete });
    const matGrass = new THREE.MeshLambertMaterial({ map: texGrass });
    const matMark = new THREE.MeshLambertMaterial({ color: 0xe9e9e6 });
    const matSteel = new THREE.MeshLambertMaterial({ color: 0x3a4148 });
    // 夜は emissive を白に上げると窓明かりが灯る (emissiveMap は4x4セルでリピート)
    const matWalls = texWindows.map((t, i) => new THREE.MeshLambertMaterial({
        map: t,
        vertexColors: true,
        emissive: 0x000000,
        emissiveMap: texNightWindows[i],
    }));
    const matRoof = new THREE.MeshLambertMaterial({ map: texConcrete, vertexColors: true });
    const matAwning = new THREE.MeshLambertMaterial({ vertexColors: true });

    // --- 地面 (草地) ---
    {
        const ground = new THREE.Mesh(quadXZ(0, 0, 340, 340, -0.03, 0.09), matGrass);
        ground.receiveShadow = true;
        group.add(ground);
    }

    // --- 車道 ---
    const roadGeos = [];
    for (const x of ROADS) {
        roadGeos.push(quadXZ(x, 0, RW * 2, ROAD_END * 2, 0, 0.35)); // 縦道路は全長
    }
    // 横道路は縦道路と重ならない区間だけ敷く (Zファイト回避)
    const xEdges = [-ROAD_END, ...ROADS.flatMap((x) => [x - RW, x + RW]), ROAD_END];
    for (const z of ROADS) {
        for (let k = 0; k < xEdges.length; k += 2) {
            const x0 = xEdges[k], x1 = xEdges[k + 1];
            if (x1 - x0 < 0.01) continue;
            roadGeos.push(quadXZ((x0 + x1) / 2, z, x1 - x0, RW * 2, 0, 0.35));
        }
    }
    {
        const roads = new THREE.Mesh(mergeGeometries(roadGeos), matAsphalt);
        roads.receiveShadow = true;
        group.add(roads);
        roadGeos.forEach((g) => g.dispose());
    }

    // --- 路面標示 (中央線・外側線・停止線・横断歩道) ---
    const markGeos = [];
    const MARK_Y = 0.015;
    // 道路ごとの区間境界: 交差点では STOP+1.4 のマージン、市街端ではそのまま
    const addLineMarks = (isVertical, c) => {
        const bounds = [-ROAD_END, ...ROADS, ROAD_END];
        for (let k = 0; k < bounds.length - 1; k++) {
            const m0 = (k === 0) ? 0.5 : STOP + 1.4;
            const m1 = (k === bounds.length - 2) ? 0.5 : STOP + 1.4;
            const a = bounds[k] + m0;
            const b = bounds[k + 1] - m1;
            if (b - a < 1) continue;
            // 中央の破線
            for (let p = a; p + 1.2 <= b; p += 2.6) {
                markGeos.push(isVertical
                    ? quadXZ(c, p + 0.6, 0.13, 1.2, MARK_Y)
                    : quadXZ(p + 0.6, c, 1.2, 0.13, MARK_Y));
            }
            // 外側線
            for (const side of [-1, 1]) {
                const off = side * (RW - 0.22);
                markGeos.push(isVertical
                    ? quadXZ(c + off, (a + b) / 2, 0.1, b - a, MARK_Y)
                    : quadXZ((a + b) / 2, c + off, b - a, 0.1, MARK_Y));
            }
        }
    };
    for (const x of ROADS) addLineMarks(true, x);
    for (const z of ROADS) addLineMarks(false, z);

    // 交差点ごとの停止線と横断歩道
    const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const nx of ROADS) {
        for (const nz of ROADS) {
            for (const [dx, dz] of DIR4) {
                // 進入方向 d = (dx,dz) で交差点に向かう車向けの停止線。
                // 左側通行: 左 = (dz, -dx) 側の車線半分に引く
                const lx = dz, lz = -dx;
                const slx = nx - dx * STOP + lx * (RW / 2 + 0.05);
                const slz = nz - dz * STOP + lz * (RW / 2 + 0.05);
                markGeos.push(dx === 0
                    ? quadXZ(slx, slz, RW - 0.35, 0.4, MARK_Y)
                    : quadXZ(slx, slz, 0.4, RW - 0.35, MARK_Y));
                // 横断歩道 (交差点の各辺の外側、車道幅いっぱいのゼブラ)
                const bandC = RW + 1.0; // 帯の中心距離
                for (let s = -RW + 0.45; s <= RW - 0.45; s += 0.88) {
                    const cx2 = nx + dx * bandC + lx * s;
                    const cz2 = nz + dz * bandC + lz * s;
                    markGeos.push(dx === 0
                        ? quadXZ(cx2, cz2, 0.45, 1.4, MARK_Y)
                        : quadXZ(cx2, cz2, 1.4, 0.45, MARK_Y));
                }
            }
        }
    }
    {
        const marks = new THREE.Mesh(mergeGeometries(markGeos), matMark);
        marks.receiveShadow = true;
        group.add(marks);
        markGeos.forEach((g) => g.dispose());
    }

    // --- 街区 (歩道スラブ + 建物 or 公園 or 商店街) ---
    const walkGeos = [];
    const wallGeosByType = [[], [], []];
    const roofGeos = [];
    const awningGeos = [];
    const treeSpots = []; // {x, z, y}
    const parkGeos = [];
    let pondMesh = null;

    for (let bi = 0; bi < ROADS.length - 1; bi++) {
        for (let bj = 0; bj < ROADS.length - 1; bj++) {
            const x0 = ROADS[bi] + RW, x1 = ROADS[bi + 1] - RW;
            const z0 = ROADS[bj] + RW, z1 = ROADS[bj + 1] - RW;
            const bw = x1 - x0, bd = z1 - z0;
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            const isPark = (bi === parkBlock.i && bj === parkBlock.j);
            const isShop = (bi === shopBlock.i && bj === shopBlock.j);
            const isLandmark = (bi === landmarkBlock.i && bj === landmarkBlock.j);
            let landmarkPlaced = false;

            // 縁石付きスラブ (公園は草の天面)
            const slab = new THREE.BoxGeometry(bw, CURB_H, bd);
            slab.translate(cx, CURB_H / 2, cz);
            scaleUV(slab, bw * 0.3, bd * 0.3);
            if (isPark) {
                parkGeos.push(slab);
            } else {
                walkGeos.push(slab);
            }

            // 歩道の街路樹 (街区の外周、角を避けて)
            for (let t = -bw / 2 + 3; t <= bw / 2 - 3; t += 6.5) {
                if (rng() < 0.3) continue;
                treeSpots.push({ x: cx + t + (rng() - 0.5), z: z0 + 0.75, y: CURB_H });
                if (rng() < 0.7) treeSpots.push({ x: cx + t + (rng() - 0.5), z: z1 - 0.75, y: CURB_H });
            }

            if (isPark) {
                // 公園: 池 + 木々
                pondMesh = new THREE.Mesh(
                    quadXZ(
                        cx + (rng() - 0.5) * 4, cz + (rng() - 0.5) * 4,
                        5.5 + rng() * 3, 4.5 + rng() * 3,
                        CURB_H + 0.012,
                    ),
                    new THREE.MeshLambertMaterial({ color: 0x5ba3cf }),
                );
                pondMesh.receiveShadow = true;
                group.add(pondMesh);
                for (let t = 0; t < 12; t++) {
                    treeSpots.push({
                        x: cx + (rng() - 0.5) * (bw - 4),
                        z: cz + (rng() - 0.5) * (bd - 4),
                        y: CURB_H,
                    });
                }
                continue;
            }

            // 建物: 街区を4分割して配置 (一部は空けて中庭に)
            const distCenter = Math.hypot(cx, cz);
            for (const qx of [-1, 1]) {
                for (const qz of [-1, 1]) {
                    if (!isShop && rng() < 0.13) continue;
                    const lotW = bw / 2 - SIDEWALK, lotD = bd / 2 - SIDEWALK;
                    const w = 5.2 + rng() * (lotW - 5.6);
                    const d = 5.2 + rng() * (lotD - 5.6);
                    // 街の中心ほど高層に。商店街は低層、ランドマーク街区は1棟だけ高層タワー
                    const bonus = Math.max(0, 5 - distCenter / 8);
                    let floors = Math.max(2, Math.round(2 + rng() * 3 + rng() * bonus));
                    if (isShop) floors = 1 + (rng() < 0.35 ? 1 : 0);
                    if (isLandmark && !landmarkPlaced) {
                        floors = 8 + ((rng() * 4) | 0);
                        landmarkPlaced = true;
                    }
                    const h = floors * FLOOR_H;
                    // 歩道側に寄せ気味に配置
                    const px = cx + qx * (bw / 2 - SIDEWALK - w / 2 - 0.4 - rng() * 1.2);
                    const pz = cz + qz * (bd / 2 - SIDEWALK - d / 2 - 0.4 - rng() * 1.2);

                    const type = isShop ? 2 : (rng() * 3) | 0;
                    const tint = isShop
                        ? SHOP_TINTS[(rng() * SHOP_TINTS.length) | 0]
                        : WALL_TINTS[(rng() * WALL_TINTS.length) | 0];
                    const walls = buildingWalls(w, d, h, floors);
                    walls.translate(px, CURB_H, pz);
                    addVertexColor(walls, tint);
                    wallGeosByType[type].push(walls);

                    // 商店街: 歩道側 (街区の外周向き) にビビッドなひさし
                    if (isShop) {
                        const awnTint = AWNING_TINTS[(rng() * AWNING_TINTS.length) | 0];
                        const awnY = CURB_H + FLOOR_H * 0.92;
                        const awnZ = new THREE.BoxGeometry(w * 0.9, 0.09, 0.85);
                        awnZ.translate(px, awnY, pz + qz * (d / 2 + 0.32));
                        addVertexColor(awnZ, awnTint);
                        awningGeos.push(awnZ);
                        const awnX = new THREE.BoxGeometry(0.85, 0.09, d * 0.9);
                        awnX.translate(px + qx * (w / 2 + 0.32), awnY, pz);
                        addVertexColor(awnX, awnTint);
                        awningGeos.push(awnX);
                    }

                    const roofTint = ROOF_TINTS[(rng() * ROOF_TINTS.length) | 0];
                    const roof = quadXZ(px, pz, w, d, CURB_H + h);
                    scaleUV(roof, w * 0.25, d * 0.25);
                    addVertexColor(roof, roofTint);
                    roofGeos.push(roof);

                    // 屋上の設備 (高めのビルのみ)
                    if (floors >= 4) {
                        const units = 1 + ((rng() * 2) | 0);
                        for (let u = 0; u < units; u++) {
                            const uw = 0.9 + rng() * 1.1, ud = 0.8 + rng() * 1.0, uh = 0.5 + rng() * 0.7;
                            const box = new THREE.BoxGeometry(uw, uh, ud);
                            box.translate(
                                px + (rng() - 0.5) * (w - uw - 0.8),
                                CURB_H + h + uh / 2,
                                pz + (rng() - 0.5) * (d - ud - 0.8),
                            );
                            scaleUV(box, 0.5, 0.5);
                            addVertexColor(box, 0x8d9094);
                            roofGeos.push(box);
                        }
                    }
                }
            }
        }
    }

    {
        const walk = new THREE.Mesh(mergeGeometries(walkGeos), matConcrete);
        walk.receiveShadow = true;
        group.add(walk);
        walkGeos.forEach((g) => g.dispose());

        if (parkGeos.length) {
            const park = new THREE.Mesh(mergeGeometries(parkGeos), matGrass);
            park.receiveShadow = true;
            group.add(park);
            parkGeos.forEach((g) => g.dispose());
        }

        wallGeosByType.forEach((geos, i) => {
            if (!geos.length) return;
            const m = new THREE.Mesh(mergeGeometries(geos), matWalls[i]);
            m.castShadow = true;
            m.receiveShadow = true;
            group.add(m);
            geos.forEach((g) => g.dispose());
        });

        const roofs = new THREE.Mesh(mergeGeometries(roofGeos), matRoof);
        roofs.castShadow = true;
        roofs.receiveShadow = true;
        group.add(roofs);
        roofGeos.forEach((g) => g.dispose());

        if (awningGeos.length) {
            const awnings = new THREE.Mesh(mergeGeometries(awningGeos), matAwning);
            awnings.castShadow = true;
            group.add(awnings);
            awningGeos.forEach((g) => g.dispose());
        }
    }

    // --- 郊外の木 (市街地の外周、フォグに溶ける) ---
    for (let t = 0; t < 70; t++) {
        const ang = rng() * Math.PI * 2;
        const r = ROAD_END - 5 + rng() * 35;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        // 道路の延長線上は避ける
        let nearRoad = false;
        for (const rc of ROADS) {
            if (Math.abs(x - rc) < 3.6 || Math.abs(z - rc) < 3.6) { nearRoad = true; break; }
        }
        if (nearRoad) continue;
        treeSpots.push({ x, z, y: 0 });
    }

    // --- 街路樹 (インスタンシング) ---
    {
        const n = treeSpots.length;
        const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1.2, 5);
        const leafGeo = new THREE.IcosahedronGeometry(0.85, 1);
        const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6e553c }), n);
        const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const eu = new THREE.Euler();
        const sc = new THREE.Vector3();
        const pv = new THREE.Vector3();
        const col = new THREE.Color();
        for (let i = 0; i < n; i++) {
            const t = treeSpots[i];
            const sx = 0.85 + rng() * 0.5;
            const sy = 0.95 + rng() * 0.65;
            q.setFromEuler(eu.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.12));
            m.compose(pv.set(t.x, t.y + 0.6, t.z), q, sc.set(1, 1, 1));
            trunks.setMatrixAt(i, m);
            m.compose(pv.set(t.x, t.y + 1.15 + sy * 0.55, t.z), q, sc.set(sx, sy, sx));
            leaves.setMatrixAt(i, m);
            col.setHSL(0.26 + rng() * 0.08, 0.45 + rng() * 0.15, 0.3 + rng() * 0.12);
            leaves.setColorAt(i, col);
        }
        trunks.castShadow = true;
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        group.add(trunks);
        group.add(leaves);
    }

    // --- 街灯 (区間の中間地点) + 信号機の柱 → 1メッシュにマージ ---
    const steelGeos = [];
    const lampHeads = []; // {x, y, z} 夜の点灯表現用
    /** 柱 + 車道側に伸びるアーム + 灯具。(ax, az) = アームを伸ばす方向 (単位) */
    const addLamp = (x, z, ax, az) => {
        const pole = new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6);
        pole.translate(x, 1.7, z);
        steelGeos.push(pole);
        const arm = new THREE.BoxGeometry(ax !== 0 ? 1.0 : 0.07, 0.07, ax !== 0 ? 0.07 : 1.0);
        arm.translate(x + ax * 0.5, 3.35, z + az * 0.5);
        steelGeos.push(arm);
        const head = new THREE.BoxGeometry(ax !== 0 ? 0.42 : 0.16, 0.1, ax !== 0 ? 0.16 : 0.42);
        head.translate(x + ax * 0.95, 3.29, z + az * 0.95);
        steelGeos.push(head);
        lampHeads.push({ x: x + ax * 0.95, y: 3.22, z: z + az * 0.95 });
    };
    for (let k = 0; k < ROADS.length - 1; k++) {
        const mid = (ROADS[k] + ROADS[k + 1]) / 2;
        for (const c of ROADS) {
            for (const side of [-1, 1]) {
                // 縦道路 (x = c) 沿いと横道路 (z = c) 沿いの両側
                addLamp(c + side * (RW + 0.55), mid, -side, 0);
                addLamp(mid, c + side * (RW + 0.55), 0, -side);
            }
        }
    }

    // --- 信号機 (柱 + アーム + 灯器筐体はマージ、ランプはインスタンシング) ---
    const lightsInfo = [];
    const lightPositions = [];
    for (const nx of ROADS) {
        for (const nz of ROADS) {
            for (const [dx, dz] of DIR4) {
                const lx = dz, lz = -dx; // 進行方向 d の左
                const axis = (dx === 0) ? 'NS' : 'EW';
                // 交差点を渡った先・左側歩道の角に柱を立て、車線上空へアームを伸ばす
                const bx = nx + dx * (RW + 1.0) + lx * (RW + 0.8);
                const bz = nz + dz * (RW + 1.0) + lz * (RW + 0.8);
                const hx = nx + dx * (RW + 1.0) + lx * LANE; // 灯器位置 (車線上)
                const hz = nz + dz * (RW + 1.0) + lz * LANE;

                const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.45, 6);
                pole.translate(bx, 1.725, bz);
                steelGeos.push(pole);

                const armLen = Math.hypot(bx - hx, bz - hz);
                const arm = new THREE.BoxGeometry(
                    (dx === 0) ? armLen : 0.08, 0.08, (dx === 0) ? 0.08 : armLen);
                arm.translate((bx + hx) / 2, 3.4, (bz + hz) / 2);
                steelGeos.push(arm);

                // 灯器筐体: 横長、面の法線 = -d (進入車向き)
                const housing = new THREE.BoxGeometry(
                    (dx === 0) ? 0.82 : 0.24, 0.3, (dx === 0) ? 0.24 : 0.82);
                housing.translate(hx, 3.1, hz);
                steelGeos.push(housing);

                // ランプ3灯: 進入車から見て左から 青・黄・赤
                for (let k = 0; k < 3; k++) {
                    const o = (1 - k) * 0.25; // +left → 0 → -left
                    lightPositions.push(new THREE.Vector3(
                        hx + lx * o - dx * 0.135,
                        3.1,
                        hz + lz * o - dz * 0.135,
                    ));
                    lightsInfo.push({ axis, kind: ['g', 'y', 'r'][k] });
                }
            }
        }
    }
    {
        const steel = new THREE.Mesh(mergeGeometries(steelGeos.map((g) => {
            if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
            return g;
        })), matSteel);
        steel.castShadow = true;
        group.add(steel);
        steelGeos.forEach((g) => g.dispose());
    }

    const lightsMesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.088, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        lightPositions.length,
    );
    {
        const m = new THREE.Matrix4();
        for (let i = 0; i < lightPositions.length; i++) {
            m.makeTranslation(lightPositions[i].x, lightPositions[i].y, lightPositions[i].z);
            lightsMesh.setMatrixAt(i, m);
            lightsMesh.setColorAt(i, LIGHT_OFF);
        }
    }
    group.add(lightsMesh);

    const signals = new SignalController(lightsMesh, lightsInfo);

    // --- 夜だけ表示するグループ (街灯の電球 + 路面の光だまり) ---
    const nightGroup = new THREE.Group();
    nightGroup.visible = false;
    {
        const bulbs = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.09, 6, 5),
            new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
            lampHeads.length,
        );
        const m = new THREE.Matrix4();
        for (let i = 0; i < lampHeads.length; i++) {
            m.makeTranslation(lampHeads[i].x, lampHeads[i].y, lampHeads[i].z);
            bulbs.setMatrixAt(i, m);
        }
        nightGroup.add(bulbs);

        const poolGeos = lampHeads.map((p) => quadXZ(p.x, p.z, 4.6, 4.6, 0.035));
        const pools = new THREE.Mesh(mergeGeometries(poolGeos), new THREE.MeshBasicMaterial({
            map: texGlow,
            color: 0xffc97a,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        nightGroup.add(pools);
        poolGeos.forEach((g) => g.dispose());
    }
    group.add(nightGroup);

    const graph = {
        roads: ROADS,
        RW,
        LANE,
        STOP,
        curbH: CURB_H,
        roadEnd: ROAD_END,
    };

    return { group, graph, signals, nightGroup, windowMats: matWalls };
}
