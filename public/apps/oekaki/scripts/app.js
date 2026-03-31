/**
 * おえかきアプリ エントリーポイント
 * 各モジュールを初期化し、相互接続する
 */

import { CanvasManager } from './canvas.js';
import { InputHandler } from './input.js';
import { UI } from './ui.js';
import { PenBrush } from './brushes/PenBrush.js';
import { EraserBrush } from './brushes/EraserBrush.js';

document.addEventListener('DOMContentLoaded', () => {
    // ブラシの登録
    const brushes = {
        pen: new PenBrush(),
        eraser: new EraserBrush(),
    };
    let currentBrush = brushes.pen;
    let currentColor = '#FF4757';
    let baseSize = 40;

    // キャンバス管理の初期化
    const canvasManager = new CanvasManager(
        document.getElementById('drawing-canvas'),
        document.getElementById('overlay-canvas'),
        document.querySelector('.canvas-area')
    );
    canvasManager.resize();

    // UI初期化
    const ui = new UI({
        onToolChange(toolName) {
            if (brushes[toolName]) {
                currentBrush = brushes[toolName];
            }
        },
        onColorChange(color) {
            currentColor = color;
            // 色選択時、消しゴムならペンに切り替える
            if (currentBrush.name === 'eraser') {
                currentBrush = brushes.pen;
                ui.setTool('pen');
            }
        },
        onSizeChange(size) {
            baseSize = size;
        },
        onSave() {
            canvasManager.saveAsImage();
        },
    });
    ui.setup();

    // 入力処理の初期化
    const input = new InputHandler(
        canvasManager,
        () => currentBrush,
        () => currentColor,
        () => baseSize
    );
    input.bind();

    // ウィンドウリサイズ対応
    window.addEventListener('resize', () => canvasManager.resize());
});
