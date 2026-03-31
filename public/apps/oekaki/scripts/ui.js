/**
 * UI制御モジュール
 * カラーパレット、ツール選択、サイズ選択、メニューのセットアップを担当する
 */

// カラーパレットの色定義
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
     * @param {object} callbacks - { onToolChange, onColorChange, onSizeChange, onSave }
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.currentColor = COLORS[0];
        this.baseSize = SIZES.medium;
    }

    /** 全UIコンポーネントを初期化する */
    setup() {
        this._setupColors();
        this._setupTools();
        this._setupSizes();
        this._setupMenu();
    }

    _setupColors() {
        const palette = document.getElementById('color-palette');
        COLORS.forEach((color, index) => {
            const btn = document.createElement('div');
            btn.className = `color-btn ${index === 0 ? 'active' : ''}`;
            btn.style.backgroundColor = color;
            btn.addEventListener('click', () => {
                this.currentColor = color;
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.callbacks.onColorChange(color);
            });
            palette.appendChild(btn);
        });
    }

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

        // セレクター外クリックで閉じる
        document.addEventListener('click', () => this._closeAllSelectors());
    }

    _setupMenu() {
        const menuButton = document.getElementById('menu-button');
        const menuDropdown = document.getElementById('menu-dropdown');
        const menuSave = document.getElementById('menu-save');

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
    }

    /** ツールを切り替える */
    setTool(toolName) {
        this._updateSelectorDisplay(document.getElementById('tool-selector'), `tool-${toolName}`);
        this.callbacks.onToolChange(toolName);
    }

    _updateSelectorDisplay(selector, activeId, sizeKey) {
        const display = selector.querySelector('.selected-icon');
        display.innerHTML = '';

        let activeBtn;
        if (activeId) {
            activeBtn = selector.querySelector(`#${activeId}`);
        } else if (sizeKey) {
            activeBtn = selector.querySelector(`[data-size="${sizeKey}"]`);
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
            }
        }
    }

    _closeAllSelectors(except) {
        document.querySelectorAll('.selector').forEach(el => {
            if (el !== except) el.classList.remove('expanded');
        });
    }
}
