/**
 * 3Dおえかきアプリ エントリーポイント。
 */

import { SceneManager } from './scene.js';
import { Painter } from './painter.js';
import { UI } from './ui.js';
import { DriveMode } from './drive.js';
import { MachiMode } from './machi/index.js';
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
    const machi = new MachiMode(scene);
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
                if (machi.active) {
                    machi.stop();
                    ui.setMachiMode(false);
                }
                drive.start();
                if (drive.active) painter?.setPaintEnabled(false);
            } else {
                drive.stop();
                painter?.setPaintEnabled(true);
            }
            ui.setDriveMode(drive.active);
        },
        onMachiToggle(active) {
            if (active) {
                if (drive.active) {
                    drive.stop();
                    ui.setDriveMode(false);
                }
                machi.start();
                if (machi.active) painter?.setPaintEnabled(false);
            } else {
                machi.stop();
                painter?.setPaintEnabled(true);
            }
            ui.setMachiMode(machi.active, machi.cameraLabel);
            ui.setMachiTime(machi.timeOfDay);
        },
        onMachiCameraCycle() {
            return machi.cycleCamera();
        },
        onMachiTimeChange(id) {
            machi.setTimeOfDay(id);
        },
        // 裏技: まちメニューのタイトル3連打で、まちをそのままARに投影する
        async onMachiAR() {
            if (!machi.active || arBusy || webxrAR.active) return;
            if (!webxrARSupported) {
                alert('ごめんね、このたんまつでは つかえないよ');
                return;
            }
            arBusy = true;
            try {
                await webxrAR.start({
                    desiredSize: 1.0, // 市街地の一辺の初期実寸 (m) — ピンチで変えられる
                    acquire: () => machi.beginAR(),
                    release: () => machi.endAR(),
                    bounds: () => machi.arBounds(),
                    onFrame: (dt) => machi.updateAR(dt),
                });
            } catch (err) {
                console.error('Machi AR failed:', err);
                machi.endAR(); // acquire 済みでも未了でも安全に戻せる
                alert('ごめんね、ARをはじめられなかったよ');
            } finally {
                arBusy = false;
            }
        },
        onModeExit() {
            if (machi.active) {
                machi.stop();
                ui.setMachiMode(false);
            }
            if (drive.active) {
                drive.stop();
                ui.setDriveMode(false);
            }
            painter?.setPaintEnabled(true);
        },
        async onPlaceAR() {
            if (!scene.currentModel?.mesh) return;
            if (arBusy || webxrAR.active) return; // 起動中・書き出し中の連打防止
            arBusy = true;
            try {
                if (webxrARSupported) {
                    // Android (ARCore): WebXR hit-test でブラウザ内AR
                    // 入力状態をクリアして AR 中はお絵描きの描画を抑止 (復帰は onEnd)
                    painter?.setPaintEnabled(false);
                    await webxrAR.start();
                } else if (isQuickLookSupported()) {
                    // iOS / iPadOS: USDZ に書き出して AR Quick Look
                    await placeModelInQuickLook(scene.currentModel.mesh);
                } else {
                    alert('ごめんね、このたんまつでは「おく」はつかえないよ');
                }
            } catch (err) {
                console.error('AR failed:', err);
                // セッションが立ち上がらなかったときは onEnd が来ないので即復帰させる
                painter?.setPaintEnabled(true);
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

    // AR セッション終了時 (もどるボタン / OSの自動終了どちらも) にお絵描きへ復帰する。
    // まちAR (裏技) からの復帰先はまちモードなので、描画は止めたままにする
    webxrAR.onEnd = () => {
        if (!machi.active && !drive.active) painter.setPaintEnabled(true);
    };
});
