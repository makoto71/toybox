/**
 * WebXR ARモード (Android Chrome 等の ARCore 対応環境):
 * immersive-ar セッション + hit-test API で現実の床・机の平面を検知し、
 * 塗ったモデルをその上に置く。
 *
 * - カメラ映像の合成は OS (XRコンポジタ) が行う。レンダラーは透過なので
 *   シーンのモデルだけが現実映像の上に描かれる。
 * - 設置フロー: 中央のレチクル (viewer 起点の hit-test) が平面に乗ったらタップで設置。
 * - 設置後のジェスチャ:
 *     1本指ドラッグ → transient-input hit-test で指の下の平面に沿って移動
 *     2本指ピンチ   → 拡大縮小
 *     2本指ひねり   → Y軸回転
 * - UI (もどるボタン・ヒント) は dom-overlay で表示する。
 * - セッション中は SceneManager の通常レンダループを止め、XRフレームループで描画する。
 */

import * as THREE from 'three';

const DESIRED_SIZE = 0.4;    // 初期表示の実寸 (m) — ピンチで変えられる
const SCALE_MIN_MULT = 0.25; // 初期スケールに対する最小倍率
const SCALE_MAX_MULT = 10;   // 同・最大倍率 (巨大化して遊べるように)
const DRAG_LERP = 0.4;       // ドラッグ追従の滑らかさ

const HINT_SEARCHING = 'スマホを ゆっくり うごかして ゆかを うつしてね';
const HINT_READY = 'タップして おこう！';
const HINT_PLACED = 'ゆびで うごかす ・ 2本ゆびで まわす / おおきく';

export async function isWebXRARSupported() {
    if (!navigator.xr?.isSessionSupported) return false;
    try {
        return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
        return false;
    }
}

export class WebXRARMode {
    /** @param {import('./scene.js').SceneManager} sceneManager */
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.session = null;
        /** @type {THREE.Group|null} 底面中央を原点にしたモデルのラッパー */
        this.anchor = null;
        this.reticle = null;
        this.groundMesh = null;
        this.targetModel = null;
        this.saved = null;
        this.shadowedModelMeshes = [];
        this.viewerHitSource = null;
        this.transientHitSource = null;
        this.placed = false;
        this.baseScale = 1;
        this._modelSize = 1;

        /** @type {Map<number, {x:number, y:number}>} */
        this.pointers = new Map();
        this._pinchDist = 0;
        this._pinchAngle = 0;
        this._lastFrameTime = 0;
        this._lightOffset = new THREE.Vector3();
        this._dragTarget = new THREE.Vector3();
        this._hasDragTarget = false;
        this._hintTimer = 0;

        this._onXRFrame = this._onXRFrame.bind(this);
        this._onSelect = this._onSelect.bind(this);
        this._onSessionEnd = this._onSessionEnd.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        const exitBtn = document.getElementById('ar-exit');
        exitBtn?.addEventListener('click', () => this.stop());
    }

    get active() { return !!this.session; }

    async start() {
        if (this.active) return;
        const model = this.sceneManager.currentModel;
        if (!model?.mesh) return;
        const initialBox = new THREE.Box3().setFromObject(model.mesh);
        if (initialBox.isEmpty()) return;

        const overlay = document.getElementById('ar-overlay');
        overlay.hidden = false;
        let session;
        try {
            session = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: overlay },
            });
        } catch (err) {
            overlay.hidden = true;
            throw err;
        }
        this.session = session;
        session.addEventListener('end', this._onSessionEnd);
        session.addEventListener('select', this._onSelect);

        const renderer = this.sceneManager.renderer;
        this.saved = this._snapshotState();
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        await renderer.xr.setSession(session);
        this.sceneManager.xrSuspended = true;

        // hit-test ソース (中央レチクル用 + 指ドラッグ用)
        const viewerSpace = await session.requestReferenceSpace('viewer');
        this.viewerHitSource = await session.requestHitTestSource({ space: viewerSpace });
        this.transientHitSource =
            await session.requestHitTestSourceForTransientInput?.({ profile: 'generic-touchscreen' })
            ?? null;

        this._setupAnchor(model, initialBox);
        this._setupReticle();
        this._setupShadowRig();

        this.placed = false;
        this._hasDragTarget = false;
        this._lastFrameTime = 0;
        this._setHint(HINT_SEARCHING);

        overlay.addEventListener('pointerdown', this._onPointerDown);
        overlay.addEventListener('pointermove', this._onPointerMove);
        overlay.addEventListener('pointerup', this._onPointerUp);
        overlay.addEventListener('pointercancel', this._onPointerUp);

        renderer.setAnimationLoop(this._onXRFrame);
    }

    /** セッション終了を要求する (後始末は 'end' イベントで行う) */
    stop() {
        this.session?.end().catch(() => {});
    }

    // ---------- セットアップ ----------

    _snapshotState() {
        const cam = this.sceneManager.camera;
        const k = this.sceneManager.keyLight;
        return {
            meshPosition: this.sceneManager.currentModel.mesh.position.clone(),
            cameraPosition: cam.position.clone(),
            keyCastShadow: k.castShadow,
            keyPosition: k.position.clone(),
        };
    }

    _setupAnchor(model, box) {
        const size = new THREE.Vector3();
        box.getSize(size);
        const bottomCenter = new THREE.Vector3();
        box.getCenter(bottomCenter);
        bottomCenter.y = box.min.y;
        this._modelSize = Math.max(size.x, size.y, size.z);
        this.baseScale = DESIRED_SIZE / this._modelSize;

        this.targetModel = model;
        const anchor = new THREE.Group();
        anchor.add(model.mesh); // add が元の親 (scene) からは自動で外す
        model.mesh.position.sub(bottomCenter);
        anchor.scale.setScalar(this.baseScale);
        anchor.visible = false; // タップで置くまで非表示
        this.sceneManager.scene.add(anchor);
        this.anchor = anchor;

        // 接地影: anchor の子なので移動・回転・スケールに追従する
        const planeSize = Math.max(size.x, size.z) * 2.5;
        this.groundMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(planeSize, planeSize),
            new THREE.ShadowMaterial({ opacity: 0.3 }),
        );
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.position.y = -0.001;
        this.groundMesh.receiveShadow = true;
        anchor.add(this.groundMesh);

        model.mesh.traverse((o) => {
            if (o.isMesh && !o.castShadow) {
                o.castShadow = true;
                this.shadowedModelMeshes.push(o);
            }
        });
    }

    _setupReticle() {
        const reticle = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 32).rotateX(-Math.PI / 2), mat);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16).rotateX(-Math.PI / 2), mat);
        reticle.add(ring, dot);
        reticle.matrixAutoUpdate = false;
        reticle.visible = false;
        this.sceneManager.scene.add(reticle);
        this.reticle = reticle;
    }

    /** モデルの現在の実寸に合わせてキーライトの影カメラを設定する */
    _setupShadowRig() {
        const k = this.sceneManager.keyLight;
        const ws = this._modelSize * this.anchor.scale.x; // 実寸 (m)
        this._lightOffset.set(ws * 0.8, ws * 2 + 0.5, ws);
        k.castShadow = true;
        k.shadow.mapSize.set(1024, 1024);
        const half = ws * 1.6;
        k.shadow.camera.left = -half;
        k.shadow.camera.right = half;
        k.shadow.camera.top = half;
        k.shadow.camera.bottom = -half;
        k.shadow.camera.near = 0.1;
        k.shadow.camera.far = ws * 8 + 2;
        k.shadow.bias = -0.0008;
        k.shadow.camera.updateProjectionMatrix();
        if (k.target.parent !== this.sceneManager.scene) {
            this.sceneManager.scene.add(k.target);
        }
    }

    // ---------- XRフレームループ ----------

    _onXRFrame(time, frame) {
        const sm = this.sceneManager;
        const dt = this._lastFrameTime ? Math.min(0.1, (time - this._lastFrameTime) / 1000) : 0;
        this._lastFrameTime = time;
        const refSpace = sm.renderer.xr.getReferenceSpace();

        if (frame && refSpace) {
            // 設置前: 中央レチクルを平面に追従させる
            if (!this.placed && this.viewerHitSource) {
                const hits = frame.getHitTestResults(this.viewerHitSource);
                const pose = hits.length ? hits[0].getPose(refSpace) : null;
                if (pose) {
                    if (!this.reticle.visible) this._setHint(HINT_READY);
                    this.reticle.visible = true;
                    this.reticle.matrix.fromArray(pose.transform.matrix);
                } else {
                    if (this.reticle.visible) this._setHint(HINT_SEARCHING);
                    this.reticle.visible = false;
                }
            }

            // 設置後: 1本指の間は指の下の平面へ移動
            if (this.placed && this.transientHitSource && this.pointers.size === 1) {
                const transient = frame.getHitTestResultsForTransientInput(this.transientHitSource);
                if (transient.length && transient[0].results.length) {
                    const pose = transient[0].results[0].getPose(refSpace);
                    if (pose) {
                        const p = pose.transform.position;
                        this._dragTarget.set(p.x, p.y, p.z);
                        this._hasDragTarget = true;
                    }
                }
            }
        }
        if (this._hasDragTarget && this.pointers.size === 1) {
            this.anchor.position.lerp(this._dragTarget, DRAG_LERP);
        }

        // キーライトをモデルに追従させる (影が常に足元に出るように)
        const k = sm.keyLight;
        k.position.copy(this.anchor.position).add(this._lightOffset);
        k.target.position.copy(this.anchor.position);

        sm.watercolorSim?.update(dt);
        sm.sandSim?.update(dt);
        sm.renderer.render(sm.scene, sm.camera);
    }

    // ---------- 設置 (タップ) ----------

    _onSelect() {
        if (this.placed || !this.reticle.visible) return;
        this.anchor.position.setFromMatrixPosition(this.reticle.matrix);
        this.anchor.visible = true;
        this.reticle.visible = false;
        this.placed = true;
        this._setHint(HINT_PLACED, { fadeAfterMs: 4000 });
    }

    // ---------- ジェスチャ (dom-overlay 上のポインタ) ----------

    _onPointerDown(e) {
        if (e.target.closest('button')) return; // もどるボタン等は対象外
        if (this.pointers.size >= 2) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            this._hasDragTarget = false;
            const [a, b] = [...this.pointers.values()];
            this._pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
            this._pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
        }
    }

    _onPointerMove(e) {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size !== 2 || !this.placed) return;

        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);

        if (this._pinchDist > 0 && dist > 0) {
            const sc = THREE.MathUtils.clamp(
                this.anchor.scale.x * (dist / this._pinchDist),
                this.baseScale * SCALE_MIN_MULT,
                this.baseScale * SCALE_MAX_MULT,
            );
            this.anchor.scale.setScalar(sc);
            this._setupShadowRig(); // 実寸が変わるので影の範囲を追従
        }
        // 画面座標は y が下向きなので、ひねり角の符号を反転して上から見た回転に合わせる
        let dAng = ang - this._pinchAngle;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.anchor.rotation.y -= dAng;

        this._pinchDist = dist;
        this._pinchAngle = ang;
    }

    _onPointerUp(e) {
        this.pointers.delete(e.pointerId);
        this._hasDragTarget = false;
    }

    // ---------- ヒント ----------

    _setHint(text, { fadeAfterMs = 0 } = {}) {
        const hint = document.getElementById('ar-hint');
        if (!hint) return;
        clearTimeout(this._hintTimer);
        hint.textContent = text;
        hint.classList.remove('fade');
        if (fadeAfterMs > 0) {
            this._hintTimer = setTimeout(() => hint.classList.add('fade'), fadeAfterMs);
        }
    }

    // ---------- 後始末 (もどるボタン / OSの戻る操作 共通) ----------

    _onSessionEnd() {
        const sm = this.sceneManager;
        const renderer = sm.renderer;

        renderer.setAnimationLoop(null);
        renderer.xr.enabled = false;
        sm.xrSuspended = false;
        this.session = null;
        this.viewerHitSource?.cancel?.();
        this.viewerHitSource = null;
        this.transientHitSource?.cancel?.();
        this.transientHitSource = null;

        const overlay = document.getElementById('ar-overlay');
        overlay.removeEventListener('pointerdown', this._onPointerDown);
        overlay.removeEventListener('pointermove', this._onPointerMove);
        overlay.removeEventListener('pointerup', this._onPointerUp);
        overlay.removeEventListener('pointercancel', this._onPointerUp);
        overlay.hidden = true;
        clearTimeout(this._hintTimer);
        this.pointers.clear();
        this.placed = false;
        this._hasDragTarget = false;

        for (const m of this.shadowedModelMeshes) m.castShadow = false;
        this.shadowedModelMeshes = [];

        // モデルをシーン直下に戻して位置を復元 (回転・スケールは anchor 側なので破棄される)
        if (this.targetModel?.mesh) {
            sm.scene.add(this.targetModel.mesh);
            this.targetModel.mesh.position.copy(this.saved.meshPosition);
            this.targetModel.mesh.updateMatrixWorld(true);
        }
        this.targetModel = null;
        sm.scene.remove(this.anchor);
        this.anchor = null;
        this.groundMesh.geometry.dispose();
        this.groundMesh.material.dispose();
        this.groundMesh = null;

        sm.scene.remove(this.reticle);
        this.reticle.traverse((o) => {
            o.geometry?.dispose?.();
            o.material?.dispose?.();
        });
        this.reticle = null;

        const k = sm.keyLight;
        k.castShadow = this.saved.keyCastShadow;
        k.position.copy(this.saved.keyPosition);
        sm.scene.remove(k.target);

        // XR がカメラの姿勢と射影行列を書き換えているので元に戻す
        const cam = sm.camera;
        cam.position.copy(this.saved.cameraPosition);
        cam.lookAt(sm.controls.target);
        cam.updateProjectionMatrix();
        this.saved = null;
    }
}
