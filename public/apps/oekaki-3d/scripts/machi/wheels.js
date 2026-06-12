/**
 * 走行に合わせて回すホイールの収集と回転 (まちモード共通)。
 *
 * GLBによってはホイールメッシュの原点がタイヤ中心ではなくモデル原点にある
 * (位置がジオメトリに焼き込まれている: suv.glb, police2.glb 等)。その場合に
 * rotation.x だけ回すとタイヤがモデル原点周りを公転して空中を飛ぶので、
 * ジオメトリのバウンディングボックス中心を回転中心として position も補正する。
 *
 * 回転軸はローカルX軸の円筒 (y/z が直径) だけを対象にする。それ以外の形状は
 * 軸を確実に決められないので回さない (回らないだけで位置はずれない)。
 */

import * as THREE from 'three';

const TWO_PI = Math.PI * 2;
const _spinQ = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * root 配下から名前に wheel/tire を含むメッシュを収集する。
 * @param {THREE.Object3D} root
 * @returns {object[]} spinWheels / resetWheels に渡すリスト
 */
export function collectWheels(root) {
    const wheels = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        if (!o.isMesh || !/wheel|tire/i.test(o.name)) return;
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        if (bb.isEmpty()) return;
        const size = new THREE.Vector3();
        bb.getSize(size);
        // 車軸=ローカルX軸の円筒か (y/z がほぼ等しい=直径)
        if (Math.abs(size.y - size.z) > Math.min(size.y, size.z) * 0.25) return;
        // 回転中心 (親ローカル空間) と車軸方向
        const center = new THREE.Vector3();
        bb.getCenter(center);
        center.applyMatrix4(o.matrix);
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion).normalize();
        const s = Math.abs(o.getWorldScale(_scale).y);
        wheels.push({
            obj: o,
            radius: Math.max(0.05, (size.y / 2) * s),
            center,
            axis,
            basePos: o.position.clone(),
            baseQuat: o.quaternion.clone(),
        });
    });
    return wheels;
}

/**
 * 走行距離に応じてホイールを回す。
 * @param {object[]} wheels collectWheels の戻り値
 * @param {number} dist 累計走行距離 (世界単位)
 */
export function spinWheels(wheels, dist) {
    for (const w of wheels) {
        _spinQ.setFromAxisAngle(w.axis, (dist / w.radius) % TWO_PI);
        w.obj.quaternion.multiplyQuaternions(_spinQ, w.baseQuat);
        w.obj.position.copy(w.basePos).sub(w.center).applyQuaternion(_spinQ).add(w.center);
    }
}

/** ホイールを読み込み時の姿勢に戻す (まちモード終了時の復元用) */
export function resetWheels(wheels) {
    for (const w of wheels) {
        w.obj.position.copy(w.basePos);
        w.obj.quaternion.copy(w.baseQuat);
    }
}
