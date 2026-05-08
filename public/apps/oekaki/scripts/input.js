/**
 * 入力処理モジュール
 * マウスとタッチイベントを受け取り、ブラシを使ってキャンバスに描画する
 * ブラシが mode === 'stamp' の場合は：
 *   押した瞬間に StampController へ配置を開始（以降、離すまで少しずつ拡大）
 *   離した瞬間に確定
 *   ドラッグ中の連続配置は行わない
 */

export class InputHandler {
    /**
     * @param {import('./canvas.js').CanvasManager} canvasManager
     * @param {() => import('./brushes/BaseBrush.js').BaseBrush} getBrush
     * @param {() => (string|object)} getColor
     * @param {() => number} getBaseSize
     * @param {import('./stamp-controller.js').StampController} [stampController]
     */
    constructor(canvasManager, getBrush, getColor, getBaseSize, stampController = null) {
        this.cm = canvasManager;
        this.getBrush = getBrush;
        this.getColor = getColor;
        this.getBaseSize = getBaseSize;
        this.stampController = stampController;

        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.lastTime = 0;
        this.currentLineWidth = 0;

        // マルチタッチの状態（identifier → タッチ情報）
        this.activeTouches = new Map();
        // スタンプは同時1点のみ扱う。その touch id
        this.stampTouchId = null;
    }

    bind() {
        const overlay = this.cm.overlayCanvas;

        overlay.addEventListener('mousedown', (e) => this._onMouseDown(e));
        overlay.addEventListener('mousemove', (e) => this._onMouseMove(e));
        overlay.addEventListener('mouseup', () => this._onMouseUp());
        overlay.addEventListener('mouseout', () => this._onMouseUp());

        const canvasArea = document.querySelector('.canvas-area');
        canvasArea.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
        document.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
    }

    // --- マウスイベント ---

    _onMouseDown(e) {
        const brush = this.getBrush();
        const [x, y] = this._getCoords(e);

        if (brush.mode === 'stamp') {
            this.isDrawing = true;
            if (this.stampController) {
                this.stampController.onCanvasPointerDown(x, y, brush.shape, this.getColor());
            }
            return;
        }

        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;
        this.lastTime = Date.now();
        this.currentLineWidth = this.getBaseSize();
    }

    _onMouseMove(e) {
        if (!this.isDrawing) return;
        const brush = this.getBrush();
        if (brush.mode === 'stamp') {
            // スタンプは押下中の指の動きで回転する
            if (this.stampController) {
                const [mx, my] = this._getCoords(e);
                this.stampController.onCanvasPointerMove(mx, my);
            }
            return;
        }

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
        const brush = this.getBrush();
        if (brush.mode === 'stamp') {
            if (this.stampController) this.stampController.onCanvasPointerUp();
            return;
        }
        this._finalize();
    }

    // --- タッチイベント ---

    _onTouchStart(e) {
        if (!e.target.closest('.canvas-area')) return;
        e.preventDefault();

        const brush = this.getBrush();

        for (const touch of e.changedTouches) {
            const [x, y] = this._getCoordsFromTouch(e, touch);
            if (brush.mode === 'stamp') {
                // 同時に一つだけ
                if (this.stampTouchId !== null) continue;
                this.stampTouchId = touch.identifier;
                if (this.stampController) {
                    this.stampController.onCanvasPointerDown(x, y, brush.shape, this.getColor());
                }
                continue;
            }
            this.activeTouches.set(touch.identifier, {
                lastX: x,
                lastY: y,
                lastTime: Date.now(),
                currentLineWidth: this.getBaseSize(),
            });
        }
    }

    _onTouchMove(e) {
        const brush = this.getBrush();
        // スタンプモードでも他描画でもこのハンドラは呼ばれる
        if (brush.mode === 'stamp') {
            // 押下中の指の移動で回転させる
            if (this.stampTouchId !== null) {
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    if (touch.identifier !== this.stampTouchId) continue;
                    const [tx, ty] = this._getCoordsFromTouch(e, touch);
                    if (this.stampController) {
                        this.stampController.onCanvasPointerMove(tx, ty);
                    }
                    break;
                }
            }
            return;
        }

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
            for (const touch of e.changedTouches) {
                this.activeTouches.delete(touch.identifier);
                if (touch.identifier === this.stampTouchId) this.stampTouchId = null;
            }
            return;
        }

        const brush = this.getBrush();

        for (const touch of e.changedTouches) {
            if (touch.identifier === this.stampTouchId) {
                this.stampTouchId = null;
                if (this.stampController) this.stampController.onCanvasPointerUp();
            }
            this.activeTouches.delete(touch.identifier);
        }

        if (this.activeTouches.size === 0 && brush.mode !== 'stamp') {
            this._finalize();
        }
    }

    // --- 共通描画ロジック ---

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

        const smoothingFactor = 0.3;
        const smoothed = prevLineWidth + (targetWidth - prevLineWidth) * smoothingFactor;
        ctx.lineWidth = smoothed;
        ctx.stroke();

        return smoothed;
    }

    _finalize() {
        const brush = this.getBrush();
        if (brush.mode === 'stamp') return;
        brush.finalizeStroke(
            this.cm.mainCtx,
            this.cm.overlayCanvas,
            this.cm.overlayCtx
        );
    }

    _getCoords(e) {
        return this.cm.toCanvasCoords(e.clientX, e.clientY);
    }

    _getCoordsFromTouch(e, touch) {
        return this.cm.toCanvasCoords(touch.clientX, touch.clientY);
    }
}
