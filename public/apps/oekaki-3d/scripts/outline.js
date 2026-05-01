/**
 * 塗り絵風アウトライン: EdgesGeometry で隣接面の角度が閾値以上のエッジを抽出して
 * 黒線(LineSegments)として重ね描きする。
 * raycast対象外にして描画ヒットに干渉しないようにする。
 *
 * 注: 滑らかな曲面(球など)はクリース判定にかからないので線は出ない。
 *     太さを統一するためインバーテッドハル方式は使わない。
 */

import * as THREE from 'three';

const NO_RAYCAST = () => {};

/**
 * @param {THREE.Object3D} parent 追加先
 * @param {THREE.BufferGeometry} geometry 元のジオメトリ
 * @param {object} [opts]
 * @param {number} [opts.color=0x111111]
 * @param {number} [opts.creaseAngle=35]
 */
export function attachOutline(parent, geometry, opts = {}) {
    const color = opts.color ?? 0x111111;
    const creaseAngle = opts.creaseAngle ?? 35;

    const edges = new THREE.EdgesGeometry(geometry, creaseAngle);
    const lineMat = new THREE.LineBasicMaterial({ color });
    const lines = new THREE.LineSegments(edges, lineMat);
    lines.raycast = NO_RAYCAST;
    parent.add(lines);

    return { lines, lineMat, edges };
}

export function disposeOutline(outline) {
    outline.lineMat.dispose();
    outline.edges.dispose();
}
