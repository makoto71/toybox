/**
 * まちモードの自動運転ロジック。
 *
 * 道路網 (碁盤目) のグラフ上を、左側通行で走行する:
 *   - 交差点ごとに直進/左折/右折をランダムに選択 (グリッド外へは出ない)
 *   - 曲がるときは停止線でいったん完全停止してから曲がる
 *   - 信号 (SignalController) に従う。黄・赤では停止、青で発進
 *   - 速度は加速度/減速度の上限を守って連続的に変化させる
 *     (停止距離 v^2/2a を逆算して滑らかに減速)
 *
 * 経路は「直線の接近セグメント」と「交差点内セグメント (直進 or ベジェ曲線)」を
 * 交互にキューに積み、走行しながら先のレッグを計画する。
 *
 * 複数台 (ユーザー車 + NPC) は Traffic を共有して衝突を避ける:
 *   - 車間維持: 自分の進行方向の前方至近に他車がいたら追従減速
 *   - 交差点予約: 交差点内には同時に1台だけ。予約が取れるまで停止線で待つ
 */

import * as THREE from 'three';

const CRUISE = 6.0;        // 巡航速度 (units/s) ≒ 40km/h 相当
const ACCEL = 2.4;
const BRAKE = 3.6;
const THRU_SPEED = 4.4;    // 交差点直進時
const LEFT_SPEED = 2.0;    // 左折 (小回り)
const RIGHT_SPEED = 2.5;   // 右折 (大回り)
const PAUSE_SEC = 0.9;     // 曲がる前の一時停止時間
const CURVE_SAMPLES = 24;

// 車間維持
const FOLLOW_RANGE = 13;     // 前方この距離まで他車を見る
const CAR_CLEARANCE = 3.4;   // 車体長ぶん + 余裕 (これ以下に詰めない)
const FOLLOW_LATERAL = 1.35; // 同一車線とみなす横ずれ (対向車線は 2.2 離れている)
const RESERVE_STEAL_SEC = 7; // 予約待ちがこれを超えたら強行 (グリッドロック回避)

// 方向: 0=北(-Z) 1=東(+X) 2=南(+Z) 3=西(-X)
const DIRS = [
    { dx: 0, dz: -1 },
    { dx: 1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: -1, dz: 0 },
];
const leftOf = (d) => ({ dx: d.dz, dz: -d.dx });   // 進行方向の左 (上から見て)
const axisOf = (d) => (d.dx === 0 ? 'NS' : 'EW');
const nodeKey = (n) => `${n.i},${n.j}`;

/** 全車が共有する交通レジストリ (車間維持の相手検索 + 交差点の占有予約) */
export class Traffic {
    constructor() {
        /** @type {CarDriver[]} */
        this.cars = [];
        /** @type {Map<string, {driver:CarDriver, dir:{dx:number,dz:number}, action:string}[]>}
         *  交差点ノードキー → 通過中の車 (対向直進同士のみ同時通過を許す) */
        this.reservations = new Map();
    }

    add(driver) {
        this.cars.push(driver);
    }

    remove(driver) {
        const i = this.cars.indexOf(driver);
        if (i >= 0) this.cars.splice(i, 1);
        for (const [k, list] of this.reservations) {
            const filtered = list.filter((e) => e.driver !== driver);
            if (filtered.length === 0) this.reservations.delete(k);
            else this.reservations.set(k, filtered);
        }
    }

    tryReserve(key, driver, dir, action) {
        const list = this.reservations.get(key);
        if (!list || list.length === 0) {
            this.reservations.set(key, [{ driver, dir, action }]);
            return true;
        }
        if (list.some((e) => e.driver === driver)) return true;
        // 進路が交差しない組み合わせ = お互い直進かつ正反対の向き
        const ok = action === 'straight' && list.every((e) =>
            e.action === 'straight' && e.dir.dx === -dir.dx && e.dir.dz === -dir.dz);
        if (ok) {
            list.push({ driver, dir, action });
            return true;
        }
        return false;
    }

    /** 待ちすぎたときの強行用。既存の占有に関係なく自分を載せる */
    forceReserve(key, driver, dir, action) {
        const list = this.reservations.get(key) ?? [];
        if (!list.some((e) => e.driver === driver)) list.push({ driver, dir, action });
        this.reservations.set(key, list);
    }

    release(key, driver) {
        const list = this.reservations.get(key);
        if (!list) return;
        const filtered = list.filter((e) => e.driver !== driver);
        if (filtered.length === 0) this.reservations.delete(key);
        else this.reservations.set(key, filtered);
    }
}

export class CarDriver {
    /**
     * @param {{roads:number[], RW:number, LANE:number, STOP:number}} graph
     * @param {{state:(axis:string)=>('g'|'y'|'r')}} signals
     * @param {{traffic?:Traffic, cruise?:number, startNode?:{i:number,j:number}, startDir?:{dx:number,dz:number}}} [opts]
     */
    constructor(graph, signals, opts = {}) {
        this.graph = graph;
        this.signals = signals;
        this.traffic = opts.traffic ?? null;
        this.cruise = opts.cruise ?? CRUISE;

        /** @type {object[]} セグメントキュー (先頭が現在走行中) */
        this.queue = [];
        this.s = 0;            // 現在セグメント内の走行距離
        this.v = 0;            // 現在速度
        this.accel = 0;        // 直近の加速度 (表示用)
        this.dist = 0;         // 総走行距離 (ホイール回転用)
        this.stopTimer = 0;
        this._reserveWait = 0; // 交差点予約が取れず待っている時間

        this.pos = new THREE.Vector3();
        this.tangent = new THREE.Vector3(0, 0, 1);
        this.yaw = 0;
        this.yawRate = 0;      // rad/s (車体ロール用)
        this._prevYaw = null;

        // 出発: 既定は中央寄りのノードから東向きに
        this._planNode = opts.startNode ?? { i: 0, j: 1 };
        this._planDir = opts.startDir ?? DIRS[1];
        while (this.queue.length < 5) this._planLeg();
        this._sample(0);
        this.traffic?.add(this);
    }

    /** Traffic から外れる (NPC破棄時)。保持中の交差点予約も解放される */
    detach() {
        this.traffic?.remove(this);
        this.traffic = null;
    }

    // ---------- 経路計画 ----------

    _nodePos(n) {
        return { x: this.graph.roads[n.i], z: this.graph.roads[n.j] };
    }

    _valid(n) {
        return n.i >= 0 && n.j >= 0 && n.i < this.graph.roads.length && n.j < this.graph.roads.length;
    }

    _step(n, d) {
        return { i: n.i + d.dx, j: n.j + d.dz };
    }

    /** 車線上の点: ノード位置 + 進行方向 along + 左側通行オフセット */
    _lanePoint(n, d, along) {
        const p = this._nodePos(n);
        const l = leftOf(d);
        return {
            x: p.x + d.dx * along + l.dx * this.graph.LANE,
            z: p.z + d.dz * along + l.dz * this.graph.LANE,
        };
    }

    /** 1レッグ = 接近直線 + 交差点内セグメント をキューへ追加 */
    _planLeg() {
        const { STOP } = this.graph;
        const from = this._planNode;
        const dir = this._planDir;
        const to = this._step(from, dir);

        // 接近セグメント: from の出口 → to の停止線
        const a = this._lanePoint(from, dir, STOP);
        const b = this._lanePoint(to, dir, -STOP);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const approach = {
            kind: 'line', ax: a.x, az: a.z, bx: b.x, bz: b.z, len,
            limit: this.cruise,
            event: {
                node: to,
                dir,
                axis: axisOf(dir),
                action: null,       // 'straight' | 'turn'
                committed: false,
                pauseDone: false,
            },
        };

        // 交差点での進路選択
        const candidates = [];
        const straight = dir;
        const left = leftOf(dir);
        const right = { dx: -left.dx, dz: -left.dz };
        if (this._valid(this._step(to, straight))) candidates.push({ d: straight, w: 0.5, turn: null });
        if (this._valid(this._step(to, left))) candidates.push({ d: left, w: 0.25, turn: 'left' });
        if (this._valid(this._step(to, right))) candidates.push({ d: right, w: 0.25, turn: 'right' });
        let total = 0;
        for (const c of candidates) total += c.w;
        let pick = candidates[0];
        let roll = Math.random() * total;
        for (const c of candidates) {
            roll -= c.w;
            if (roll <= 0) { pick = c; break; }
        }
        approach.event.action = pick.turn ? 'turn' : 'straight';

        // 交差点内セグメント: 停止線 → 出口
        const exit = this._lanePoint(to, pick.d, STOP);
        let inter;
        if (!pick.turn) {
            const ilen = Math.hypot(exit.x - b.x, exit.z - b.z);
            inter = {
                kind: 'line', ax: b.x, az: b.z, bx: exit.x, bz: exit.z, len: ilen,
                limit: THRU_SPEED, releaseNode: to,
            };
        } else {
            // 二次ベジェ: 制御点は両車線の延長線の交点
            const cx = (dir.dx === 0) ? b.x : exit.x;
            const cz = (dir.dx === 0) ? exit.z : b.z;
            const pts = [];
            for (let k = 0; k <= CURVE_SAMPLES; k++) {
                const t = k / CURVE_SAMPLES;
                const mt = 1 - t;
                pts.push({
                    x: mt * mt * b.x + 2 * mt * t * cx + t * t * exit.x,
                    z: mt * mt * b.z + 2 * mt * t * cz + t * t * exit.z,
                });
            }
            const cum = [0];
            for (let k = 1; k < pts.length; k++) {
                cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
            }
            inter = {
                kind: 'curve', pts, cum, len: cum[cum.length - 1],
                limit: pick.turn === 'left' ? LEFT_SPEED : RIGHT_SPEED,
                releaseNode: to,
            };
        }

        this.queue.push(approach, inter);
        this._planNode = to;
        this._planDir = pick.d;
    }

    // ---------- セグメント上の点 ----------

    _pointAt(seg, s, out) {
        if (seg.kind === 'line') {
            const t = seg.len > 0 ? Math.min(1, Math.max(0, s / seg.len)) : 0;
            out.x = seg.ax + (seg.bx - seg.ax) * t;
            out.z = seg.az + (seg.bz - seg.az) * t;
        } else {
            const cum = seg.cum;
            const target = Math.min(seg.len, Math.max(0, s));
            let k = 1;
            while (k < cum.length - 1 && cum[k] < target) k++;
            const span = cum[k] - cum[k - 1];
            const f = span > 0 ? (target - cum[k - 1]) / span : 0;
            out.x = seg.pts[k - 1].x + (seg.pts[k].x - seg.pts[k - 1].x) * f;
            out.z = seg.pts[k - 1].z + (seg.pts[k].z - seg.pts[k - 1].z) * f;
        }
        return out;
    }

    // ---------- 信号・停止判断 ----------

    /** 現在の接近セグメントのイベントについて「停止線で止まる必要があるか」 */
    _needStop(ev, dEnd) {
        if (ev.committed) return false;
        const sig = this.signals.state(ev.axis);
        const isTurn = ev.action === 'turn';
        ev.blockedByCar = false;

        if (sig === 'g') {
            if (isTurn) {
                // 曲がる場合は青でも停止線で一時停止。停止が済み交差点が空けば発進確定
                if (ev.pauseDone) return !this._commitIfFree(ev);
                return true;
            }
            // 直進: 制動可能距離を切ったら通過を確定 (黄変時に急停止しない)
            if (dEnd < (this.v * this.v) / (2 * BRAKE * 0.8) + 1.0) {
                return !this._commitIfFree(ev);
            }
            return false;
        }
        return true; // 黄・赤は停止 (committed 済みなら上で返っている)
    }

    /** 交差点の占有予約が取れたら通過を確定する */
    _commitIfFree(ev) {
        if (!this.traffic || this.traffic.tryReserve(nodeKey(ev.node), this, ev.dir, ev.action)) {
            ev.committed = true;
            return true;
        }
        ev.blockedByCar = true;
        return false;
    }

    // ---------- 毎フレーム更新 ----------

    update(dt) {
        if (dt <= 0) return;
        const seg = this.queue[0];
        const dEnd = Math.max(0, seg.len - this.s);
        const ev = seg.event ?? null;
        const needStop = ev ? this._needStop(ev, dEnd) : false;

        // 予約が取れないまま停止線で待ち続けたら強行 (お互い譲り合いで固まる事故防止)
        if (ev?.blockedByCar && this.v < 0.1 && dEnd < 1.0) {
            this._reserveWait += dt;
            if (this._reserveWait >= RESERVE_STEAL_SEC && this.traffic) {
                this.traffic.forceReserve(nodeKey(ev.node), this, ev.dir, ev.action);
                ev.committed = true;
                this._reserveWait = 0;
            }
        } else {
            this._reserveWait = 0;
        }

        // 許容速度 = min(巡航, セグメント制限, 次セグメントへの減速ランプ, 停止ランプ)
        let vA = Math.min(this.cruise, seg.limit);
        const next = this.queue[1];
        if (next && !needStop) {
            vA = Math.min(vA, Math.sqrt(next.limit * next.limit + 2 * BRAKE * dEnd));
        }
        if (needStop) {
            vA = Math.min(vA, Math.sqrt(2 * BRAKE * Math.max(0, dEnd - 0.12)));
        }

        // 車間維持: 進行方向の前方至近にいる最も近い車に合わせて減速
        if (this.traffic) {
            let gap = Infinity;
            let leadV = 0;
            for (const other of this.traffic.cars) {
                if (other === this) continue;
                const fx = other.pos.x - this.pos.x;
                const fz = other.pos.z - this.pos.z;
                const fwd = fx * this.tangent.x + fz * this.tangent.z;
                if (fwd <= 0.01 || fwd >= FOLLOW_RANGE) continue;
                const lat = Math.abs(fx * this.tangent.z - fz * this.tangent.x);
                if (lat > FOLLOW_LATERAL) continue;
                const g = fwd - CAR_CLEARANCE;
                if (g < gap) { gap = g; leadV = other.v; }
            }
            if (gap !== Infinity) {
                vA = Math.min(vA, leadV + Math.sqrt(2 * BRAKE * Math.max(0, gap)));
            }
        }

        const v0 = this.v;
        if (this.v < vA) this.v = Math.min(vA, this.v + ACCEL * dt);
        else this.v = Math.max(vA, this.v - BRAKE * dt);
        this.accel = (this.v - v0) / dt;

        this.s += this.v * dt;
        this.dist += this.v * dt;

        // 停止線到達処理
        if (ev && needStop && dEnd < 0.2 && this.v < 0.1) {
            this.v = 0;
            this.s = Math.min(this.s, seg.len);
            this.stopTimer += dt;
            if (ev.action === 'turn' && this.stopTimer >= PAUSE_SEC) {
                ev.pauseDone = true; // 以降は信号が青になり次第 committed
            }
        }

        // セグメント送り
        while (this.s >= this.queue[0].len - 1e-6) {
            const cur = this.queue[0];
            if (cur.event && !cur.event.committed) {
                // 停止線で待機 (通過が確定していない)
                this.s = cur.len;
                break;
            }
            this.s -= cur.len;
            this.queue.shift();
            this.stopTimer = 0;
            // 交差点を抜けたら占有予約を解放
            if (cur.releaseNode && this.traffic) {
                this.traffic.release(nodeKey(cur.releaseNode), this);
            }
            while (this.queue.length < 5) this._planLeg();
        }

        this._sample(dt);
    }

    _sample(dt) {
        const seg = this.queue[0];
        this._pointAt(seg, this.s, this.pos);
        this.pos.y = 0;

        // 接線: 少し先の点との差分
        const ahead = { x: 0, z: 0 };
        const EPS = 0.18;
        if (this.s + EPS <= seg.len || !this.queue[1]) {
            this._pointAt(seg, this.s + EPS, ahead);
        } else {
            this._pointAt(this.queue[1], this.s + EPS - seg.len, ahead);
        }
        const tx = ahead.x - this.pos.x;
        const tz = ahead.z - this.pos.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 1e-5) {
            this.tangent.set(tx / tl, 0, tz / tl);
            const newYaw = Math.atan2(this.tangent.x, this.tangent.z);
            if (this._prevYaw !== null && dt > 0) {
                let dy = newYaw - this._prevYaw;
                if (dy > Math.PI) dy -= Math.PI * 2;
                if (dy < -Math.PI) dy += Math.PI * 2;
                this.yawRate = dy / dt;
            }
            this._prevYaw = newYaw;
            this.yaw = newYaw;
        }
    }
}

export { CRUISE, DIRS };
