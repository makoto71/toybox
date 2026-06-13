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
 * - start() に subject を渡すと、currentModel の代わりに任意の Object3D を置ける
 *   (まちモードのAR投影=裏技 がこれを使う)。
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
        /** @type {{acquire:()=>THREE.Object3D|null, release:()=>void, bounds?:()=>THREE.Box3, onFrame?:(dt:number)=>void, desiredSize?:number}|null} */
        this.subject = null;
        this.saved = null;
        this._addedKeyTarget = false;
        this.shadowedModelMeshes = [];
        this.viewerHitSource = null;
        this.transientHitSource = null;
        this.placed = false;
        this.baseScale = 1;
        this._modelSize = 1;
        /** @type {(() => void)|null} セッション終了後に呼ばれる (お絵描き側の復帰用) */
        this.onEnd = null;

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

    /**
     * @param {object|null} subject 設置対象のカスタム指定 (省略時は currentModel を置く)。
     *   acquire はセッション確立後に呼ばれて対象の Object3D を返し、
     *   release はセッション終了時に必ず呼ばれる (対象を元の場所へ戻す)。
     *   bounds で設置サイズの基準ボックスを差し替えられる (省略時は対象全体)。
     *   onFrame はXRフレームごとに呼ばれる (まちの走行シミュレーション等)。
     */
    async start(subject = null) {
        if (this.active) return;
        let model = null;
        if (!subject) {
            model = this.sceneManager.currentModel;
            if (!model?.mesh) return;
            if (new THREE.Box3().setFromObject(model.mesh).isEmpty()) return;
        }

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
        this.subject = subject;
        session.addEventListener('end', this._onSessionEnd);
        session.addEventListener('select', this._onSelect);

        const renderer = this.sceneManager.renderer;
        this.saved = this._snapshotState(model);
        // AR は現実のカメラ映像が背景になるので、空・フォグは外す (終了時に復元)
        this.sceneManager.scene.background = null;
        this.sceneManager.scene.fog = null;
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        await renderer.xr.setSession(session);
        if (this.session !== session) return; // await中に終了 → _onSessionEnd が復元済み
        this.sceneManager.xrSuspended = true;

        // hit-test ソース (中央レチクル用 + 指ドラッグ用)
        try {
            const viewerSpace = await session.requestReferenceSpace('viewer');
            this.viewerHitSource = await session.requestHitTestSource({ space: viewerSpace });
            this.transientHitSource =
                await session.requestHitTestSourceForTransientInput?.({ profile: 'generic-touchscreen' })
                ?? null;
        } catch (err) {
            if (this.session !== session) return; // セッション終了による失敗は無視してよい
            throw err;
        }

        // セットアップ中の await の最中にセッションが終了 (折りたたみを開く・即とじる等) して
        // いたら、_onSessionEnd が既に走っている。半端な状態を作らずここで中断する。
        if (this.session !== session) return;

        const object = subject ? subject.acquire() : model.mesh;
        const box = object
            ? (subject?.bounds?.() ?? new THREE.Box3().setFromObject(object))
            : null;
        if (!object || box.isEmpty()) {
            // 設置対象が消えていた (許可ダイアログ中にまちを抜けた等) → セッションを畳む
            this.stop();
            return;
        }

        this.targetModel = model;
        this._setupAnchor(object, box, subject?.desiredSize ?? DESIRED_SIZE);
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

    _snapshotState(model) {
        const sm = this.sceneManager;
        const cam = sm.camera;
        const k = sm.keyLight;
        return {
            meshPosition: model ? model.mesh.position.clone() : null,
            cameraPosition: cam.position.clone(),
            keyCastShadow: k.castShadow,
            keyPosition: k.position.clone(),
            background: sm.scene.background,
            fog: sm.scene.fog,
        };
    }

    _setupAnchor(object, box, desiredSize) {
        const size = new THREE.Vector3();
        box.getSize(size);
        const bottomCenter = new THREE.Vector3();
        box.getCenter(bottomCenter);
        bottomCenter.y = box.min.y;
        this._modelSize = Math.max(size.x, size.y, size.z);
        this.baseScale = desiredSize / this._modelSize;

        const anchor = new THREE.Group();
        anchor.add(object); // add が元の親 (scene) からは自動で外す
        object.position.sub(bottomCenter);
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

        // subject 側 (まち等) は影設定済みなので、通常モデルのみ影を付与する
        if (!this.subject) {
            object.traverse((o) => {
                if (o.isMesh && !o.castShadow) {
                    o.castShadow = true;
                    this.shadowedModelMeshes.push(o);
                }
            });
        }
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
        // まちモードのように元から target がシーンに居る場合は、終了時に外さない
        if (k.target.parent !== this.sceneManager.scene) {
            this.sceneManager.scene.add(k.target);
            this._addedKeyTarget = true;
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

        // subject のシミュレーション (まちの車・信号など) を動かし続ける
        this.subject?.onFrame?.(dt);

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

        // --- 最優先: XRレンダリングを止めて通常ループ/カメラへ戻す ---
        // セットアップ用の await 中にセッションが終了すると、この時点では
        // anchor / groundMesh / reticle がまだ null のことがある。途中で例外を
        // 投げて復元 (特にカメラ) を取りこぼさないよう、重要な復元を先に・null安全に行う。
        renderer.setAnimationLoop(null);
        renderer.xr.enabled = false;
        sm.xrSuspended = false;
        this.session = null;

        // XR がカメラの姿勢と射影行列を書き換えているので元に戻す
        if (this.saved) {
            const cam = sm.camera;
            cam.position.copy(this.saved.cameraPosition);
            cam.lookAt(sm.controls.target);
            cam.updateProjectionMatrix();
        }

        // 設置対象をシーン直下に戻して位置を復元 (回転・スケールは anchor 側なので破棄される)
        if (this.subject) {
            this.subject.release();
            this.subject = null;
        } else if (this.targetModel?.mesh) {
            sm.scene.add(this.targetModel.mesh);
            if (this.saved) this.targetModel.mesh.position.copy(this.saved.meshPosition);
            this.targetModel.mesh.updateMatrixWorld(true);
        }
        this.targetModel = null;

        // --- ここから後始末 (どれが null でも安全に飛ばす) ---
        this.viewerHitSource?.cancel?.();
        this.viewerHitSource = null;
        this.transientHitSource?.cancel?.();
        this.transientHitSource = null;

        const overlay = document.getElementById('ar-overlay');
        if (overlay) {
            overlay.removeEventListener('pointerdown', this._onPointerDown);
            overlay.removeEventListener('pointermove', this._onPointerMove);
            overlay.removeEventListener('pointerup', this._onPointerUp);
            overlay.removeEventListener('pointercancel', this._onPointerUp);
            overlay.hidden = true;
        }
        clearTimeout(this._hintTimer);
        this.pointers.clear();
        this.placed = false;
        this._hasDragTarget = false;

        for (const m of this.shadowedModelMeshes) m.castShadow = false;
        this.shadowedModelMeshes = [];

        if (this.anchor) {
            sm.scene.remove(this.anchor);
            this.anchor = null;
        }
        if (this.groundMesh) {
            this.groundMesh.geometry.dispose();
            this.groundMesh.material.dispose();
            this.groundMesh = null;
        }
        if (this.reticle) {
            sm.scene.remove(this.reticle);
            this.reticle.traverse((o) => {
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
            this.reticle = null;
        }

        const k = sm.keyLight;
        if (this.saved) {
            k.castShadow = this.saved.keyCastShadow;
            k.position.copy(this.saved.keyPosition);
            sm.scene.background = this.saved.background;
            sm.scene.fog = this.saved.fog;
        }
        if (this._addedKeyTarget) {
            sm.scene.remove(k.target);
            this._addedKeyTarget = false;
        }
        this.saved = null;

        // お絵描き側の入力状態をリセットさせる (取りこぼしたポインタの後始末)
        this.onEnd?.();
    }
}
