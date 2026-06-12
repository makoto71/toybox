/**
 * まちモードのカメラディレクター。
 *
 * 4つの視点を切り替えられる:
 *   - ついせき   : 車の後方を滑らかに追従する三人称カメラ
 *   - まちかど   : 街角に設置した定点カメラ群。車が離れると自動で最寄りに
 *                  切り替わり (TV中継のカット割り)、望遠ズームで車を追う
 *   - うんてんせき: 運転席視点
 *   - そらから   : 上空からの俯瞰追従
 */

import * as THREE from 'three';

const MODES = [
    { id: 'chase', label: 'ついせき' },
    { id: 'fixed', label: 'まちかど' },
    { id: 'driver', label: 'うんてんせき' },
    { id: 'sky', label: 'そらから' },
];

const FIXED_SWITCH_DIST = 30;  // これ以上離れたら別カメラへ

/** 指数減衰の補間係数 (フレームレート非依存) */
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraDirector {
    /**
     * @param {import('../scene.js').SceneManager} sceneManager
     * @param {{roads:number[], RW:number}} graph
     */
    constructor(sceneManager, graph) {
        this.sceneManager = sceneManager;
        this.modeIndex = 0;

        this._look = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._tmp2 = new THREE.Vector3();
        this._smTangent = new THREE.Vector3(0, 0, 1);
        this._fov = 45;
        this._snapPending = true;

        // 定点カメラ: 市街中心を向く交差点角 + 高所2台
        this.fixedCams = [];
        const roads = graph.roads;
        // 交差点角の縁石上空に設置。信号アーム (高さ~3.4) より上から見下ろす。
        // 建物 (交差点から対角~4.2) にめり込まない範囲。
        const off = 2.7;
        for (let i = 0; i < roads.length; i++) {
            for (let j = 0; j < roads.length; j++) {
                if ((i + j) % 2 !== 0) continue;
                const sx = roads[i] > 0 ? -1 : 1;
                const sz = roads[j] > 0 ? -1 : 1;
                this.fixedCams.push(new THREE.Vector3(
                    roads[i] + sx * off,
                    5.2 + ((i * 7 + j * 13) % 5) * 0.5,
                    roads[j] + sz * off,
                ));
            }
        }
        // 高所カメラ (中心部の交差点角の上空)
        this.fixedCams.push(new THREE.Vector3(roads[1] + 3.0, 11.5, roads[2] + 3.0));
        this.fixedCams.push(new THREE.Vector3(roads[2] - 3.0, 12.5, roads[1] - 3.0));
        this.currentFixed = null;
    }

    /** カメラと車が同じ通り (道路コリドー) 上にあるか。通り沿いなら視線が通る */
    _sameCorridor(camPos, carPos) {
        return Math.abs(camPos.x - carPos.x) < 4.2 || Math.abs(camPos.z - carPos.z) < 4.2;
    }

    get mode() { return MODES[this.modeIndex]; }
    get label() { return MODES[this.modeIndex].label; }

    cycle() {
        this.modeIndex = (this.modeIndex + 1) % MODES.length;
        this._snapPending = true;
        return this.label;
    }

    reset() {
        this.modeIndex = 0;
        this.currentFixed = null;
        this._snapPending = true;
    }

    /**
     * @param {number} dt
     * @param {{pos:THREE.Vector3, tangent:THREE.Vector3, v:number, cruise:number}} car
     */
    update(dt, car) {
        const cam = this.sceneManager.camera;
        const mode = this.mode.id;

        // 進行方向の平滑化 (運転席・追従カメラ用)
        this._smTangent.lerp(car.tangent, damp(5, dt)).normalize();

        let targetFov = 45;

        if (mode === 'chase') {
            const desired = this._tmp.copy(car.pos)
                .addScaledVector(this._smTangent, -5.4)
                .add(this._tmp2.set(0, 2.4, 0));
            const lookDesired = this._tmp2.copy(car.pos)
                .addScaledVector(car.tangent, 1.8)
                .setY(car.pos.y + 0.9);
            if (this._snapPending) {
                cam.position.copy(desired);
                this._look.copy(lookDesired);
                this._snapPending = false;
            } else {
                cam.position.lerp(desired, damp(3.5, dt));
                this._look.lerp(lookDesired, damp(8, dt));
            }
        } else if (mode === 'fixed') {
            // 自動切り替え: 現在のカメラから離れすぎたら最寄りにカット
            const needSwitch = this._snapPending
                || !this.currentFixed
                || this.currentFixed.distanceTo(car.pos) > FIXED_SWITCH_DIST
                || !this._sameCorridor(this.currentFixed, car.pos);
            if (needSwitch) {
                // 車と同じ通り沿いのカメラを優先 (建物に視線を遮られない)
                let best = null;
                let bestD = Infinity;
                for (const c of this.fixedCams) {
                    if (!this._sameCorridor(c, car.pos)) continue;
                    const d = c.distanceTo(car.pos);
                    if (d < bestD) { bestD = d; best = c; }
                }
                if (!best) {
                    for (const c of this.fixedCams) {
                        const d = c.distanceTo(car.pos);
                        if (d < bestD) { bestD = d; best = c; }
                    }
                }
                if (best !== this.currentFixed || this._snapPending) {
                    this.currentFixed = best;
                    // カット = 瞬時切替 (テレビ中継風)
                    this._look.copy(car.pos).y += 0.6;
                    this._snapPending = false;
                }
            }
            cam.position.copy(this.currentFixed);
            const lookDesired = this._tmp.copy(car.pos)
                .addScaledVector(car.tangent, 0.6 + 1.2 * (car.v / car.cruise))
                .setY(car.pos.y + 0.6);
            this._look.lerp(lookDesired, damp(6, dt));
            // 距離に応じた望遠ズーム
            const d = Math.max(2, cam.position.distanceTo(this._look));
            targetFov = THREE.MathUtils.clamp(
                THREE.MathUtils.radToDeg(2 * Math.atan(2.9 / d)), 16, 46);
        } else if (mode === 'driver') {
            cam.position.copy(car.pos)
                .addScaledVector(this._smTangent, 0.3)
                .add(this._tmp2.set(0, 1.18, 0));
            const lookDesired = this._tmp.copy(cam.position)
                .addScaledVector(this._smTangent, 10)
                .add(this._tmp2.set(0, -0.45, 0));
            if (this._snapPending) {
                this._look.copy(lookDesired);
                this._snapPending = false;
            } else {
                this._look.lerp(lookDesired, damp(10, dt));
            }
            targetFov = 55;
        } else { // sky
            const desired = this._tmp.set(car.pos.x + 9, 15.5, car.pos.z + 9);
            const lookDesired = this._tmp2.copy(car.pos);
            if (this._snapPending) {
                cam.position.copy(desired);
                this._look.copy(lookDesired);
                this._snapPending = false;
            } else {
                cam.position.lerp(desired, damp(2.5, dt));
                this._look.lerp(lookDesired, damp(4, dt));
            }
            targetFov = 38;
        }

        // FOV を滑らかに変化 (定点の望遠カットは即時)
        const fovK = (mode === 'fixed') ? 12 : 5;
        this._fov += (targetFov - this._fov) * damp(fovK, dt);
        if (Math.abs(cam.fov - this._fov) > 0.01) {
            cam.fov = this._fov;
            cam.updateProjectionMatrix();
        }

        cam.lookAt(this._look);
        // OrbitControls.update() に上書きされないよう target も同期
        this.sceneManager.controls.target.copy(this._look);
    }
}
