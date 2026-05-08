/**
 * ドライブモード: モデルを街中で走らせる演出。
 *
 * - モデルは原点付近に固定し、世界(沿道のオブジェクト)を毎フレーム +Z 方向に
 *   スクロールさせて走っているように見せる。後方に到達したら前方に巻き戻して再利用。
 * - 道路は明示的に置かず、オブジェクトの間を走り抜ける形にする (進行方向の通路を空ける)。
 * - モデルの向きはbboxから推定: 長辺がZ方向(縦長 = 多くのGLB車の既定)なら +π 回して
 *   背面をカメラに向ける。長辺がX方向(横向き)なら +π/2 回して進行方向に揃える。
 *   元の回転は stop() で復元。
 * - ドライブ中だけ環境光を絞ってキーライトを強めにし、地面の透明シャドウキャッチャーで
 *   接地影を落として立体感を出す。塗りモード側のライティング/シャドウは変えない。
 */

import * as THREE from 'three';

const SCROLL_SPEED = 8;          // units/sec
const FIELD_LENGTH = 180;         // 前後の総距離
const CORRIDOR_HALF = 4;          // 車が走る通路の半幅
const DECO_SPACING_MIN = 4;
const DECO_SPACING_MAX = 8;
const GROUND_HALF_WIDTH = 30;     // 影を受ける地面の半幅

// ドライブ中のライティング強度
const DRIVE_AMBIENT = 0.35;
const DRIVE_HEMI = 0.35;
const DRIVE_KEY = 1.7;

export class DriveMode {
    /** @param {import('./scene.js').SceneManager} sceneManager */
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.world = null;
        /** @type {THREE.Object3D[]} スクロール対象 */
        this.movers = [];
        this.savedCamera = null;
        this.savedLights = null;
        this.savedModelRotationY = null;
        this.savedModelPosition = null;
        this.savedModelRotationX = null;
        this.baseModelY = 0;
        this.elapsed = 0;
        this.targetModel = null;
        /** モデル側で castShadow を立てたメッシュ (復元用) */
        this.shadowedModelMeshes = [];
    }

    get active() { return !!this.world; }

    start() {
        if (this.world) return;
        const model = this.sceneManager.currentModel;
        if (!model) return;

        // モデルの向きを進行方向(-Z)に合わせる + 底面を y=0 に揃える
        const initialBox = new THREE.Box3().setFromObject(model.mesh);
        if (initialBox.isEmpty()) return;
        const initialSize = new THREE.Vector3();
        initialBox.getSize(initialSize);

        this.targetModel = model;
        this.savedModelRotationY = model.mesh.rotation.y;
        this.savedModelRotationX = model.mesh.rotation.x;
        this.savedModelPosition = model.mesh.position.clone();
        // ほぼ同寸でも判定できるよう余裕は小さめに
        if (initialSize.x > initialSize.z * 1.02) {
            // 横長: 長辺Xを進行方向(-Z)に揃える
            model.mesh.rotation.y += Math.PI * ( 7 / 4) ;
        } else {
            // 縦長/正方: 既定のフロントが+Z向きの想定で π 回して -Z に
            model.mesh.rotation.y += Math.PI * ( 7 / 6) ;
        }
        // 若干X回転
        model.mesh.rotation.x = 0;

        // モデル底面を world y=0 にぴたり接地させる (Y回転は min.y を変えないので
        // 回転前の min.y で補正してOK)
        model.mesh.position.y -= initialBox.min.y + 0.15;
        model.mesh.updateMatrixWorld(true);
        this.baseModelY = model.mesh.position.y;

        // 回転後の bbox で世界とカメラを配置
        const box = new THREE.Box3().setFromObject(model.mesh);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);

        const world = new THREE.Group();
        world.position.set(center.x, 0, center.z);
        this.sceneManager.scene.add(world);
        this.world = world;

        this._buildGround(world);
        this._buildDecorations(world);

        // モデル側のメッシュを影キャスト対象に
        model.mesh.traverse((o) => {
            if (o.isMesh && !o.castShadow) {
                o.castShadow = true;
                this.shadowedModelMeshes.push(o);
            }
        });

        // ライティングを保存して、影で形が読めるよう調整 + キーライトに影を落とさせる
        const a = this.sceneManager.ambientLight;
        const h = this.sceneManager.hemiLight;
        const k = this.sceneManager.keyLight;
        this.savedLights = {
            a: a.intensity,
            h: h.intensity,
            k: k.intensity,
            keyCastShadow: k.castShadow,
        };
        a.intensity = DRIVE_AMBIENT;
        h.intensity = DRIVE_HEMI;
        k.intensity = DRIVE_KEY;
        k.castShadow = true;
        k.shadow.mapSize.set(1024, 1024);
        k.shadow.camera.left = -25;
        k.shadow.camera.right = 25;
        k.shadow.camera.top = 25;
        k.shadow.camera.bottom = -25;
        k.shadow.camera.near = 0.5;
        k.shadow.camera.far = 60;
        k.shadow.bias = -0.0008;
        k.shadow.camera.updateProjectionMatrix();

        // カメラ状態を保存して TPS 視点に切り替える
        const cam = this.sceneManager.camera;
        const ctrls = this.sceneManager.controls;
        this.savedCamera = {
            position: cam.position.clone(),
            target: ctrls.target.clone(),
            minDistance: ctrls.minDistance,
            maxDistance: ctrls.maxDistance,
        };
        const dz = Math.max(2.8, size.z * 2.4 + 1.5);
        const dy = Math.max(1.2, size.y * 1.4);
        ctrls.target.copy(center);
        cam.position.set(center.x, center.y + dy, center.z + dz);
        cam.lookAt(center);
        ctrls.minDistance = Math.max(2, dz * 0.5);
        ctrls.maxDistance = dz * 2.2;

        this.sceneManager.cameraLocked = true;
        this.elapsed = 0;
        this.sceneManager.onUpdate = (dt) => this._update(dt);
    }

    stop() {
        if (!this.world) return;
        this.sceneManager.onUpdate = null;
        this.sceneManager.cameraLocked = false;

        this.world.traverse((o) => {
            if (o.geometry?.dispose) o.geometry.dispose();
            const mat = o.material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
            else mat?.dispose?.();
        });
        this.sceneManager.scene.remove(this.world);
        this.world = null;
        this.movers = [];

        // モデル側に立てた castShadow を復元
        for (const m of this.shadowedModelMeshes) m.castShadow = false;
        this.shadowedModelMeshes = [];

        // ライティング復元
        if (this.savedLights) {
            this.sceneManager.ambientLight.intensity = this.savedLights.a;
            this.sceneManager.hemiLight.intensity = this.savedLights.h;
            this.sceneManager.keyLight.intensity = this.savedLights.k;
            this.sceneManager.keyLight.castShadow = this.savedLights.keyCastShadow;
            this.savedLights = null;
        }

        // モデル回転 / 位置復元
        if (this.targetModel) {
            if (this.savedModelRotationY !== null) {
                this.targetModel.mesh.rotation.y = this.savedModelRotationY;
            }
            if (this.savedModelRotationX !== null) {
                this.targetModel.mesh.rotation.x = this.savedModelRotationX;
            }
            if (this.savedModelPosition) {
                this.targetModel.mesh.position.copy(this.savedModelPosition);
            }
            this.targetModel.mesh.updateMatrixWorld(true);
        }
        this.targetModel = null;
        this.savedModelRotationY = null;
        this.savedModelRotationX = null;
        this.savedModelPosition = null;

        if (this.savedCamera) {
            const cam = this.sceneManager.camera;
            const ctrls = this.sceneManager.controls;
            cam.position.copy(this.savedCamera.position);
            ctrls.target.copy(this.savedCamera.target);
            ctrls.minDistance = this.savedCamera.minDistance;
            ctrls.maxDistance = this.savedCamera.maxDistance;
            cam.lookAt(ctrls.target);
            this.savedCamera = null;
        }
    }

    _update(dt) {
        if (!this.world || dt <= 0) return;
        const ds = SCROLL_SPEED * dt;
        const wrapBack = FIELD_LENGTH / 2;
        const span = FIELD_LENGTH;
        for (const m of this.movers) {
            m.position.z += ds;
            if (m.position.z > wrapBack) m.position.z -= span;
        }

        // 走行中の不規則な揺れ: 異なる周波数のサイン波を重ねて路面の凹凸を擬似再現
        this.elapsed += dt;
        const t = this.elapsed;
        if (this.targetModel) {
            const bounceY = Math.sin(t * 11.0) * 0.018
                          + Math.sin(t * 17.3) * 0.010
                          + Math.sin(t * 27.1) * 0.006;
            const pitch = Math.sin(t * 6.7) * 0.012 + Math.sin(t * 13.1) * 0.006;
            this.targetModel.mesh.position.y = this.baseModelY + bounceY;
            this.targetModel.mesh.rotation.x = 0; //(this.savedModelRotationX ?? 0) + pitch;
        }
    }

    // ---------- 構築 ----------

    /** 透明な地面 (影だけ落ちる) */
    _buildGround(world) {
        const geo = new THREE.PlaneGeometry(GROUND_HALF_WIDTH * 2, FIELD_LENGTH);
        const mat = new THREE.ShadowMaterial({ opacity: 0.22 });
        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        world.add(ground);
    }

    _buildDecorations(world) {
        const rng = mulberry32(0xC0FFEE);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
        for (let z = -FIELD_LENGTH / 2; z < FIELD_LENGTH / 2;
            z += DECO_SPACING_MIN + rng() * (DECO_SPACING_MAX - DECO_SPACING_MIN)) {
            for (const side of [-1, 1]) {
                if (rng() < 0.12) continue; // 隙間
                const x = side * (CORRIDOR_HALF + rng() * 4.5);
                const jz = z + (rng() - 0.5) * 2.5;
                const obj = (rng() < 0.55)
                    ? makeBuilding(rng, mat)
                    : makeTree(rng, mat);
                obj.position.set(x, 0, jz);
                obj.rotation.y = rng() * Math.PI * 2;
                world.add(obj);
                this.movers.push(obj);
            }
        }
    }
}

// ---------- helpers ----------

/** 原点 = 底面中央 になるよう Group でラップして返す */
function makeBuilding(rng, mat) {
    const w = 1.4 + rng() * 2.6;
    const d = 1.4 + rng() * 2.6;
    const h = 1.5 + rng() * 5.5;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    if (rng() < 0.35) {
        const rw = w * (0.3 + rng() * 0.3);
        const rd = d * (0.3 + rng() * 0.3);
        const rh = 0.4 + rng() * 0.8;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd), mat);
        roof.position.set((rng() - 0.5) * (w - rw), h + rh / 2, (rng() - 0.5) * (d - rd));
        roof.castShadow = true;
        roof.receiveShadow = true;
        group.add(roof);
    }
    return group;
}

/** 原点 = 底面 */
function makeTree(rng, mat) {
    const group = new THREE.Group();
    const trunkH = 0.5 + rng() * 0.4;
    const trunkR = 0.13;
    const leafH = 1.0 + rng() * 1.3;
    const leafR = 0.55 + rng() * 0.35;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR, trunkR * 1.1, trunkH, 6), mat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(leafR, leafH, 6), mat);
    leaves.position.y = trunkH + leafH / 2;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(trunk);
    group.add(leaves);
    return group;
}

function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
