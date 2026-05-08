import { BaseBrush } from './BaseBrush.js';

/**
 * ペンブラシ
 * 描画速度に応じて線幅が変わる。半透明でオーバーレイに描画し、
 * ストローク完了時にメインキャンバスへ転写する。
 * 色は単色（文字列 or {type:'solid'}）または2色グラデーション（{type:'gradient'}）を受け付ける。
 */
export class PenBrush extends BaseBrush {
    constructor() {
        super();
        this.name = 'pen';
        // 速度感度のパラメータ
        this.maxVelocity = 4.0;
        this.minWidthFactor = 0.2;
        this.maxWidthFactor = 1.2;
        // ストローク転写時の透明度
        this.strokeOpacity = 0.6;
    }

    calcLineWidth(baseSize, velocity) {
        const speedFactor = Math.min(velocity / this.maxVelocity, 1.0);
        const widthFactor = this.maxWidthFactor - (speedFactor * (this.maxWidthFactor - this.minWidthFactor));
        return baseSize * widthFactor;
    }

    applyStyle(ctx, opts) {
        super.applyStyle(ctx, opts);
        ctx.strokeStyle = this._resolveStrokeStyle(ctx, opts.color);
        return this.calcLineWidth(opts.baseSize, opts.velocity);
    }

    _resolveStrokeStyle(ctx, colorSpec) {
        if (colorSpec && colorSpec.type === 'gradient') {
            // キャンバス全体にかかるグラデーションを作成（左上→右下）
            const g = ctx.createLinearGradient(0, 0, ctx.canvas.width, ctx.canvas.height);
            g.addColorStop(0, colorSpec.colors[0]);
            g.addColorStop(1, colorSpec.colors[1]);
            return g;
        }
        if (typeof colorSpec === 'string') return colorSpec;
        if (colorSpec && colorSpec.type === 'solid') return colorSpec.color;
        return '#000';
    }

    getDrawContext(mainCtx, overlayCtx) {
        // オーバーレイに描画する
        return overlayCtx;
    }

    finalizeStroke(mainCtx, overlayCanvas, overlayCtx) {
        // オーバーレイの内容を半透明でメインに転写
        mainCtx.globalAlpha = this.strokeOpacity;
        mainCtx.drawImage(overlayCanvas, 0, 0);
        mainCtx.globalAlpha = 1.0;

        // オーバーレイをクリア
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}
