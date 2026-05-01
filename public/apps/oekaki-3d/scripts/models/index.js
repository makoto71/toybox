/**
 * モデル登録レジストリ。
 * 新しいモデルはここに追加するだけで選択肢に出る。
 */

import { SphereModel } from './SphereModel.js';
import { CubeModel } from './CubeModel.js';
import { CarModel } from './CarModel.js';

const CAR_BASE = 'models/';
const car = (id, label, file, icon = '🚗') => ({
    id,
    label,
    icon,
    factory: () => new CarModel({ id, label, url: `${CAR_BASE}${file}` }),
});

export const modelRegistry = [
    { id: 'sphere', label: 'たま', icon: '⚪', factory: () => new SphereModel() },
    { id: 'cube', label: 'はこ', icon: '🟦', factory: () => new CubeModel() },
    car('sedan', 'セダン', 'sedan.glb'),
    car('firetruck', 'しょうぼうしゃ', 'firetruck.glb'),
    car('police', 'パトカー', 'police.glb'),
    car('ambulance', 'きゅうきゅうしゃ', 'ambulance.glb'),
    car('race', 'レーシングカー', 'race.glb'),
    car('kart', 'カート', 'kart-oodi.glb'),
    car('tractor', 'トラクター', 'tractor.glb'),
    car('garbage', 'ゴミしゅうしゅうしゃ', 'garbage-truck.glb'),
    // 働く車 (Poly Pizza, CC-BY)
    car('bulldozer', 'ブルドーザー', 'bulldozer.glb', '🚜'),
    car('excavator', 'ショベルカー', 'excavator.glb', '⛏️'),
    car('dump', 'ダンプカー', 'dump-truck.glb', '🚛'),
    car('schoolbus', 'スクールバス', 'schoolbus.glb', '🚌'),
    car('police2', 'パトカー2', 'police2.glb', '🚓'),
    car('police3', 'パトカー3', 'police3.glb', '🚓'),
    car('suv', 'SUV', 'suv.glb', '🚙'),
    car('van', 'バン', 'van.glb', '🚐'),
];

export function getModelEntry(id) {
    return modelRegistry.find((m) => m.id === id) ?? modelRegistry[0];
}
