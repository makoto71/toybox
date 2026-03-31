/**
 * 入力処理モジュール
 * マウスとタッチイベントを受け取り、ブラシを使ってキャンバスに描画する
 */

export class InputHandler {
    /**
     * @param {import('./canvas.js').CanvasManager} canvasManager
     * @param {() => import('./brushes/BaseBrush.js').BaseBrush} getBrush - 現在のブラシを返す関数
     * @param {() => string} getColor - 現在の色を返す関数
     * @param {() => number} getBaseSize - 現在の基本サイズを返す関数
     */
    constructor(canvasManager, getBrush, getColor, getBaseSize) {
        this.cm = canvasManager;
        this.getBrush = getBrush;
        this.getColor = getColor;
        this.getBaseSize = getBaseSize;

        // マウス描画の状態
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.lastTime = 0;
        this.currentLineWidth = 0;

        // マルチタッチの状態（identifier → タッチ情報）
        this.activeTouches = new Map();
    }

    /** イベントリスナーを登録する */
    bind() {
        const overlay = this.cm.overlayCanvas;

        // マウスイベント（オーバーレイが最前面）
        overlay.addEventListener('mousedown', (e) => this._onMouseDown(e));
        overlay.addEventListener('mousemove', (e) => this._onMouseMove(e));
        overlay.addEventListener('mouseup', () => this._onMouseUp());
        overlay.addEventListener('mouseout', () => this._onMouseUp());

        // タッチイベント
        const canvasArea = document.querySelector('.canvas-area');
        canvasArea.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
        document.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
    }

    // --- マウスイベント ---

    _onMouseDown(e) {
        this.isDrawing = true;
        [this.lastX, this.lastY] = this._getCoords(e);
        this.lastTime = Date.now();
        this.currentLineWidth = this.getBaseSize();
    }

    _onMouseMove(e) {
        if (!this.isDrawing) return;

        const [x, y] = this._getCoords(e);
        const now = Date.now();
        const dt = now - this.lastTime;
        const dist = Math.hypot(x - this.lastX, y - this.lastY);
        const velocity = dt > 0 ? dist / dt : 0;

        this.currentLineWidth = this._drawSegment(
            this.lastX, this.lastY, x, y, velocity, this.currentLineWidth
        );

        this.lastX = x;
        this.lastY = y;
        this.lastTime = now;
    }

    _onMouseUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this._finalize();
    }

    // --- タッチイベント ---

    _onTouchStart(e) {
        if (!e.target.closest('.canvas-area')) return;
        e.preventDefault();

        for (const touch of e.changedTouches) {
            const [x, y] = this._getCoordsFromTouch(e, touch);
            this.activeTouches.set(touch.identifier, {
                lastX: x,
                lastY: y,
                lastTime: Date.now(),
                currentLineWidth: this.getBaseSize(),
            });
        }
    }

    _onTouchMove(e) {
        if (this.activeTouches.size === 0) return;
        if (e.target.closest('.toolbox') || e.target.closest('.menu-container')) return;
        e.preventDefault();

        for (const touch of e.changedTouches) {
            const state = this.activeTouches.get(touch.identifier);
            if (!state) continue;

            const [x, y] = this._getCoordsFromTouch(e, touch);
            const now = Date.now();
            const dt = now - state.lastTime;
            const dist = Math.hypot(x - state.lastX, y - state.lastY);
            const velocity = dt > 0 ? dist / dt : 0;

            state.currentLineWidth = this._drawSegment(
                state.lastX, state.lastY, x, y, velocity, state.currentLineWidth
            );

            state.lastX = x;
            state.lastY = y;
            state.lastTime = now;
        }
    }

    _onTouchEnd(e) {
        if (e.target.closest('.toolbox') || e.target.closest('.menu-container')) {
            // UIタッチの場合もアクティブタッチは掃除する
            for (const touch of e.changedTouches) {
                this.activeTouches.delete(touch.identifier);
            }
            return;
        }
        e.preventDefault();

        for (const touch of e.changedTouches) {
            this.activeTouches.delete(touch.identifier);
        }

        // 全タッチ終了時にストロークを確定
        if (this.activeTouches.size === 0) {
            this._finalize();
        }
    }

    // --- 共通描画ロジック ---

    /**
     * 2点間の線分を描画し、スムージング後の線幅を返す
     * @returns {number} スムージング後の線幅
     */
    _drawSegment(x1, y1, x2, y2, velocity, prevLineWidth) {
        const brush = this.getBrush();
        const baseSize = this.getBaseSize();
        const ctx = brush.getDrawContext(this.cm.mainCtx, this.cm.overlayCtx);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        const targetWidth = brush.applyStyle(ctx, {
            color: this.getColor(),
            baseSize,
            velocity,
        });

        // 線幅をスムーズに遷移させる
        const smoothingFactor = 0.3;
        const smoothed = prevLineWidth + (targetWidth - prevLineWidth) * smoothingFactor;
        ctx.lineWidth = smoothed;
        ctx.stroke();

        return smoothed;
    }

    /** ストローク完了時の処理をブラシに委譲する */
    _finalize() {
        this.getBrush().finalizeStroke(
            this.cm.mainCtx,
            this.cm.overlayCanvas,
            this.cm.overlayCtx
        );
    }

    // --- 座標変換ヘルパー ---

    _getCoords(e) {
        return this.cm.toCanvasCoords(e.clientX, e.clientY);
    }

    _getCoordsFromTouch(e, touch) {
        return this.cm.toCanvasCoords(touch.clientX, touch.clientY);
    }
}
