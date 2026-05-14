/**
 * UI制御 (オーバーレイ方式)。
 * - 色トリガー(右下) → 色オーバーレイ (色のみ・グラデーション対応)
 * - ブラシトリガー(左下) → ブラシオーバーレイ (ペン/スプレー/けしごむ)
 * - サイズはスライダーで外だし
 * - メニュー(左上) → モデル選択オーバーレイ・ほぞん・まっしろにもどす
 * 描画/回転のモード切り替えはなく、入力位置とジェスチャから動作が決まる。
 */

import { modelRegistry } from './models/index.js';

const COLORS = [
    '#FF4757', '#FF6B81', '#FFA502', '#ECCC68', '#FFEAA7',
    '#7BED9F', '#2ED573', '#1E90FF', '#70A1FF', '#3742FA',
    '#5352ED', '#A4B0BE', '#CED6E0', '#2F3542', '#8B4513', '#D2691E',
    '#FFFFFF',
];

const DEFAULT_SIZE = 40;

const BRUSH_ICONS = {
    pen: '✏️',
    spray: '💨',
    pattern: '✦',
};

const PATTERN_SHAPES = [
    { id: 'star',     label: 'ほし',   symbol: '★' },
    { id: 'heart',    label: 'ハート',  symbol: '♥' },
    { id: 'circle',   label: 'まる',   symbol: '●' },
    { id: 'triangle', label: 'さんかく', symbol: '▲' },
];

const OVERLAY_ANIM_MS = 180;

export class UI {
    /**
     * @param {object} callbacks
     *   onColorChange(colorSpec)  // { type:'solid', color } | { type:'gradient', colors:[a,b] }
     *   onToolChange('pen'|'spray')
     *   onSizeChange(sizePx)
     *   onModelChange(modelId)
     *   onSave()
     *   onClear()
     */
    constructor(callbacks) {
        this.cb = callbacks;
        this.state = {
            colorSpec: { type: 'solid', color: COLORS[0] },
            size: DEFAULT_SIZE,
            tool: 'pen',
            patternShape: 'star',
            modelId: modelRegistry[0].id,
        };
        /** @type {Map<number, {startColor:string, startBtn:HTMLElement}>} */
        this._activeColorTouches = new Map();
        /** タッチセッション中に触れた色を順序付きで蓄積 (1色=単色 / 2色以上=グラデーション) */
        /** @type {string[]} */
        this._touchedColors = [];
        /** タッチで処理した直後の click を抑制するためのフラグ */
        this._suppressColorClick = false;
    }

    setup() {
        this._setupBrushTrigger();
        this._setupBrushOverlay();
        this._setupColorTrigger();
        this._setupColorOverlay();
        this._setupSizeSlider();
        this._setupMenu();
        this._setupModelOverlay();
        this._setupDriveExit();
        this._updateColorTriggerPreview();
        this._updateBrushTriggerPreview();
    }

    /** ドライブモード中は塗り系UIを隠して退出ボタンだけ出す */
    setDriveMode(active) {
        document.body.classList.toggle('drive-mode', active);
        const exit = document.getElementById('drive-exit');
        if (exit) exit.hidden = !active;
    }

    getState() {
        return {
            color: this.state.colorSpec,
            size: this.state.size,
            tool: this.state.tool,
            patternShape: this.state.patternShape,
            modelId: this.state.modelId,
        };
    }

    // ---------- 色トリガー ----------
    _setupColorTrigger() {
        const trigger = document.getElementById('color-trigger');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openOverlay('color-overlay');
        });
    }

    _updateColorTriggerPreview() {
        const inner = document.querySelector('#color-trigger .color-trigger-inner');
        if (!inner) return;
        const spec = this.state.colorSpec;
        if (spec.type === 'gradient') {
            inner.style.background = `linear-gradient(135deg, ${spec.colors[0]} 0%, ${spec.colors[1]} 100%)`;
        } else {
            inner.style.background = spec.color;
        }
    }

    // ---------- ブラシトリガー ----------
    _setupBrushTrigger() {
        const trigger = document.getElementById('brush-trigger');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openOverlay('brush-overlay');
        });
    }

    _updateBrushTriggerPreview() {
        const inner = document.getElementById('brush-trigger-inner');
        if (!inner) return;
        if (this.state.tool === 'pattern') {
            const shape = PATTERN_SHAPES.find((s) => s.id === this.state.patternShape);
            inner.textContent = shape ? shape.symbol : '✦';
        } else {
            inner.textContent = BRUSH_ICONS[this.state.tool] ?? '✏️';
        }
    }

    // ---------- 色オーバーレイ ----------
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
        overlay.querySelectorAll('[data-close="color"]').forEach((el) => {
            el.addEventListener('click', () => this._closeOverlay('color-overlay'));
        });

        // タッチ: identifier ベースで複数指を確実に追跡し、最後の指が離れた時点で確定
        // (PointerEvent ではモバイルブラウザによって2本目以降が拾えないことがある)
        grid.addEventListener('touchstart', (e) => this._onColorTouchStart(e), { passive: false });
        grid.addEventListener('touchmove', (e) => this._onColorTouchMove(e), { passive: false });
        grid.addEventListener('touchend', (e) => this._onColorTouchEnd(e), { passive: false });
        grid.addEventListener('touchcancel', (e) => this._onColorTouchEnd(e), { passive: false });

        // マウス: クリック=単色 / ドラッグして別ボタンで離す=グラデーション
        grid.addEventListener('mousedown', (e) => this._onColorMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onColorMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onColorMouseUp(e));
    }

    // ---------- タッチ ----------

    _touchToColorBtn(touch) {
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        return el && el.closest ? el.closest('.color-btn') : null;
    }

    _registerTouchedColor(color) {
        if (!color) return;
        if (!this._touchedColors.includes(color)) this._touchedColors.push(color);
    }

    /** 他の指が同じボタンに乗っている (またはそのボタンが他の指の起点) */
    _isBtnHeldByOthers(btn, exceptId) {
        for (const [id, st] of this._activeColorTouches) {
            if (id === exceptId) continue;
            if (st.currentHoverBtn === btn || st.startBtn === btn) return true;
        }
        return false;
    }

    _onColorTouchStart(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            const btn = this._touchToColorBtn(t);
            if (!btn) continue;
            this._activeColorTouches.set(t.identifier, {
                startColor: btn.dataset.color,
                startBtn: btn,
                currentHoverBtn: btn,
            });
            this._registerTouchedColor(btn.dataset.color);
            btn.classList.add('pressing');
        }
    }

    _onColorTouchMove(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            const state = this._activeColorTouches.get(t.identifier);
            if (!state) continue;
            const newBtn = this._touchToColorBtn(t);
            const oldBtn = state.currentHoverBtn;
            if (newBtn === oldBtn) continue;

            // 通過したボタンは元に戻す (他の指が乗っていない & 起点でもない場合)
            if (oldBtn && oldBtn !== state.startBtn && !this._isBtnHeldByOthers(oldBtn, t.identifier)) {
                oldBtn.classList.remove('hovering');
            }
            if (newBtn && newBtn !== state.startBtn) {
                newBtn.classList.add('hovering');
            }
            state.currentHoverBtn = newBtn;
            if (newBtn) this._registerTouchedColor(newBtn.dataset.color);
        }
    }

    _onColorTouchEnd(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            const state = this._activeColorTouches.get(t.identifier);
            if (!state) continue;
            // ドラッグで別ボタンに移動して離した場合もその色を候補に加える
            const endBtn = this._touchToColorBtn(t);
            if (endBtn) this._registerTouchedColor(endBtn.dataset.color);
            // この指が乗っていたボタンの hovering を片付け (他の指が乗っていなければ)
            const cur = state.currentHoverBtn;
            if (cur && cur !== state.startBtn && !this._isBtnHeldByOthers(cur, t.identifier)) {
                cur.classList.remove('hovering');
            }
            this._activeColorTouches.delete(t.identifier);
        }

        // 全ての指が離れた時点で確定 (タッチ→synthetic click を抑制)
        if (this._activeColorTouches.size === 0) {
            const colors = this._touchedColors;
            this._touchedColors = [];
            this._clearColorBtnStates();
            if (colors.length === 0) return;
            this._suppressColorClick = true;
            setTimeout(() => { this._suppressColorClick = false; }, 400);
            if (colors.length >= 2) {
                this._applyColorSelection({ type: 'gradient', colors: [colors[0], colors[colors.length - 1]] });
            } else {
                this._applyColorSelection({ type: 'solid', color: colors[0] });
            }
        }
    }

    // ---------- マウス ----------

    _onColorMouseDown(e) {
        if (this._suppressColorClick) return;
        const btn = e.target.closest('.color-btn');
        if (!btn) return;
        this._mouseColorStart = { startColor: btn.dataset.color, startBtn: btn, lastColor: btn.dataset.color };
        btn.classList.add('pressing');
    }

    _onColorMouseMove(e) {
        const start = this._mouseColorStart;
        if (!start) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const btn = el && el.closest ? el.closest('.color-btn') : null;
        if (!btn) return;
        if (btn !== start.startBtn) btn.classList.add('hovering');
        start.lastColor = btn.dataset.color;
    }

    _onColorMouseUp(e) {
        const start = this._mouseColorStart;
        if (!start) return;
        this._mouseColorStart = null;
        const spec = (start.lastColor && start.lastColor !== start.startColor)
            ? { type: 'gradient', colors: [start.startColor, start.lastColor] }
            : { type: 'solid', color: start.startColor };
        this._clearColorBtnStates();
        this._applyColorSelection(spec);
    }

    _clearColorBtnStates() {
        document.querySelectorAll('.color-btn.pressing, .color-btn.hovering')
            .forEach((b) => b.classList.remove('pressing', 'hovering'));
    }

    _applyColorSelection(spec) {
        this.state.colorSpec = spec;
        this._updateColorTriggerPreview();
        this.cb.onColorChange(spec);
        this._closeOverlay('color-overlay');
    }

    // ---------- ブラシオーバーレイ ----------
    _setupBrushOverlay() {
        const overlay = document.getElementById('brush-overlay');
        overlay.querySelectorAll('[data-close="brush"]').forEach((el) => {
            el.addEventListener('click', () => this._closeOverlay('brush-overlay'));
        });
        overlay.querySelectorAll('.brush-card').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._setTool(btn.dataset.brush);
                // pattern ツール選択時はオーバーレイを閉じず形選択を表示
                if (btn.dataset.brush !== 'pattern') {
                    this._closeOverlay('brush-overlay');
                }
            });
        });

        // 形選択ボタン
        const shapeGrid = document.getElementById('shape-grid');
        PATTERN_SHAPES.forEach((s) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `shape-card${s.id === this.state.patternShape ? ' active' : ''}`;
            btn.dataset.shape = s.id;
            btn.innerHTML = `<span class="shape-card-symbol">${s.symbol}</span><span class="shape-card-label">${s.label}</span>`;
            btn.addEventListener('click', () => {
                this._setPatternShape(s.id);
                this._closeOverlay('brush-overlay');
            });
            shapeGrid.appendChild(btn);
        });
    }

    _setTool(tool) {
        this.state.tool = tool;
        document.querySelectorAll('.brush-card').forEach((b) => {
            b.classList.toggle('active', b.dataset.brush === tool);
        });
        // もようパネルの表示切り替え
        const patternPanel = document.getElementById('pattern-shape-panel');
        if (patternPanel) patternPanel.hidden = tool !== 'pattern';
        this._updateColorTriggerPreview();
        this._updateBrushTriggerPreview();
        this.cb.onToolChange(tool);
    }

    _setPatternShape(shape) {
        this.state.patternShape = shape;
        document.querySelectorAll('.shape-card').forEach((b) => {
            b.classList.toggle('active', b.dataset.shape === shape);
        });
        this._updateBrushTriggerPreview();
    }

    // ---------- サイズスライダー ----------
    _setupSizeSlider() {
        const slider = document.getElementById('size-slider');
        slider.value = String(this.state.size);
        const apply = () => {
            const v = Number(slider.value);
            this.state.size = v;
            this.cb.onSizeChange(v);
        };
        slider.addEventListener('input', apply);
    }

    // ---------- メニュー ----------
    _setupMenu() {
        const menuButton = document.getElementById('menu-button');
        const dropdown = document.getElementById('menu-dropdown');

        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!menuButton.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        document.getElementById('menu-save').addEventListener('click', () => {
            dropdown.classList.remove('show');
            this.cb.onSave();
        });
        document.getElementById('menu-clear').addEventListener('click', () => {
            dropdown.classList.remove('show');
            this.cb.onClear();
        });
        document.getElementById('menu-model').addEventListener('click', () => {
            dropdown.classList.remove('show');
            this._openOverlay('model-overlay');
        });
        document.getElementById('menu-drive').addEventListener('click', () => {
            dropdown.classList.remove('show');
            this.cb.onDriveToggle?.(true);
        });
        document.getElementById('menu-fullscreen').addEventListener('click', () => {
            dropdown.classList.remove('show');
            this._toggleFullscreen();
        });

        document.addEventListener('fullscreenchange', () => this._updateFullscreenLabel());
        document.addEventListener('webkitfullscreenchange', () => this._updateFullscreenLabel());
    }

    _toggleFullscreen() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
            const root = document.documentElement;
            if (root.requestFullscreen) root.requestFullscreen();
            else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        }
    }

    _updateFullscreenLabel() {
        const item = document.getElementById('menu-fullscreen');
        if (!item) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        item.textContent = fsEl ? 'ぜんがめんをやめる' : 'ぜんがめん';
    }

    _setupDriveExit() {
        const btn = document.getElementById('drive-exit');
        if (!btn) return;
        btn.addEventListener('click', () => {
            this.cb.onDriveToggle?.(false);
        });
    }

    // ---------- モデル選択 ----------
    _setupModelOverlay() {
        const grid = document.getElementById('model-grid');
        modelRegistry.forEach((m) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `model-card${m.id === this.state.modelId ? ' active' : ''}`;
            card.dataset.model = m.id;
            card.innerHTML = `
                <span class="model-card-icon">${m.icon}</span>
                <span class="model-card-label">${m.label}</span>
            `;
            card.addEventListener('click', () => {
                this._selectModel(m.id);
            });
            grid.appendChild(card);
        });

        const overlay = document.getElementById('model-overlay');
        overlay.querySelectorAll('[data-close="model"]').forEach((el) => {
            el.addEventListener('click', () => this._closeOverlay('model-overlay'));
        });
    }

    _selectModel(id) {
        this.state.modelId = id;
        document.querySelectorAll('.model-card').forEach((c) => {
            c.classList.toggle('active', c.dataset.model === id);
        });
        this._closeOverlay('model-overlay');
        this.cb.onModelChange(id);
    }

    // ---------- オーバーレイ汎用 ----------
    _openOverlay(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.hidden = false;
        requestAnimationFrame(() => el.classList.add('open'));
    }

    _closeOverlay(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('open');
        setTimeout(() => { el.hidden = true; }, OVERLAY_ANIM_MS);
    }
}
