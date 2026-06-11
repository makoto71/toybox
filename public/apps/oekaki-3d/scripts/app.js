/**
 * 3Dおえかきアプリ エントリーポイント。
 */

import { SceneManager } from './scene.js';
import { Painter } from './painter.js';
import { UI } from './ui.js';
import { DriveMode } from './drive.js';
import { isQuickLookSupported, placeModelInQuickLook } from './ar.js';
import { isWebXRARSupported, WebXRARMode } from './ar-webxr.js';
import { getModelEntry } from './models/index.js';

document.addEventListener('DOMContentLoaded', () => {
    const setAppHeight = () => {
        document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
    };
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    document.addEventListener('fullscreenchange', () => {
        setAppHeight();
        requestAnimationFrame(setAppHeight);
        setTimeout(setAppHeight, 200);
    });
    document.addEventListener('webkitfullscreenchange', () => {
        setAppHeight();
        requestAnimationFrame(setAppHeight);
        setTimeout(setAppHeight, 200);
    });

    const stage = document.getElementById('stage');
    const scene = new SceneManager(stage);
    const drive = new DriveMode(scene);
    const webxrAR = new WebXRARMode(scene);
    // requestSession はユーザー操作の直後に呼ぶ必要があるので、対応可否は先に調べておく
    let webxrARSupported = false;
    isWebXRARSupported().then((v) => { webxrARSupported = v; });

    let ui;
    let painter;
    let arBusy = false;

    ui = new UI({
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
        onDriveToggle(active) {
            if (active) {
                drive.start();
                if (drive.active) painter?.setPaintEnabled(false);
            } else {
                drive.stop();
                painter?.setPaintEnabled(true);
            }
            ui.setDriveMode(drive.active);
        },
        async onPlaceAR() {
            if (!scene.currentModel?.mesh) return;
            if (arBusy || webxrAR.active) return; // 起動中・書き出し中の連打防止
            arBusy = true;
            try {
                if (webxrARSupported) {
                    // Android (ARCore): WebXR hit-test でブラウザ内AR
                    await webxrAR.start();
                } else if (isQuickLookSupported()) {
                    // iOS / iPadOS: USDZ に書き出して AR Quick Look
                    await placeModelInQuickLook(scene.currentModel.mesh);
                } else {
                    alert('ごめんね、このたんまつでは「おく」はつかえないよ');
                }
            } catch (err) {
                console.error('AR failed:', err);
                alert('ごめんね、ARをはじめられなかったよ');
            } finally {
                arBusy = false;
            }
        },
    });
    ui.setup();

    scene.setModel(getModelEntry(ui.getState().modelId).factory());

    // 1本指=描画/回転、2本指=ピンチor回転 を統合的に判別する
    painter = new Painter(scene.renderer.domElement, scene, () => ui.getState());
    painter.bind();
});
