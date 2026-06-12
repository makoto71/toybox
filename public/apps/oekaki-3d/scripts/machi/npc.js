/**
 * まちモードのNPC車両。
 *
 * models/ のGLBをそのまま (ペイント加工なしで) 読み込み、ユーザー車と同じ
 * CarDriver で道路網を走らせる。Traffic を共有するので車間維持・交差点の
 * 譲り合いが効く。GLBのジオメトリ/マテリアルはモジュールキャッシュ共有なので
 * dispose では破棄しない (再入時に再利用される)。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CarDriver, CRUISE, DIRS } from './driver.js';

// Kenney系GLB (sedan等) は外部テクスチャ Textures/colormap.png を参照していて
// リポジトリに同梱していないため、色がマテリアルに埋め込まれたモデルだけ使う
const NPC_FILES = [
    'suv.glb', 'van.glb', 'schoolbus.glb', 'dump-truck.glb', 'police2.glb',
];
const NPC_COUNT = 5;
const NPC_SIZE = 2.3; // ユーザー車 (CarModel TARGET_SIZE 2.4) と同程度

const loader = new GLTFLoader();
const cache = new Map();

function loadGltf(url) {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
}

/**
 * ヘッドライト + テールライトのメッシュ (夜・夕方に visible にする)。
 * 車体ローカル空間で前方 = +Z、接地面 = y0 を前提とする。
 * @param {THREE.Vector3} size 車体バウンディングサイズ
 * @param {number} y0 接地オフセット
 */
export function makeCarLights(size, y0 = 0.02) {
    const geos = [];
    const addBulb = (x, y, z, r, hex) => {
        const g = new THREE.SphereGeometry(r, 6, 5);
        g.translate(x, y, z);
        const col = new THREE.Color(hex);
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            arr[i * 3] = col.r;
            arr[i * 3 + 1] = col.g;
            arr[i * 3 + 2] = col.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        geos.push(g);
    };
    const y = y0 + size.y * 0.32;
    for (const sx of [-1, 1]) {
        addBulb(sx * size.x * 0.3, y, size.z / 2 + 0.04, 0.062, 0xfff6d0);
        addBulb(sx * size.x * 0.3, y, -size.z / 2 - 0.03, 0.046, 0xff3b30);
    }
    const mesh = new THREE.Mesh(
        mergeGeometries(geos),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
    );
    geos.forEach((g) => g.dispose());
    mesh.visible = false;
    return mesh;
}

export class NpcFleet {
    /**
     * @param {THREE.Group} parent NPCを入れる親グループ (シーン直下を想定)
     * @param {object} graph buildCity の道路グラフ
     * @param {object} signals SignalController
     * @param {import('./driver.js').Traffic} traffic
     * @param {() => number} rng シード済み乱数
     */
    constructor(parent, graph, signals, traffic, rng) {
        this.parent = parent;
        this.graph = graph;
        this.signals = signals;
        this.traffic = traffic;
        this.disposed = false;
        /** @type {{rig:THREE.Group, driver:CarDriver, wheels:object[], lights:THREE.Mesh}[]} */
        this.cars = [];
        this._lightsOn = false;
        this._spawn(rng);
    }

    _spawn(rng) {
        // スタート候補: グリッド外に出ない (ノード, 方向) の全組み合わせから
        // ノード重複なしで選ぶ。ユーザー車の初期レッグ (0,1)→(1,1) は避ける
        const n = this.graph.roads.length;
        const cands = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                for (const d of DIRS) {
                    const ti = i + d.dx, tj = j + d.dz;
                    if (ti < 0 || tj < 0 || ti >= n || tj >= n) continue;
                    cands.push({ node: { i, j }, dir: d });
                }
            }
        }
        const usedNodes = new Set(['0,1', '1,1']);
        const starts = [];
        while (starts.length < NPC_COUNT && cands.length > 0) {
            const c = cands.splice((rng() * cands.length) | 0, 1)[0];
            const key = `${c.node.i},${c.node.j}`;
            if (usedNodes.has(key)) continue;
            usedNodes.add(key);
            starts.push(c);
        }

        const files = [...NPC_FILES];
        for (const start of starts) {
            const file = files.splice((rng() * files.length) | 0, 1)[0];
            this._add(file, start, rng());
        }
    }

    async _add(file, start, speedRoll) {
        let gltf;
        try {
            gltf = await loadGltf(`models/${file}`);
        } catch (err) {
            console.warn('NPC load failed:', file, err);
            return;
        }
        if (this.disposed) return;

        const root = gltf.scene.clone(true);

        // 正規化: 大きさを揃え、長辺X = 前方 -X 想定 → +Z へ向ける
        let box = new THREE.Box3().setFromObject(root);
        if (box.isEmpty()) return;
        const rawSize = new THREE.Vector3();
        box.getSize(rawSize);
        const s = NPC_SIZE / (Math.max(rawSize.x, rawSize.y, rawSize.z) || 1);
        root.scale.setScalar(s);
        root.rotation.y = (rawSize.x > rawSize.z * 1.02) ? Math.PI / 2 : 0;
        root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const rig = new THREE.Group();
        root.position.set(-center.x, -box.min.y + 0.02, -center.z);
        rig.add(root);

        const wheels = [];
        root.traverse((o) => {
            if (o.isMesh) o.castShadow = true;
            if (!o.isMesh && !o.isGroup) return;
            if (!/wheel|tire/i.test(o.name)) return;
            const wb = new THREE.Box3().setFromObject(o);
            if (wb.isEmpty()) return;
            const ws = new THREE.Vector3();
            wb.getSize(ws);
            wheels.push({ obj: o, radius: Math.max(0.05, ws.y / 2), baseRotX: o.rotation.x });
        });

        const lights = makeCarLights(size);
        lights.visible = this._lightsOn;
        rig.add(lights);

        const driver = new CarDriver(this.graph, this.signals, {
            traffic: this.traffic,
            startNode: start.node,
            startDir: start.dir,
            cruise: CRUISE * (0.78 + speedRoll * 0.3), // 個体差で流れに緩急を
        });
        rig.position.copy(driver.pos);
        rig.rotation.y = driver.yaw;

        this.parent.add(rig);
        this.cars.push({ rig, driver, wheels, lights });
    }

    update(dt) {
        for (const car of this.cars) {
            car.driver.update(dt);
            car.rig.position.copy(car.driver.pos);
            car.rig.rotation.y = car.driver.yaw;
            for (const w of car.wheels) {
                w.obj.rotation.x = w.baseRotX + (car.driver.dist / w.radius) % (Math.PI * 2);
            }
        }
    }

    setHeadlights(on) {
        this._lightsOn = on;
        for (const car of this.cars) car.lights.visible = on;
    }

    dispose() {
        this.disposed = true;
        for (const car of this.cars) {
            car.driver.detach();
            this.parent.remove(car.rig);
            // GLB由来のジオメトリ/マテリアルはキャッシュ共有なので破棄しない。
            // 自前生成のライトだけ破棄する
            car.lights.geometry.dispose();
            car.lights.material.dispose();
        }
        this.cars = [];
    }
}
