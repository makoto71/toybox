/**
 * ブラシの基底クラス
 * 新しいブラシを追加する場合はこのクラスを継承する
 */
export class BaseBrush {
    constructor() {
        this.name = 'base';
    }

    /**
     * 線幅の計算
     * @param {number} baseSize - 基本サイズ
     * @param {number} velocity - 描画速度（px/ms）
     * @returns {number} 目標線幅
     */
    calcLineWidth(baseSize, velocity) {
        return baseSize;
    }

    /**
     * コンテキストにスタイルを適用する
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts - { color, baseSize, velocity }
     * @returns {number} 目標線幅
     */
    applyStyle(ctx, opts) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 1.0;
        return this.calcLineWidth(opts.baseSize, opts.velocity);
    }

    /**
     * ストローク完了時の処理（オーバーレイ→メインへの転写など）
     * @param {CanvasRenderingContext2D} mainCtx
     * @param {HTMLCanvasElement} overlayCanvas
     * @param {CanvasRenderingContext2D} overlayCtx
     */
    finalizeStroke(mainCtx, overlayCanvas, overlayCtx) {
        // デフォルトでは何もしない
    }

    /**
     * 描画先のコンテキストを返す
     * @param {CanvasRenderingContext2D} mainCtx
     * @param {CanvasRenderingContext2D} overlayCtx
     * @returns {CanvasRenderingContext2D}
     */
    getDrawContext(mainCtx, overlayCtx) {
        return mainCtx;
    }
}
