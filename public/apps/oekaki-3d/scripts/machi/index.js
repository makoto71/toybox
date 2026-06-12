/**
 * まちモード: 描いた車が手続き生成の街を自動運転し、それを複数カメラで観察する。
 *
 * - 「はしる」と違い、世界は固定で車自身が道路網を移動する
 * - 開始時にシーンの状態 (モデル変換・ライティング・カメラ・フォグ・背景・
 *   ピクセル比) をすべて保存し、終了時に復元する
 * - モデルは rig(位置+ヨー) → tilt(ピッチ/ロール/バウンス) の2段グループに
 *   再ペアレントして運転する
 */

import * as THREE from 'three';
import { buildCity } from './city.js';
import { CarDriver, CRUISE } from './driver.js';
import { CameraDirector } from './cameras.js';

// まち走行中のライティング (昼の屋外)
const MACHI_AMBIENT = 0.5;
const MACHI_HEMI = 0.55;
const MACHI_KEY = 1.45;
const SUN_OFFSET = new THREE.Vector3(14, 20, 9); // 空テクスチャの太陽方向とおおよそ一致
const MAX_PIXEL_RATIO = 1.8; // モバイル負荷対策

export class MachiMode {
    /** @param {import('../scene.js').SceneManager} sceneManager */
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.city = null;
        this.rig = null;
        this.tilt = null;
        this.driver = null;
        this.director = null;
        this.saved = null;
        this.targetModel = null;
        this.shadowedModelMeshes = [];
        this.wheels = [];
        this.elapsed = 0;
        this._aSmooth = 0;
        this._sunTarget = new THREE.Object3D();
        this._carState = { pos: null, tangent: null, v: 0, cruise: CRUISE };
    }

    get active() { return !!this.city; }
    get cameraLabel() { return this.director?.label ?? 'ついせき'; }

    start() {
        if (this.city) return;
        const sm = this.sceneManager;
        const model = sm.currentModel;
        if (!model) return;

        // ---- モデルの向きと接地量を中立姿勢で測る ----
        const mesh = model.mesh;
        const savedRot = mesh.rotation.clone();
        const savedPos = mesh.position.clone();
        mesh.rotation.set(0, 0, 0);
        mesh.position.set(0, 0, 0);
        mesh.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) {
            mesh.rotation.copy(savedRot);
            mesh.position.copy(savedPos);
            return;
        }
        const size = new THREE.Vector3();
        box.getSize(size);
        // 長辺X = 前方が -X 想定 → +Z へ。それ以外 = 前方 +Z 想定
        const meshYaw = (size.x > size.z * 1.02) ? Math.PI / 2 : 0;
        mesh.rotation.set(0, meshYaw, 0);
        mesh.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);

        this.targetModel = model;
        this.saved = {
            rot: savedRot,
            pos: savedPos,
            ambient: sm.ambientLight.intensity,
            hemiIntensity: sm.hemiLight.intensity,
            hemiSky: sm.hemiLight.color.clone(),
            hemiGround: sm.hemiLight.groundColor.clone(),
            keyIntensity: sm.keyLight.intensity,
            keyColor: sm.keyLight.color.clone(),
            keyPos: sm.keyLight.position.clone(),
            keyTarget: sm.keyLight.target,
            keyCastShadow: sm.keyLight.castShadow,
            camPos: sm.camera.position.clone(),
            camTarget: sm.controls.target.clone(),
            camFov: sm.camera.fov,
            camFar: sm.camera.far,
            minDistance: sm.controls.minDistance,
            maxDistance: sm.controls.maxDistance,
            pixelRatio: sm.renderer.getPixelRatio(),
            fog: sm.scene.fog,
            background: sm.scene.background,
        };

        // ---- 街を構築 ----
        const { group, graph, signals, skyTexture } = buildCity(sm.renderer);
        this.city = { group, graph, signals, skyTexture };
        sm.scene.add(group);

        // ---- 車の rig ----
        this.rig = new THREE.Group();
        this.tilt = new THREE.Group();
        this.rig.add(this.tilt);
        this.tilt.add(mesh); // シーンから rig 配下へ再ペアレント
        mesh.position.set(-center.x, -box.min.y + 0.02, -center.z);
        sm.scene.add(this.rig);

        // ホイール検出 (見つかれば走行に合わせて回す)
        this.wheels = [];
        mesh.traverse((o) => {
            if (!o.isMesh && !o.isGroup) return;
            if (!/wheel|tire/i.test(o.name)) return;
            const wb = new THREE.Box3().setFromObject(o);
            if (wb.isEmpty()) return;
            const ws = new THREE.Vector3();
            wb.getSize(ws);
            const radius = Math.max(0.05, ws.y / 2);
            this.wheels.push({ obj: o, radius, baseRotX: o.rotation.x });
        });

        // モデルに影を落とさせる (復元用に記録)
        mesh.traverse((o) => {
            if (o.isMesh && !o.castShadow) {
                o.castShadow = true;
                this.shadowedModelMeshes.push(o);
            }
        });

        // ---- ライティング: 昼の屋外 ----
        sm.ambientLight.intensity = MACHI_AMBIENT;
        sm.hemiLight.intensity = MACHI_HEMI;
        sm.hemiLight.color.set(0xbfd9ff);
        sm.hemiLight.groundColor.set(0x8f8675);
        const k = sm.keyLight;
        k.intensity = MACHI_KEY;
        k.color.set(0xfff2da);
        k.castShadow = true;
        k.shadow.mapSize.set(1024, 1024);
        k.shadow.camera.left = -18;
        k.shadow.camera.right = 18;
        k.shadow.camera.top = 18;
        k.shadow.camera.bottom = -18;
        k.shadow.camera.near = 2;
        k.shadow.camera.far = 80;
        k.shadow.bias = -0.0015;
        k.shadow.camera.updateProjectionMatrix();
        sm.scene.add(this._sunTarget);
        k.target = this._sunTarget;

        // ---- 空・フォグ・描画設定 ----
        sm.scene.background = skyTexture;
        sm.scene.fog = new THREE.Fog(0xdfe8f2, 38, 88);
        sm.camera.far = 160;
        sm.camera.updateProjectionMatrix();
        sm.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
        sm.resize();
        sm.controls.minDistance = 0.1;
        sm.controls.maxDistance = 500;

        // ---- 運転手とカメラ ----
        this.driver = new CarDriver(graph, signals);
        this.director = new CameraDirector(sm, graph);
        this.director.reset();
        this.rig.position.copy(this.driver.pos);
        this.rig.rotation.y = this.driver.yaw;

        this.elapsed = 0;
        this._aSmooth = 0;
        sm.cameraLocked = true;
        sm.onUpdate = (dt) => this._update(dt);
    }

    stop() {
        if (!this.city) return;
        const sm = this.sceneManager;
        sm.onUpdate = null;
        sm.cameraLocked = false;

        // モデルをシーン直下へ戻し、姿勢を復元
        const mesh = this.targetModel?.mesh;
        if (mesh) {
            sm.scene.add(mesh);
            mesh.rotation.copy(this.saved.rot);
            mesh.position.copy(this.saved.pos);
            mesh.updateMatrixWorld(true);
        }
        for (const m of this.shadowedModelMeshes) m.castShadow = false;
        this.shadowedModelMeshes = [];
        for (const w of this.wheels) w.obj.rotation.x = w.baseRotX;
        this.wheels = [];

        // 街を破棄
        this.city.group.traverse((o) => {
            if (o.geometry?.dispose) o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of mats) {
                m.map?.dispose?.();
                m.dispose?.();
            }
        });
        sm.scene.remove(this.city.group);
        this.city.skyTexture.dispose();
        sm.scene.remove(this.rig);
        sm.scene.remove(this._sunTarget);
        this.city = null;
        this.rig = null;
        this.tilt = null;
        this.driver = null;
        this.director = null;
        this.targetModel = null;

        // シーン状態の復元
        const s = this.saved;
        sm.ambientLight.intensity = s.ambient;
        sm.hemiLight.intensity = s.hemiIntensity;
        sm.hemiLight.color.copy(s.hemiSky);
        sm.hemiLight.groundColor.copy(s.hemiGround);
        sm.keyLight.intensity = s.keyIntensity;
        sm.keyLight.color.copy(s.keyColor);
        sm.keyLight.position.copy(s.keyPos);
        sm.keyLight.target = s.keyTarget;
        sm.keyLight.castShadow = s.keyCastShadow;
        sm.scene.fog = s.fog;
        sm.scene.background = s.background;
        sm.camera.fov = s.camFov;
        sm.camera.far = s.camFar;
        sm.camera.updateProjectionMatrix();
        sm.renderer.setPixelRatio(s.pixelRatio);
        sm.resize();
        sm.camera.position.copy(s.camPos);
        sm.controls.target.copy(s.camTarget);
        sm.controls.minDistance = s.minDistance;
        sm.controls.maxDistance = s.maxDistance;
        sm.camera.lookAt(s.camTarget);
        this.saved = null;
    }

    /** @returns {string} 新しいカメララベル */
    cycleCamera() {
        return this.director ? this.director.cycle() : 'ついせき';
    }

    _update(dt) {
        if (!this.city || dt <= 0) return;
        this.elapsed += dt;
        const t = this.elapsed;

        this.city.signals.update(dt);
        this.driver.update(dt);

        // rig: 位置とヨー
        this.rig.position.copy(this.driver.pos);
        this.rig.rotation.y = this.driver.yaw;

        // tilt: 加減速ピッチ + 旋回ロール + 路面バウンス
        this._aSmooth += (this.driver.accel - this._aSmooth) * Math.min(1, dt * 6);
        const lateral = this.driver.v * this.driver.yawRate;
        const speedFactor = 0.25 + 0.75 * Math.min(1, this.driver.v / CRUISE);
        this.tilt.rotation.x = THREE.MathUtils.clamp(-this._aSmooth * 0.018, -0.045, 0.045);
        this.tilt.rotation.z = THREE.MathUtils.clamp(lateral * 0.016, -0.05, 0.05);
        this.tilt.position.y = speedFactor * (
            Math.sin(t * 11.0) * 0.012
            + Math.sin(t * 17.3) * 0.007
            + Math.sin(t * 27.1) * 0.004
        );

        // ホイール回転
        for (const w of this.wheels) {
            w.obj.rotation.x = w.baseRotX + (this.driver.dist / w.radius) % (Math.PI * 2);
        }

        // 太陽 (シャドウカメラ) を車に追従させる
        this._sunTarget.position.copy(this.driver.pos);
        this.sceneManager.keyLight.position.copy(this.driver.pos).add(SUN_OFFSET);

        // カメラ
        this._carState.pos = this.driver.pos;
        this._carState.tangent = this.driver.tangent;
        this._carState.v = this.driver.v;
        this.director.update(dt, this._carState);
    }
}
