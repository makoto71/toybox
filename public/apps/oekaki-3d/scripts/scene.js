/**
 * Three.js シーン管理。
 * - 1つのモデルをシーンに表示し、レイキャストで交差を返す
 * - カメラ回転 / dolly は球面座標で自前実装 (入力判別は InputController 側)
 * - OrbitControls は target / 距離制限の保管庫として残し、イベント処理は無効化
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initWatercolorSim } from './watercolor-sim.js';
import { initSmudgeSim } from './smudge-sim.js';
import { initSandSim } from './sand-sim.js';

export class SceneManager {
    /**
     * @param {HTMLElement} container
     */
    constructor(container) {
        this.container = container;

        this.scene = new THREE.Scene();
        // 背景はステージ側のCSS(ドット模様)に任せるため透過
        this.scene.background = null;

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        this.camera.position.set(0, 0.5, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // ドライブモードでの接地影用 (塗りモードでは castShadow なライトがないので影響なし)
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Lights — キーライトでしっかり陰影を作りつつ、塗った色が暗くならない程度の補助
        // ドライブモードからは強度を一時的に変えるので参照を保持
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.05);
        this.scene.add(this.ambientLight);
        this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2e7ee, 0.5);
        this.scene.add(this.hemiLight);
        this.keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
        this.keyLight.position.set(3, 5, 4);
        this.scene.add(this.keyLight);

        // OrbitControls は target/min-max 距離の保管庫として残し、入力は自前で扱う
        // (InputController が一本指/二本指のジェスチャを判別するため)
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enablePan = false;
        this.controls.enableDamping = false;
        this.controls.minDistance = 2.5;
        this.controls.maxDistance = 9;
        this.controls.enabled = false; // イベント処理は無効化(自前で駆動)

        this.raycaster = new THREE.Raycaster();
        this.pointerVec = new THREE.Vector2();
        this.currentModel = null;

        // GPUシミュレーション群 (WebGL2 非対応なら null → 各2Dフォールバック)
        this.watercolorSim = initWatercolorSim(this.renderer);
        this.smudgeSim = initSmudgeSim(this.renderer);
        this.sandSim = initSandSim(this.renderer);

        /** @type {((dt:number) => void) | null} 毎フレーム呼ばれる外部フック (ドライブモード等) */
        this.onUpdate = null;
        this._lastTickTime = 0;
        /** WebXRセッション中は true。描画はXRフレームループ側が行うので通常tickは休止 */
        this.xrSuspended = false;

        this.resize();
        this._tick = this._tick.bind(this);
        this._tick();

        window.addEventListener('resize', () => this.resize());
    }

    async setModel(model) {
        if (this.currentModel) {
            // 濡れた絵の具・砂などが乗ったままモデルを破棄しないように
            this.watercolorSim?.discardWet();
            this.smudgeSim?.discardWet();
            this.sandSim?.discardWet();
            this.scene.remove(this.currentModel.mesh);
            this.currentModel.dispose();
        }
        this.currentModel = model;
        if (!model) return;
        this.scene.add(model.mesh);
        if (model.ready) {
            try { await model.ready; } catch (_) {}
            if (this.currentModel !== model) return; // 切り替えられた
        }
        this._fitCameraToModel();
    }

    /**
     * モデルのバウンディングボックスとビューポートのアスペクト比から
     * カメラ距離を決定し、画面に程よく収まるように位置調整する。
     */
    _fitCameraToModel() {
        if (!this.currentModel) return;
        if (this.cameraLocked) return; // ドライブモード等でカメラを外部管理中
        const box = new THREE.Box3().setFromObject(this.currentModel.mesh);
        if (box.isEmpty()) return;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const fovY = THREE.MathUtils.degToRad(this.camera.fov);
        const aspect = this.camera.aspect || 1;
        const margin = 1.15;
        const distH = (size.y / 2) / Math.tan(fovY / 2);
        const distW = (size.x / 2) / (Math.tan(fovY / 2) * aspect);
        const dist = Math.max(distH, distW) * margin + size.z / 2;

        // 現在の「ターゲット→カメラ」方向を保持して距離だけ調整
        const dir = new THREE.Vector3()
            .subVectors(this.camera.position, this.controls.target);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0.1, 1);
        dir.normalize();

        this.camera.position.copy(center).addScaledVector(dir, dist);
        this.controls.target.copy(center);
        this.controls.minDistance = dist * 0.4;
        this.controls.maxDistance = dist * 2.5;
        this.controls.update();
        this._fittedDistance = dist;
    }

    /**
     * カメラを target を中心に球面座標で回転。
     * @param {number} deltaTheta 横方向(azimuth)の回転 [rad]
     * @param {number} deltaPhi 縦方向(polar)の回転 [rad]
     */
    rotateCamera(deltaTheta, deltaPhi) {
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= deltaTheta;
        sph.phi -= deltaPhi;
        const eps = 1e-3;
        sph.phi = Math.max(eps, Math.min(Math.PI - eps, sph.phi));
        offset.setFromSpherical(sph);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
    }

    /**
     * target からの距離を scale 倍する。<1 で近づく(ズームイン)、>1 で離れる。
     */
    dollyCamera(scale) {
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        const minR = this.controls.minDistance;
        const maxR = this.controls.maxDistance;
        const r = Math.max(minR, Math.min(maxR, offset.length() * scale));
        offset.setLength(r);
        this.camera.position.copy(this.controls.target).add(offset);
    }

    /**
     * canvas の最小辺サイズ。回転量を画面サイズに対して正規化するために使う。
     */
    get viewportShortSide() {
        const rect = this.renderer.domElement.getBoundingClientRect();
        return Math.min(rect.width, rect.height);
    }

    /**
     * @param {number} clientX
     * @param {number} clientY
     * @returns {THREE.Intersection|null}
     */
    raycast(clientX, clientY) {
        if (!this.currentModel) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointerVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointerVec, this.camera);
        const hits = this.raycaster.intersectObject(this.currentModel.mesh, true);
        return hits.length > 0 ? hits[0] : null;
    }

    resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        const newAspect = w / h;
        const aspectChanged = Math.abs(newAspect - this.camera.aspect) > 0.01;
        this.camera.aspect = newAspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
        if (aspectChanged && this.currentModel) {
            this._fitCameraToModel();
        }
    }

    /** レンダラーのcanvasをPNGとして取得 (背景のドット模様も合成) */
    snapshotDataURL() {
        this.renderer.render(this.scene, this.camera);
        const src = this.renderer.domElement;
        const tmp = document.createElement('canvas');
        tmp.width = src.width;
        tmp.height = src.height;
        const ctx = tmp.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.fillStyle = '#f0f4f8';
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        const tile = 16 * dpr;
        const r = 1.1 * dpr;
        ctx.fillStyle = 'rgba(20, 40, 70, 0.10)';
        for (let y = tile / 2; y < tmp.height; y += tile) {
            for (let x = tile / 2; x < tmp.width; x += tile) {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.drawImage(src, 0, 0);
        return tmp.toDataURL('image/png');
    }

    _tick() {
        requestAnimationFrame(this._tick);
        if (this.xrSuspended) {
            this._lastTickTime = 0; // 復帰直後に dt が跳ねないように
            return;
        }
        const now = performance.now();
        const dt = this._lastTickTime ? Math.min(0.1, (now - this._lastTickTime) / 1000) : 0;
        this._lastTickTime = now;
        this.controls.update();
        if (this.onUpdate) this.onUpdate(dt);
        this.watercolorSim?.update(dt);
        this.sandSim?.update(dt);
        this.renderer.render(this.scene, this.camera);
    }
}
