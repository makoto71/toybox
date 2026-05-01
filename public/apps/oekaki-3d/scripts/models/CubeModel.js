import * as THREE from 'three';
import { PaintableModel } from './PaintableModel.js';

/**
 * BoxGeometry は 6 つの groups (面ごと) を持ち、materialIndex 0..5 が割り当てられる。
 * 6面それぞれに別キャンバスを持たせて独立に描けるようにする。
 */
export class CubeModel extends PaintableModel {
    constructor() {
        super(new THREE.BoxGeometry(2, 2, 2), { surfaceCount: 6, textureSize: 1024 });
        this.id = 'cube';
        this.label = 'はこ';
        // 初期で立体感が出る向きにしておく
        this.mesh.rotation.set(0.35, -0.6, 0);
    }
}
