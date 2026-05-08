import { BaseBrush } from './BaseBrush.js';

/**
 * 消しゴムブラシ
 * destination-out 合成でピクセルを消去し、背景キャンバスが透けて見えるようにする。
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
        // 透明を描画する = ピクセルを消す
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        return this.calcLineWidth(opts.baseSize, opts.velocity);
    }

    getDrawContext(mainCtx, _overlayCtx) {
        // メインキャンバスに直接描画（消去）
        return mainCtx;
    }

    finalizeStroke(mainCtx, _overlayCanvas, _overlayCtx) {
        // ストロークが終わったら合成モードを戻す
        mainCtx.globalCompositeOperation = 'source-over';
    }
}
