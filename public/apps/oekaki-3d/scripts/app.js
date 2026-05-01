/**
 * 3Dおえかきアプリ エントリーポイント。
 */

import { SceneManager } from './scene.js';
import { Painter } from './painter.js';
import { UI } from './ui.js';
import { getModelEntry } from './models/index.js';

document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('stage');
    const scene = new SceneManager(stage);

    const ui = new UI({
        onColorChange() {},
        onToolChange() {},
        onSizeChange() {},
        onModelChange(id) {
            const entry = getModelEntry(id);
            scene.setModel(entry.factory());
        },
        onSave() {
            const url = scene.snapshotDataURL();
            const a = document.createElement('a');
            a.href = url;
            a.download = `oekaki-3d-${Date.now()}.png`;
            a.click();
        },
        onClear() {
            scene.currentModel?.clear();
        },
    });
    ui.setup();

    scene.setModel(getModelEntry(ui.getState().modelId).factory());

    // 1本指=描画/回転、2本指=ピンチor回転 を統合的に判別する
    const painter = new Painter(scene.renderer.domElement, scene, () => ui.getState());
    painter.bind();
});
