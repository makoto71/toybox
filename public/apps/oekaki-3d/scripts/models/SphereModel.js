import * as THREE from 'three';
import { PaintableModel } from './PaintableModel.js';

export class SphereModel extends PaintableModel {
    constructor() {
        super(new THREE.SphereGeometry(1.2, 64, 48), { surfaceCount: 1 });
        this.id = 'sphere';
        this.label = 'たま';
    }
}
