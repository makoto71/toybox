/**
 * UI制御モジュール
 * カラーオーバーレイ、ツール/サイズ/シェイプ選択、背景オーバーレイ、カメラ、メニューを担当する
 */

import { STAMPS, getStampImageUrl } from './stamp-controller.js';

// カラーパレットの色定義（オーバーレイ内のグリッドに使う）
const COLORS = [
    '#FF4757', // レッド
    '#FF6B81', // ピンク
    '#FFA502', // オレンジ
    '#ECCC68', // ライトオレンジ
    '#FFEAA7', // イエロー
    '#7BED9F', // ライトグリーン
    '#2ED573', // グリーン
    '#1E90FF', // ブルー
    '#70A1FF', // ライトブルー
    '#3742FA', // インディゴ
    '#5352ED', // バイオレット
    '#A4B0BE', // グレー
    '#CED6E0', // ライトグレー
    '#2F3542', // ブラック
    '#8B4513', // ブラウン
    '#D2691E', // チョコレート
];

// サイズ定義
const SIZES = {
    small: 20,
    medium: 40,
    large: 60,
};

export class UI {
    /**
     * @param {object} callbacks - { onToolChange, onColorChange, onSizeChange, onShapeChange, onBackgroundChange, onSave }
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.currentColorSpec = { type: 'solid', color: COLORS[0] };
        this.baseSize = SIZES.medium;
        this.currentStampId = (STAMPS[0] && STAMPS[0].id) || 'star';

        // カラーオーバーレイのドラッグ状態
        this._colorDrag = {
            pointerId: null,
            startColor: null,
            startBtn: null,
        };

        // カメラストリーム
        this._cameraStream = null;
    }

    /** 全UIコンポーネントを初期化する */
    setup() {
        this._setupColorTrigger();
        this._setupColorOverlay();
        this._setupTools();
        this._setupStampPicker();
        this._setupSizes();
        this._setupMenu();
        this._setupBackground();
        this._setupCamera();
        this._updateColorTriggerPreview();
        this._applyToolMode('pen');

        // セレクター外クリックで閉じる
        document.addEventListener('click', () => this._closeAllSelectors());
    }

    // --- カラートリガー（ツールバー上のボタン） ---

    _setupColorTrigger() {
        const trigger = document.getElementById('color-trigger');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openColorOverlay();
        });
    }

    _updateColorTriggerPreview() {
        const inner = document.querySelector('#color-trigger .color-trigger-inner');
        if (!inner) return;
        if (this.currentColorSpec.type === 'gradient') {
            const [a, b] = this.currentColorSpec.colors;
            inner.style.background = `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
        } else {
            inner.style.background = this.currentColorSpec.color;
        }
    }

    // --- カラーオーバーレイ ---

    _setupColorOverlay() {
        const grid = document.getElementById('color-grid');
        COLORS.forEach((color) => {
            const btn = document.createElement('div');
            btn.className = 'color-btn';
            btn.dataset.color = color;
            btn.style.backgroundColor = color;
            grid.appendChild(btn);
        });

        const overlay = document.getElementById('color-overlay');

        // 閉じるボタン・バックドロップ
        overlay.querySelectorAll('[data-close="color"]').forEach(el => {
            el.addEventListener('click', () => this._closeColorOverlay());
        });

        // ポインタによるドラッグ検出（単一ポインタでドラッグして別色へ = グラデーション）
        grid.addEventListener('pointerdown', (e) => this._onColorPointerDown(e));
        window.addEventListener('pointermove', (e) => this._onColorPointerMove(e));
        window.addEventListener('pointerup', (e) => this._onColorPointerUp(e));
        window.addEventListener('pointercancel', (e) => this._onColorPointerUp(e));

        // 2本指同時押しによるグラデーション指定
        grid.addEventListener('touchstart', (e) => this._onColorTouchStart(e), { passive: false });
    }

    _openColorOverlay() {
        const overlay = document.getElementById('color-overlay');
        overlay.hidden = false;
        // 次フレームで .open を付与してアニメーション
        requestAnimationFrame(() => overlay.classList.add('open'));
    }

    _closeColorOverlay() {
        const overlay = document.getElementById('color-overlay');
        overlay.classList.remove('open');
        // アニメ終了後に hidden
        setTimeout(() => { overlay.hidden = true; }, 180);
        this._clearColorHighlights();
    }

    _onColorPointerDown(e) {
        const btn = e.target.closest('.color-btn');
        if (!btn) return;
        // 暗黙のポインタキャプチャを解除して elementFromPoint を使えるようにする
        if (btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) {
            btn.releasePointerCapture(e.pointerId);
        }
        this._colorDrag.pointerId = e.pointerId;
        this._colorDrag.startColor = btn.dataset.color;
        this._colorDrag.startBtn = btn;
        btn.classList.add('pressing');
    }

    _onColorPointerMove(e) {
        if (e.pointerId !== this._colorDrag.pointerId) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const hoverBtn = el && el.closest ? el.closest('.color-btn') : null;
        this._highlightHoverColor(hoverBtn);
    }

    _onColorPointerUp(e) {
        if (e.pointerId !== this._colorDrag.pointerId) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const endBtn = el && el.closest ? el.closest('.color-btn') : null;
        const startColor = this._colorDrag.startColor;
        let colorSpec;

        if (endBtn && endBtn !== this._colorDrag.startBtn) {
            colorSpec = { type: 'gradient', colors: [startColor, endBtn.dataset.color] };
        } else if (startColor) {
            colorSpec = { type: 'solid', color: startColor };
        }

        this._colorDrag = { pointerId: null, startColor: null, startBtn: null };
        this._clearColorHighlights();

        if (colorSpec) {
            this._applyColorSelection(colorSpec);
        }
    }

    _onColorTouchStart(e) {
        if (e.touches.length < 2) return;
        // 2本指の最初の2つを拾う
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const b1 = this._touchToColorBtn(t1);
        const b2 = this._touchToColorBtn(t2);
        if (b1 && b2 && b1 !== b2) {
            e.preventDefault();
            this._applyColorSelection({
                type: 'gradient',
                colors: [b1.dataset.color, b2.dataset.color],
            });
            this._colorDrag = { pointerId: null, startColor: null, startBtn: null };
        }
    }

    _touchToColorBtn(touch) {
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        return el && el.closest ? el.closest('.color-btn') : null;
    }

    _highlightHoverColor(btn) {
        document.querySelectorAll('.color-btn.hovering').forEach(b => {
            if (b !== btn) b.classList.remove('hovering');
        });
        if (btn) btn.classList.add('hovering');
    }

    _clearColorHighlights() {
        document.querySelectorAll('.color-btn.pressing, .color-btn.hovering')
            .forEach(b => b.classList.remove('pressing', 'hovering'));
    }

    _applyColorSelection(colorSpec) {
        this.currentColorSpec = colorSpec;
        this._updateColorTriggerPreview();
        this._updateStampTriggerPreview();
        this.callbacks.onColorChange(colorSpec);
        this._closeColorOverlay();
    }

    // --- ツール / シェイプ / サイズ ---

    _setupTools() {
        const selector = document.getElementById('tool-selector');
        const selectedIcon = selector.querySelector('.selected-icon');
        const options = selector.querySelector('.options');

        this._updateSelectorDisplay(selector, 'tool-pen');

        selectedIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeAllSelectors(selector);
            selector.classList.toggle('expanded');
        });

        options.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tool = btn.dataset.tool;
                this.setTool(tool);
                selector.classList.remove('expanded');
            });
        });
    }

    // --- スタンプピッカー（モーダル） ---

    _setupStampPicker() {
        const trigger = document.getElementById('stamp-trigger');
        const overlay = document.getElementById('stamp-overlay');
        const grid = document.getElementById('stamp-grid');

        // グリッドにスタンプボタンを生成
        grid.innerHTML = '';
        STAMPS.forEach((stamp) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'stamp-option';
            btn.dataset.stamp = stamp.id;
            btn.title = stamp.label;
            const img = document.createElement('img');
            img.alt = stamp.label;
            img.draggable = false;
            getStampImageUrl(stamp.id).then(url => { img.src = url; });
            btn.appendChild(img);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._selectStamp(stamp.id);
                this._closeStampOverlay();
            });
            grid.appendChild(btn);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openStampOverlay();
        });

        overlay.querySelectorAll('[data-close="stamp"]').forEach(el => {
            el.addEventListener('click', () => this._closeStampOverlay());
        });

        // 初期プレビュー
        this._updateStampTriggerPreview();
    }

    _openStampOverlay() {
        const overlay = document.getElementById('stamp-overlay');
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('open'));
    }

    _closeStampOverlay() {
        const overlay = document.getElementById('stamp-overlay');
        overlay.classList.remove('open');
        setTimeout(() => { overlay.hidden = true; }, 180);
    }

    _selectStamp(shapeId) {
        this.currentStampId = shapeId;
        this._updateStampTriggerPreview();
        this.callbacks.onShapeChange(shapeId);
    }

    _updateStampTriggerPreview() {
        const inner = document.querySelector('#stamp-trigger .stamp-trigger-inner');
        if (!inner) return;
        // 現在選択中の色を反映する。グラデーションは1色目で代表させる。
        const c = this.currentColorSpec;
        const colorOverride = c.type === 'gradient' ? c.colors[0] : c.color;
        getStampImageUrl(this.currentStampId, colorOverride).then(url => {
            inner.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.draggable = false;
            inner.appendChild(img);
        });
    }

    _setupSizes() {
        const selector = document.getElementById('size-selector');
        const selectedIcon = selector.querySelector('.selected-icon');
        const options = selector.querySelector('.options');

        this._updateSelectorDisplay(selector, null, 'medium');

        selectedIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeAllSelectors(selector);
            selector.classList.toggle('expanded');
        });

        options.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sizeKey = btn.dataset.size;
                this.baseSize = SIZES[sizeKey];

                options.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this._updateSelectorDisplay(selector, null, sizeKey);
                selector.classList.remove('expanded');
                this.callbacks.onSizeChange(this.baseSize);
            });
        });
    }

    // --- メニュー ---

    _setupMenu() {
        const menuButton = document.getElementById('menu-button');
        const menuDropdown = document.getElementById('menu-dropdown');
        const menuSave = document.getElementById('menu-save');
        const menuBackground = document.getElementById('menu-background');

        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!menuButton.contains(e.target) && !menuDropdown.contains(e.target)) {
                menuDropdown.classList.remove('show');
            }
        });

        menuSave.addEventListener('click', () => {
            this.callbacks.onSave();
            menuDropdown.classList.remove('show');
        });

        menuBackground.addEventListener('click', () => {
            menuDropdown.classList.remove('show');
            this._openBackgroundOverlay();
        });
    }

    // --- はいけい ---

    _setupBackground() {
        const overlay = document.getElementById('bg-overlay');
        overlay.querySelectorAll('[data-close="bg"]').forEach(el => {
            el.addEventListener('click', () => this._closeBackgroundOverlay());
        });

        const fileInput = document.getElementById('bg-file');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                this.callbacks.onBackgroundChange(img, false);
                URL.revokeObjectURL(url);
                this._closeBackgroundOverlay();
            };
            img.onerror = () => URL.revokeObjectURL(url);
            img.src = url;
            fileInput.value = '';
        });

        document.getElementById('bg-camera').addEventListener('click', () => {
            this._closeBackgroundOverlay();
            this._openCameraOverlay();
        });

        document.getElementById('bg-clear').addEventListener('click', () => {
            this.callbacks.onBackgroundChange(null, false);
            this._closeBackgroundOverlay();
        });
    }

    _openBackgroundOverlay() {
        const overlay = document.getElementById('bg-overlay');
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('open'));
    }

    _closeBackgroundOverlay() {
        const overlay = document.getElementById('bg-overlay');
        overlay.classList.remove('open');
        setTimeout(() => { overlay.hidden = true; }, 180);
    }

    // --- カメラ ---

    _setupCamera() {
        const overlay = document.getElementById('camera-overlay');
        overlay.querySelectorAll('[data-close="camera"]').forEach(el => {
            el.addEventListener('click', () => this._closeCameraOverlay());
        });

        document.getElementById('camera-shutter').addEventListener('click', () => {
            this._captureCameraFrame();
        });
    }

    async _openCameraOverlay() {
        const overlay = document.getElementById('camera-overlay');
        const video = document.getElementById('camera-video');
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('open'));

        try {
            this._cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false,
            });
            video.srcObject = this._cameraStream;
            await video.play().catch(() => {});
        } catch (err) {
            alert('カメラをひらけませんでした。\n' + (err && err.message ? err.message : err));
            this._closeCameraOverlay();
        }
    }

    _closeCameraOverlay() {
        const overlay = document.getElementById('camera-overlay');
        overlay.classList.remove('open');
        setTimeout(() => { overlay.hidden = true; }, 180);

        const video = document.getElementById('camera-video');
        if (this._cameraStream) {
            this._cameraStream.getTracks().forEach(t => t.stop());
            this._cameraStream = null;
        }
        video.srcObject = null;
    }

    _captureCameraFrame() {
        const video = document.getElementById('camera-video');
        if (!video || !video.videoWidth) return;

        // 動画フレームをcanvasに写して静止画化
        const snap = document.createElement('canvas');
        snap.width = video.videoWidth;
        snap.height = video.videoHeight;
        const ctx = snap.getContext('2d');
        ctx.drawImage(video, 0, 0, snap.width, snap.height);

        // インカメラは左右反転（鏡像）で背景に
        this.callbacks.onBackgroundChange(snap, true);
        this._closeCameraOverlay();
    }

    // --- ツール切替 ---

    /** ツールを切り替える */
    setTool(toolName) {
        this._updateSelectorDisplay(document.getElementById('tool-selector'), `tool-${toolName}`);
        this._applyToolMode(toolName);
        this.callbacks.onToolChange(toolName);
    }

    _applyToolMode(toolName) {
        const toolbox = document.getElementById('toolbox');
        if (!toolbox) return;
        if (toolName === 'stamp') {
            toolbox.classList.add('stamp-mode');
        } else {
            toolbox.classList.remove('stamp-mode');
        }
    }

    _updateSelectorDisplay(selector, activeId, sizeKey, shapeKey) {
        const display = selector.querySelector('.selected-icon');
        display.innerHTML = '';

        let activeBtn;
        if (activeId) {
            activeBtn = selector.querySelector(`#${activeId}`);
        } else if (sizeKey) {
            activeBtn = selector.querySelector(`[data-size="${sizeKey}"]`);
        } else if (shapeKey) {
            activeBtn = selector.querySelector(`[data-shape="${shapeKey}"]`);
        } else {
            activeBtn = selector.querySelector('.active');
        }

        if (activeBtn) {
            const clone = activeBtn.cloneNode(true);
            clone.classList.remove('active');
            display.appendChild(clone);

            if (activeId) {
                selector.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                activeBtn.classList.add('active');
            } else if (shapeKey) {
                selector.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
                activeBtn.classList.add('active');
            }
        }
    }

    _closeAllSelectors(except) {
        document.querySelectorAll('.selector').forEach(el => {
            if (el !== except) el.classList.remove('expanded');
        });
    }
}
