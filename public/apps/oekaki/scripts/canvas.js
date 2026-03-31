/**
 * キャンバス管理モジュール
 * キャンバスの初期化、リサイズ、座標変換を担当する
 */

// A4サイズ（300dpi 印刷品質）
const A4_WIDTH = 2480;   // 210mm @ 300dpi
const A4_HEIGHT = 3508;  // 297mm @ 300dpi

export class CanvasManager {
    constructor(mainCanvas, overlayCanvas, container) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.mainCtx = mainCanvas.getContext('2d');
        this.overlayCtx = overlayCanvas.getContext('2d');
        this.container = container;

        this.canvasScale = 1;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.currentRotation = 0;
        this.isPortrait = true;
    }

    /** キャンバスのリサイズと回転を処理する */
    resize() {
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;
        const containerRatio = containerWidth / containerHeight;
        const shouldBeLandscape = containerRatio > 1;

        // 初回のみキャンバスを初期化（A4ポートレート）
        if (this.canvasWidth === 0) {
            this.canvasWidth = A4_WIDTH;
            this.canvasHeight = A4_HEIGHT;
            this.mainCanvas.width = this.canvasWidth;
            this.mainCanvas.height = this.canvasHeight;
            this.overlayCanvas.width = this.canvasWidth;
            this.overlayCanvas.height = this.canvasHeight;

            this._initContext(this.mainCtx);
            this._initContext(this.overlayCtx);
        }

        // 向きの変更を検出
        const orientationChanged =
            (shouldBeLandscape && this.isPortrait) ||
            (!shouldBeLandscape && !this.isPortrait);
        if (orientationChanged) {
            this.isPortrait = !shouldBeLandscape;
            this.currentRotation = shouldBeLandscape ? 90 : 0;
        }

        // 横向きの場合、表示上の幅と高さを入れ替える
        let visualWidth, visualHeight;
        if (shouldBeLandscape) {
            visualWidth = this.canvasHeight;
            visualHeight = this.canvasWidth;
        } else {
            visualWidth = this.canvasWidth;
            visualHeight = this.canvasHeight;
        }

        // コンテナに収まるようスケールを計算
        const padding = 40;
        const scaleX = (containerWidth - padding) / visualWidth;
        const scaleY = (containerHeight - padding) / visualHeight;
        this.canvasScale = Math.min(scaleX, scaleY);

        // CSSでスケーリングと回転を適用
        const scaledWidth = this.canvasWidth * this.canvasScale;
        const scaledHeight = this.canvasHeight * this.canvasScale;

        for (const canvas of [this.mainCanvas, this.overlayCanvas]) {
            canvas.style.width = `${scaledWidth}px`;
            canvas.style.height = `${scaledHeight}px`;

            const offsetX = containerWidth / 2;
            const offsetY = containerHeight / 2;
            canvas.style.left = `${offsetX}px`;
            canvas.style.top = `${offsetY}px`;

            canvas.style.transformOrigin = 'center center';
            canvas.style.transform = `translate(-50%, -50%) rotate(${this.currentRotation}deg)`;
        }
    }

    /**
     * クライアント座標をキャンバス座標に変換する
     * @param {number} clientX
     * @param {number} clientY
     * @returns {[number, number]}
     */
    toCanvasCoords(clientX, clientY) {
        const rect = this.overlayCanvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let relX = clientX - centerX;
        let relY = clientY - centerY;

        // 回転している場合、座標を逆回転させる
        if (this.currentRotation === 90) {
            const temp = relX;
            relX = relY;
            relY = -temp;
        }

        const x = relX / this.canvasScale + this.canvasWidth / 2;
        const y = relY / this.canvasScale + this.canvasHeight / 2;
        return [x, y];
    }

    /** 描画を画像として保存する */
    saveAsImage() {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.mainCanvas.width;
        exportCanvas.height = this.mainCanvas.height;
        const exportCtx = exportCanvas.getContext('2d');

        // 白背景で塗りつぶし
        exportCtx.fillStyle = '#FFFFFF';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // メインキャンバスの内容を描画
        exportCtx.drawImage(this.mainCanvas, 0, 0);

        // Blobに変換してダウンロード
        exportCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `oekaki-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 'image/png');
    }

    _initContext(ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
}
