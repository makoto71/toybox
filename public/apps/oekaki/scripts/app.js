/**
 * おえかきアプリ エントリーポイント
 * 各モジュールを初期化し、相互接続する
 */

import { CanvasManager } from './canvas.js';
import { InputHandler } from './input.js';
import { UI } from './ui.js';
import { PenBrush } from './brushes/PenBrush.js';
import { EraserBrush } from './brushes/EraserBrush.js';
import { StampBrush } from './brushes/StampBrush.js';
import { StampController } from './stamp-controller.js';

document.addEventListener('DOMContentLoaded', () => {
    // ブラシの登録
    const brushes = {
        pen: new PenBrush(),
        eraser: new EraserBrush(),
        stamp: new StampBrush(),
    };
    let currentBrush = brushes.pen;
    // 色は { type:'solid', color } か { type:'gradient', colors:[a,b] }（ペン/消しゴム専用）
    let currentColor = { type: 'solid', color: '#FF4757' };
    let baseSize = 40;

    // キャンバス管理の初期化（背景・メイン・オーバーレイの3層）
    const canvasManager = new CanvasManager(
        document.getElementById('bg-canvas'),
        document.getElementById('drawing-canvas'),
        document.getElementById('overlay-canvas'),
        document.querySelector('.canvas-area')
    );
    canvasManager.resize();

    // スタンプコントローラ
    const stampController = new StampController({ canvasManager });

    // UI初期化
    const ui = new UI({
        onToolChange(toolName) {
            if (brushes[toolName]) {
                // スタンプから他ツールへ移るときは未確定スタンプを確定
                if (currentBrush.mode === 'stamp' && toolName !== 'stamp') {
                    stampController.deactivate();
                }
                currentBrush = brushes[toolName];
            }
        },
        onColorChange(colorSpec) {
            currentColor = colorSpec;
            // 色選択時、消しゴムならペンに切り替える
            if (currentBrush.name === 'eraser') {
                currentBrush = brushes.pen;
                ui.setTool('pen');
            }
        },
        onSizeChange(size) {
            baseSize = size;
        },
        onShapeChange(shape) {
            brushes.stamp.setShape(shape);
        },
        onBackgroundChange(image, mirror) {
            canvasManager.setBackground(image, mirror);
        },
        onSave() {
            stampController.deactivate();
            canvasManager.saveAsImage();
        },
    });
    ui.setup();

    // 入力処理の初期化
    const input = new InputHandler(
        canvasManager,
        () => currentBrush,
        () => currentColor,
        () => baseSize,
        stampController
    );
    input.bind();

    // ウィンドウリサイズ対応
    window.addEventListener('resize', () => canvasManager.resize());
});
