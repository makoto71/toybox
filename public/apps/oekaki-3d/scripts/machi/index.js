/**
 * まちモード: 描いた車が手続き生成の街を自動運転し、それを複数カメラで観察する。
 *
 * - 「はしる」と違い、世界は固定で車自身が道路網を移動する
 * - 街は入るたびにランダムシードで生成され、NPC車も数台走る (Traffic 共有)
 * - 時間帯 (あさ/ゆうがた/よる) を切り替えられる。選択はセッション中保持
 * - 開始時にシーンの状態 (モデル変換・ライティング・カメラ・フォグ・背景・
 *   ピクセル比) をすべて保存し、終了時に復元する
 * - モデルは rig(位置+ヨー) → tilt(ピッチ/ロール/バウンス) の2段グループに
 *   再ペアレントして運転する
 */

import * as THREE from 'three';
import { buildCity } from './city.js';
import { CarDriver, CRUISE, Traffic } from './driver.js';
import { CameraDirector } from './cameras.js';
import { NpcFleet, makeCarLights } from './npc.js';
import { collectWheels, spinWheels, resetWheels } from './wheels.js';
import { mulberry32, makeSkyTexture } from './textures.js';

const MAX_PIXEL_RATIO = 1.8; // モバイル負荷対策

// 時間帯プリセット。fog の色は makeSkyTexture の地平線色と一致させる
export const TIME_PRESETS = {
    asa: {
        label: 'あさ',
        ambient: 0.5, ambientColor: 0xffffff,
        hemi: 0.55, hemiSky: 0xbfd9ff, hemiGround: 0x8f8675,
        key: 1.45, keyColor: 0xfff2da,
        sun: [14, 20, 9],
        fog: [0xdfe8f2, 38, 88],
        night: false, carLights: false, windowGlow: 0,
    },
    yugata: {
        label: 'ゆうがた',
        ambient: 0.42, ambientColor: 0xffdcc2,
        hemi: 0.4, hemiSky: 0xe8a87a, hemiGround: 0x6a5a4a,
        key: 1.2, keyColor: 0xffa45e,
        sun: [-20, 8, 7], // 西日 (長い影)
        fog: [0xeec39a, 36, 85],
        night: false, carLights: true, windowGlow: 0.55,
    },
    yoru: {
        label: 'よる',
        ambient: 0.17, ambientColor: 0x8c9cc8,
        hemi: 0.16, hemiSky: 0x2a3858, hemiGround: 0x1c2026,
        key: 0.32, keyColor: 0xbcccff, // 月明かり
        sun: [12, 18, -8],
        fog: [0x101a2c, 26, 72],
        night: true, carLights: true, windowGlow: 1.0,
    },
};

export class MachiMode {
    /** @param {import('../scene.js').SceneManager} sceneManager */
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.city = null;
        this.rig = null;
        this.tilt = null;
        this.driver = null;
        this.director = null;
        this.traffic = null;
        this.fleet = null;
        this.fleetGroup = null;
        this.carLights = null;
        this.saved = null;
        this.targetModel = null;
        this.shadowedModelMeshes = [];
        this.wheels = [];
        this.elapsed = 0;
        this._aSmooth = 0;
        this._sunTarget = new THREE.Object3D();
        this._sunOffset = new THREE.Vector3(14, 20, 9);
        this._carState = { pos: null, tangent: null, v: 0, cruise: CRUISE };
        /** 時間帯はセッション中保持 (まちを出入りしても選択が残る) */
        this.timeOfDay = 'asa';
        /** @type {Record<string, THREE.Texture>} 時間帯ごとの空 (まち滞在中だけキャッシュ) */
        this._skyTextures = {};
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
            ambientColor: sm.ambientLight.color.clone(),
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

        // ---- 街を構築 (入るたびに別の街になる) ----
        const seed = (Math.random() * 0xffffffff) >>> 0;
        const { group, graph, signals, nightGroup, windowMats } = buildCity(sm.renderer, seed);
        this.city = { group, graph, signals, nightGroup, windowMats };
        sm.scene.add(group);

        // ---- 車の rig ----
        this.rig = new THREE.Group();
        this.tilt = new THREE.Group();
        this.rig.add(this.tilt);
        this.tilt.add(mesh); // シーンから rig 配下へ再ペアレント
        mesh.position.set(-center.x, -box.min.y + 0.02, -center.z);
        sm.scene.add(this.rig);

        // ヘッドライト/テールライト (夕方・夜だけ visible)
        const yawSize = new THREE.Vector3();
        box.getSize(yawSize);
        this.carLights = makeCarLights(yawSize);
        this.tilt.add(this.carLights);

        // ホイール検出 (見つかれば走行に合わせて回す)
        this.wheels = collectWheels(mesh);

        // モデルに影を落とさせる (復元用に記録)
        mesh.traverse((o) => {
            if (o.isMesh && !o.castShadow) {
                o.castShadow = true;
                this.shadowedModelMeshes.push(o);
            }
        });

        // ---- ライティング: シャドウ設定 (強度・色は時間帯プリセットが決める) ----
        const k = sm.keyLight;
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

        // ---- 描画設定 ----
        sm.camera.far = 160;
        sm.camera.updateProjectionMatrix();
        sm.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
        sm.resize();
        sm.controls.minDistance = 0.1;
        sm.controls.maxDistance = 500;

        // ---- 運転手と交通・NPC・カメラ ----
        this.traffic = new Traffic();
        this.driver = new CarDriver(graph, signals, { traffic: this.traffic });
        this.fleetGroup = new THREE.Group();
        sm.scene.add(this.fleetGroup);
        this.fleet = new NpcFleet(this.fleetGroup, graph, signals, this.traffic, mulberry32(seed ^ 0x9E37));
        this.director = new CameraDirector(sm, graph);
        this.director.reset();
        this.rig.position.copy(this.driver.pos);
        this.rig.rotation.y = this.driver.yaw;

        // ---- 時間帯 (空・フォグ・ライト・窓明かり・街灯) ----
        this.setTimeOfDay(this.timeOfDay);

        this.elapsed = 0;
        this._aSmooth = 0;
        sm.cameraLocked = true;
        sm.onUpdate = (dt) => this._update(dt);
    }

    /**
     * 時間帯を切り替える (まちモード中のみ反映。選択は保持される)。
     * @param {'asa'|'yugata'|'yoru'} id
     */
    setTimeOfDay(id) {
        if (!TIME_PRESETS[id]) id = 'asa';
        this.timeOfDay = id;
        if (!this.city) return;
        const sm = this.sceneManager;
        const p = TIME_PRESETS[id];

        sm.ambientLight.intensity = p.ambient;
        sm.ambientLight.color.set(p.ambientColor);
        sm.hemiLight.intensity = p.hemi;
        sm.hemiLight.color.set(p.hemiSky);
        sm.hemiLight.groundColor.set(p.hemiGround);
        sm.keyLight.intensity = p.key;
        sm.keyLight.color.set(p.keyColor);
        this._sunOffset.set(p.sun[0], p.sun[1], p.sun[2]);

        this._skyTextures[id] ??= makeSkyTexture(sm.renderer, id);
        sm.scene.background = this._skyTextures[id];
        sm.scene.fog = new THREE.Fog(p.fog[0], p.fog[1], p.fog[2]);

        this.city.nightGroup.visible = p.night;
        for (const m of this.city.windowMats) {
            m.emissive.set(p.windowGlow > 0 ? 0xffffff : 0x000000);
            m.emissiveIntensity = p.windowGlow > 0 ? p.windowGlow : 1;
        }
        if (this.carLights) this.carLights.visible = p.carLights;
        this.fleet?.setHeadlights(p.carLights);
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
        resetWheels(this.wheels);
        this.wheels = [];

        // NPCとユーザー車のライトを破棄
        this.fleet.dispose();
        sm.scene.remove(this.fleetGroup);
        this.carLights.geometry.dispose();
        this.carLights.material.dispose();

        // 街を破棄
        this.city.group.traverse((o) => {
            if (o.geometry?.dispose) o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of mats) {
                m.map?.dispose?.();
                m.emissiveMap?.dispose?.();
                m.dispose?.();
            }
        });
        sm.scene.remove(this.city.group);
        for (const key of Object.keys(this._skyTextures)) {
            this._skyTextures[key].dispose();
            delete this._skyTextures[key];
        }
        sm.scene.remove(this.rig);
        sm.scene.remove(this._sunTarget);
        this.city = null;
        this.rig = null;
        this.tilt = null;
        this.driver = null;
        this.director = null;
        this.traffic = null;
        this.fleet = null;
        this.fleetGroup = null;
        this.carLights = null;
        this.targetModel = null;

        // シーン状態の復元
        const s = this.saved;
        sm.ambientLight.intensity = s.ambient;
        sm.ambientLight.color.copy(s.ambientColor);
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
        this.fleet.update(dt);

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
        spinWheels(this.wheels, this.driver.dist);

        // 太陽 (シャドウカメラ) を車に追従させる
        this._sunTarget.position.copy(this.driver.pos);
        this.sceneManager.keyLight.position.copy(this.driver.pos).add(this._sunOffset);

        // カメラ
        this._carState.pos = this.driver.pos;
        this._carState.tangent = this.driver.tangent;
        this._carState.v = this.driver.v;
        this.director.update(dt, this._carState);
    }
}
