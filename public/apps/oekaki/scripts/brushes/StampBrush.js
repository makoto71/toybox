import { BaseBrush } from './BaseBrush.js';

/**
 * スタンプブラシ
 * 実際のスタンプ配置・描画は StampController が行う。
 * ここではツールとしての識別と、現在選択中のシェイプIDを保持する。
 */
export class StampBrush extends BaseBrush {
    constructor() {
        super();
        this.name = 'stamp';
        this.mode = 'stamp';
        this.shape = 'star';
    }

    setShape(shape) {
        this.shape = shape;
    }

    // 描画ロジックは StampController に委譲するため、他のメソッドは未使用。
}
