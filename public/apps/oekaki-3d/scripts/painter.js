/**
 * 統合入力コントローラ。
 *
 * モード切り替えはなく、タップ位置とジェスチャから動作を決める:
 *   - 1本指: モデルにヒット → 描画 / 外側 → 回転(orbit)
 *   - 2本指: 一定時間 / 累積移動量を見て分類
 *       - 指間距離が大きく変化   → ピンチ(拡大縮小)
 *       - 指間が近い + 同方向移動 → 二本指回転
 *       - それ以外(子供の意図せぬ接触など) → 2本目を無視して 1本指の動作継続
 *     回転 / ピンチに切り替わった時、進行中ストロークは cancelStroke で取り消す。
 *
 * けしごむは廃止し、白色を選択することで代替する。
 */

const PEN_OPACITY = 0.6;
const SPRAY_SIZE_MULT = 4;
const PATTERN_INTERVAL_MULT = 1.4;
const GLITTER_SIZE_MULT = 1.8;

// 2本指ジェスチャの分類しきい値
const CLASSIFY_TIME_MS = 150;          // この時間が経つか…
const CLASSIFY_MIN_MOVE_PX = 8;        // …累積移動がこれを超えたら判定実行
const CLASSIFY_TIMEOUT_MS = 500;       // この時間動きが小さければ「無視」確定
const PINCH_RATIO_THRESHOLD = 0.08;    // 指間距離 8% 以上の変化でピンチ
const TWO_FINGER_NEAR_RATIO = 0.35;    // 短辺 * 0.35 以内で「近い」
const VELOCITY_COS_THRESHOLD = 0.7;    // 速度ベクトルの cos類似度 (≒ 同方向)
const ROTATE_GAIN = Math.PI;           // 短辺いっぱいドラッグで ~180度
const PINCH_GAIN = 1.0;                // 距離比をそのまま dolly scale に

export class Painter {
    /**
     * @param {HTMLElement} target レンダラーcanvas (イベントを受ける要素)
     * @param {import('./scene.js').SceneManager} scene
     * @param {() => {color:any, size:number, tool:'pen'|'spray'}} getState
     */
    constructor(target, scene, getState) {
        this.target = target;
        this.scene = scene;
        this.getState = getState;

        /** @type {Map<number, {id:number,x:number,y:number,startX:number,startY:number,downTime:number}>} */
        this.pointers = new Map();

        // 'idle' | 'paint' | 'rotate' | 'pinch' | 'two-rotate'
        // 'paint'/'rotate' のとき 2本目が来ると暫定的に pending=true となり、
        // 分類が決まった時点で pinch/two-rotate へ遷移するか、無視して継続する。
        this.gesture = 'idle';
        this.pending = false;

        this.activePainterId = null;
        this.activeRotaterId = null;
        this.paintModel = null;
        this.paintPrev = null;
        this.paintTool = null;
        this._patternTravel = 0;   // もようブラシ用

        // ドライブモード等で塗りを抑止する。false の間は 1本指=常に回転 として扱う。
        this.paintEnabled = true;

        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
    }

    /** @param {boolean} enabled */
    setPaintEnabled(enabled) {
        this.paintEnabled = enabled;
        if (!enabled) {
            this._cancelPaintingIfActive();
            this.gesture = 'idle';
            this.activePainterId = null;
            this.activeRotaterId = null;
            this.pointers.clear();
            this.pending = false;
        }
    }

    bind() {
        this.target.addEventListener('pointerdown', this._onDown);
        this.target.addEventListener('pointermove', this._onMove);
        this.target.addEventListener('pointerup', this._onUp);
        this.target.addEventListener('pointercancel', this._onUp);
    }

    // ---------- pointer events ----------

    _onDown(e) {
        // 3本目以降は無視 (誤接触対策)
        if (this.pointers.size >= 2) return;
        this.target.setPointerCapture?.(e.pointerId);

        const p = {
            id: e.pointerId,
            x: e.clientX, y: e.clientY,
            startX: e.clientX, startY: e.clientY,
            downTime: performance.now(),
        };
        this.pointers.set(e.pointerId, p);

        if (this.pointers.size === 1) {
            // 1本目: モデルヒット判定で描画/回転を決定
            // (ドライブモード中は塗りを抑止し、常に回転)
            const hit = this.paintEnabled ? this.scene.raycast(e.clientX, e.clientY) : null;
            if (hit) {
                this._startPainting(p.id, hit);
            } else {
                this._startRotate(p.id);
            }
        } else {
            // 2本目: 分類保留
            this.pending = true;
        }
    }

    _onMove(e) {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const prevX = p.x;
        const prevY = p.y;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;

        if (this.pending) {
            // 分類待ち中も、現状ジェスチャは継続(主指の動きだけ反映)
            if (this.gesture === 'paint' && p.id === this.activePainterId) {
                this._paintAt(p.x, p.y, prevX, prevY);
            } else if (this.gesture === 'rotate' && p.id === this.activeRotaterId) {
                this._rotateByPx(dx, dy);
            }
            this._tryClassify();
            return;
        }

        switch (this.gesture) {
            case 'paint':
                if (p.id === this.activePainterId) this._paintAt(p.x, p.y, prevX, prevY);
                break;
            case 'rotate':
                if (p.id === this.activeRotaterId) this._rotateByPx(dx, dy);
                break;
            case 'pinch':
                if (this.pointers.size === 2) this._updatePinch();
                break;
            case 'two-rotate':
                if (this.pointers.size === 2) this._updateTwoFingerRotate(dx, dy, p.id);
                break;
        }
    }

    _onUp(e) {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        this.pointers.delete(e.pointerId);

        if (this.pending) {
            // 分類前に指が離れた → 2本指ジェスチャは成立せず、1本目の動作を続行
            this.pending = false;
            // 1本目自身が離れた場合は通常の終了処理へ落ちる
        }

        if (this.gesture === 'paint' && p.id === this.activePainterId) {
            this._endPainting();
            this.gesture = 'idle';
            this.activePainterId = null;
        } else if (this.gesture === 'rotate' && p.id === this.activeRotaterId) {
            this.gesture = 'idle';
            this.activeRotaterId = null;
        } else if (this.gesture === 'pinch' || this.gesture === 'two-rotate') {
            // 二本指ジェスチャ終了。残った指で勝手に描画/回転を始めない
            this.gesture = 'idle';
            this.activePainterId = null;
            this.activeRotaterId = null;
        }
    }

    // ---------- classification ----------

    _tryClassify() {
        if (this.pointers.size !== 2) return;
        const [p1, p2] = [...this.pointers.values()];
        const second = p1.downTime > p2.downTime ? p1 : p2;
        const elapsed = performance.now() - second.downTime;

        const v1x = p1.x - p1.startX, v1y = p1.y - p1.startY;
        const v2x = p2.x - p2.startX, v2y = p2.y - p2.startY;
        const v1 = Math.hypot(v1x, v1y);
        const v2 = Math.hypot(v2x, v2y);

        // 「2本目だけ動かない」ケース(子供が指を置いただけ等)を弾くため、
        // どちらの指も一定以上動いていなければ分類しない。
        const bothMoving = v1 >= CLASSIFY_MIN_MOVE_PX && v2 >= CLASSIFY_MIN_MOVE_PX;
        if (!bothMoving) {
            if (elapsed > CLASSIFY_TIMEOUT_MS) this.pending = false; // タイムアウト=2本目は誤接触
            return;
        }

        // 最低限の経過時間は確保 (ピクピクする1フレで切替わらないように)
        if (elapsed < CLASSIFY_TIME_MS) return;

        const distStart = Math.hypot(p1.startX - p2.startX, p1.startY - p2.startY);
        const distNow = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const distRatio = Math.abs(distNow - distStart) / Math.max(1, distStart);

        // ピンチ判定 (指間距離変化が支配的)
        if (distRatio > PINCH_RATIO_THRESHOLD) {
            this._beginPinch();
            return;
        }

        // 並行移動判定 (近接 + 同方向)
        const cos = (v1 * v2 > 0) ? (v1x * v2x + v1y * v2y) / (v1 * v2) : -1;
        const nearLimit = this.scene.viewportShortSide * TWO_FINGER_NEAR_RATIO;
        const near = distNow < nearLimit;

        if (near && cos > VELOCITY_COS_THRESHOLD) {
            this._beginTwoFingerRotate();
            return;
        }

        // 動きはあるが分類条件に当てはまらない → タイムアウトで誤接触扱い
        if (elapsed > CLASSIFY_TIMEOUT_MS) {
            this.pending = false;
        }
    }

    _beginPinch() {
        this._cancelPaintingIfActive();
        this.gesture = 'pinch';
        this.pending = false;
        this.activeRotaterId = null;
        const [p1, p2] = [...this.pointers.values()];
        this._pinchPrevDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    _beginTwoFingerRotate() {
        this._cancelPaintingIfActive();
        this.gesture = 'two-rotate';
        this.pending = false;
        this.activeRotaterId = null;
    }

    // ---------- gesture updates ----------

    _rotateByPx(dx, dy) {
        // 右にドラッグ = モデルが右に回って見える(=カメラは左に回り込む)
        // という「掴んで回す」感に合わせて符号を取る。
        const dim = this.scene.viewportShortSide || 1;
        const dTheta = ROTATE_GAIN * dx / dim;
        const dPhi = ROTATE_GAIN * dy / dim;
        this.scene.rotateCamera(dTheta, dPhi);
    }

    _updatePinch() {
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this._pinchPrevDist > 0 && dist > 0) {
            // 指が広がる(dist > prev)とズームイン (カメラを近づける) = scale < 1
            const scale = (this._pinchPrevDist / dist) ** PINCH_GAIN;
            this.scene.dollyCamera(scale);
        }
        this._pinchPrevDist = dist;
    }

    _updateTwoFingerRotate(dx, dy, movedId) {
        // 動いた指の変位を 1/2 (二本の平均ぶん) に落として回転に流す。
        // ピンチ成分との切り分けは _tryClassify で済んでいるので簡略でよい。
        this._rotateByPx(dx * 0.5, dy * 0.5);
    }

    // ---------- painting helpers ----------

    _startPainting(pointerId, hit) {
        this.gesture = 'paint';
        this.activePainterId = pointerId;
        const model = this.scene.currentModel;
        const { tool } = this.getState();
        this.paintModel = model;
        this.paintTool = tool;
        this.paintPrev = null;
        this._patternTravel = 0;
        model?.beginStroke?.({ tool });
        // pointerdown 時点でも 1ドット落としたいので即時描画
        if (model) {
            const p = this.pointers.get(pointerId);
            if (p) this._paintAt(p.x, p.y);
        }
    }

    _startRotate(pointerId) {
        this.gesture = 'rotate';
        this.activeRotaterId = pointerId;
    }

    _endPainting() {
        if (this.paintModel) {
            this.paintModel.endStroke?.();
        }
        this.paintModel = null;
        this.paintPrev = null;
        this.paintTool = null;
    }

    _cancelPaintingIfActive() {
        if (this.paintModel) {
            this.paintModel.cancelStroke?.();
        }
        this.paintModel = null;
        this.paintPrev = null;
        this.paintTool = null;
        this.activePainterId = null;
    }

    _paintAt(clientX, clientY, prevClientX, prevClientY) {
        const model = this.paintModel;
        if (!model) return;
        const hit = this.scene.raycast(clientX, clientY);
        if (!hit) {
            this.paintPrev = null;
            return;
        }
        const { color, size, tool, patternShape } = this.getState();
        const travel = prevClientX != null ? Math.hypot(clientX - prevClientX, clientY - prevClientY) : 0;

        if (tool === 'spray') {
            model.spray(hit, color, size * SPRAY_SIZE_MULT);
            this.paintPrev = null;
        } else if (tool === 'pattern') {
            this._patternTravel += travel;
            const interval = size * PATTERN_INTERVAL_MULT;
            if (this._patternTravel >= interval || prevClientX == null) {
                model.stampShape(hit, color, size, patternShape ?? 'star', PEN_OPACITY);
                this._patternTravel = 0;
            }
            this.paintPrev = null;
        } else if (tool === 'glitter') {
            model.glitter(hit, color, size * GLITTER_SIZE_MULT);
            this.paintPrev = null;
        } else if (tool === 'bristle') {
            this.paintPrev = model.bristle(hit, this.paintPrev, color, size, PEN_OPACITY);
        } else if (tool === 'grass') {
            this.paintPrev = model.grass(hit, this.paintPrev, color, size, PEN_OPACITY);
        } else {
            this.paintPrev = model.paint(hit, this.paintPrev, color, size, PEN_OPACITY);
        }
    }
}
