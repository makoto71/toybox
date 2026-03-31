import { BaseBrush } from './BaseBrush.js';

/**
 * 消しゴムブラシ
 * メインキャンバスに白で直接描画する。
 */
export class EraserBrush extends BaseBrush {
    constructor() {
        super();
        this.name = 'eraser';
        // 消しゴムはペンより少し太めにする倍率
        this.sizeFactor = 1.5;
    }

    calcLineWidth(baseSize, _velocity) {
        return baseSize * this.sizeFactor;
    }

    applyStyle(ctx, opts) {
        super.applyStyle(ctx, opts);
        ctx.strokeStyle = '#FFFFFF';
        return this.calcLineWidth(opts.baseSize, opts.velocity);
    }

    getDrawContext(mainCtx, _overlayCtx) {
        // メインキャンバスに直接描画
        return mainCtx;
    }
}
