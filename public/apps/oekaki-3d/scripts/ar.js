/**
 * ARモード(「おく」) の iOS / iPadOS 向け実装: 塗ったモデルを USDZ に書き出し、
 * OS標準の AR Quick Look で現実世界に置く。
 * (Android 向けの WebXR hit-test 実装は ar-webxr.js)
 *
 * - 平面検知・移動・回転・拡大縮小は OS のビューアが提供する
 *   (Google の動物ARの iOS 版とまったく同じ仕組み)。
 * - rel="ar" の <a> に USDZ の blob URL を渡してタップ相当の click() で起動する。
 *   Safari の仕様で <a> の最初の子に <img> が必要。
 * - 対応した環境かは isQuickLookSupported() で事前判定できる。
 */

import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

/** AR Quick Look (rel="ar" リンク) に対応した環境か */
export function isQuickLookSupported() {
    const a = document.createElement('a');
    return a.relList?.supports?.('ar') === true;
}

/**
 * モデルを USDZ に書き出して AR Quick Look を起動する。
 * @param {THREE.Object3D} mesh 塗り済みモデルのルート
 */
export async function placeModelInQuickLook(mesh) {
    const exportRoot = buildExportScene(mesh);
    const exporter = new USDZExporter();
    const arraybuffer = await exporter.parse(exportRoot);
    const blob = new Blob([arraybuffer], { type: 'model/vnd.usdz+zip' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.rel = 'ar';
    anchor.appendChild(document.createElement('img'));
    anchor.href = url;
    anchor.click();

    // Quick Look が読み終わる前に revoke すると失敗するので少し置いてから解放
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * 書き出し用のシーンを作る。表示中のモデルには手を触れない:
 * - clone してジオメトリ/テクスチャは共有、マテリアルだけ複製
 * - 表示用の傾き (CarModel のディスプレイポーズ等) をリセットして水平に
 * - 底面中央を原点に寄せて床にぴたり接地するように
 * - 紙画面用の emissive ブースト (テクスチャの二重加算で白飛びする) を外す
 */
function buildExportScene(mesh) {
    const clone = mesh.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.updateMatrixWorld(true);

    clone.traverse((o) => {
        if (!o.isMesh) return;
        const fix = (m) => {
            const c = m.clone();
            c.emissive = new THREE.Color(0x000000);
            c.emissiveMap = null;
            c.emissiveIntensity = 0;
            return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    });

    const box = new THREE.Box3().setFromObject(clone);
    if (!box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        clone.position.set(-center.x, -box.min.y, -center.z);
        clone.updateMatrixWorld(true);
    }

    const root = new THREE.Group();
    root.add(clone);
    return root;
}
