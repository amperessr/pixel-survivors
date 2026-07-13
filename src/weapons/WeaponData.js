// 五種武器，每種五階，每階外觀/效果/攻擊方式皆不同。
// 技能的體積/數量/範圍/轉速只由「武器等級 + 是否進化」決定，不再受角色能力值影響
// （攻擊力仍會透過統一公式提升所有武器的傷害，爆擊率/爆傷影響爆擊，見 PassiveData）。
// 飛刀／鋸片／劍氣斬是「無屬性」（物理系）武器，之後才能各自跟三個元素
// （火球/雷電/冰霜）融合出對應的元素武器；劍氣斬是這條線的第三把。
export const WEAPON_IDS = ['fireball', 'lightning', 'knife', 'sawblade', 'frost', 'sword'];

export const WEAPON_DATA = {
  fireball: {
    id: 'fireball',
    name: '火球術',
    desc: '朝最近敵人發射火球，命中後爆炸造成範圍傷害。升級可提升傷害、爆炸範圍與數量。',
    projectile: 'proj_fireball',
    synergyStat: 'attack',
    // count：同時發射的火球數（原本是穿透 pierce，改成比照飛刀的「一次射多顆」）
    levels: [
      { dmg: 12, cooldown: 1300, aoe: 26, speed: 260, count: 1 },
      { dmg: 16, cooldown: 1180, aoe: 32, speed: 270, count: 1 },
      { dmg: 22, cooldown: 1060, aoe: 38, speed: 280, count: 2 },
      { dmg: 30, cooldown: 950, aoe: 46, speed: 300, count: 2 },
      { dmg: 42, cooldown: 850, aoe: 58, speed: 320, count: 3 },
    ],
  },
  lightning: {
    id: 'lightning',
    name: '雷電鎖鏈',
    desc: '對最近敵人發射閃電並可跳躍到附近敵人。升級可提升傷害與分裂（跳躍）數。',
    projectile: 'proj_lightning',
    synergyStat: 'critRate',
    levels: [
      { dmg: 10, cooldown: 900, chains: 1, range: 140 },
      { dmg: 13, cooldown: 850, chains: 2, range: 150 },
      { dmg: 17, cooldown: 800, chains: 3, range: 160 },
      { dmg: 22, cooldown: 750, chains: 4, range: 175 },
      { dmg: 30, cooldown: 700, chains: 6, range: 190 },
    ],
  },
  knife: {
    id: 'knife',
    name: '旋風飛刀',
    desc: '朝最近敵人連續投擲飛刀。升級可提升傷害、飛刀數量與穿透。',
    projectile: 'proj_knife',
    synergyStat: 'atkSpeed',
    // pierce 固定為 4（命中數 = pierce+1 = 5），不再隨等級遞增，等級只影響傷害/數量/速度
    levels: [
      { dmg: 8, cooldown: 500, count: 1, speed: 420, pierce: 4 },
      { dmg: 9, cooldown: 460, count: 2, speed: 440, pierce: 4 },
      { dmg: 11, cooldown: 420, count: 2, speed: 460, pierce: 4 },
      { dmg: 13, cooldown: 380, count: 3, speed: 480, pierce: 4 },
      { dmg: 16, cooldown: 340, count: 4, speed: 500, pierce: 4 },
    ],
  },
  sawblade: {
    id: 'sawblade',
    name: '旋轉鋸片',
    desc: '環繞玩家旋轉的鋸片，持續對接觸敵人造成傷害。升級可提升傷害、數量與轉速。',
    projectile: 'proj_sawblade',
    synergyStat: 'atkSpeed',
    levels: [
      { dmg: 6, cooldown: 200, count: 2, radius: 46, rotSpeed: 2.4 },
      { dmg: 7, cooldown: 200, count: 2, radius: 50, rotSpeed: 2.7 },
      { dmg: 9, cooldown: 180, count: 3, radius: 54, rotSpeed: 3.0 },
      { dmg: 11, cooldown: 180, count: 3, radius: 58, rotSpeed: 3.4 },
      { dmg: 14, cooldown: 160, count: 4, radius: 64, rotSpeed: 3.8 },
    ],
  },
  frost: {
    id: 'frost',
    name: '冰霜新星',
    desc: '定期從地面冒出冰柱，減速並傷害範圍內敵人。升級可提升傷害與範圍。',
    projectile: 'proj_frost',
    synergyStat: 'defense',
    // 減速強度統一固定 50%（見 EnemySystem.applySlow），不再逐級增強，所以這裡
    // 只留 slowDuration（減速能持續多久）隨等級提升，沒有 slow 欄位了。
    // 傷害提高至與火球術同級距（原本明顯偏低，冰霜作為控場+輸出雙重定位吃虧）
    levels: [
      { dmg: 12, cooldown: 2600, radius: 70, slowDuration: 1500 },
      { dmg: 16, cooldown: 2400, radius: 82, slowDuration: 1700 },
      { dmg: 22, cooldown: 2200, radius: 94, slowDuration: 1900 },
      { dmg: 30, cooldown: 2000, radius: 108, slowDuration: 2100 },
      { dmg: 42, cooldown: 1800, radius: 126, slowDuration: 2400 },
    ],
  },
  sword: {
    id: 'sword',
    name: '劍氣斬',
    desc: '原地朝最近敵人揮出一道扇形劍氣，範圍內敵人全部受到傷害。升級可提升傷害、範圍與扇形角度。',
    projectile: null, // 不是飛行道具，原地扇形判定（見 WeaponSystem._fireSword）
    synergyStat: 'critDmg',
    // 定位是「單次重擊」：攻速比其他武器慢一截，但傷害拉得比較高做補償，
    // 跟飛刀「密集小刀」形成對比。arcDeg：扇形夾角（度）。
    levels: [
      { dmg: 22, cooldown: 1500, range: 100, arcDeg: 80 },
      { dmg: 29, cooldown: 1400, range: 110, arcDeg: 85 },
      { dmg: 39, cooldown: 1300, range: 120, arcDeg: 90 },
      { dmg: 52, cooldown: 1200, range: 130, arcDeg: 95 },
      { dmg: 70, cooldown: 1100, range: 145, arcDeg: 100 },
    ],
  },
};

// 融合武器：兩把「都滿 5 級、都還沒進化」的武器可以融合成一把全新武器（見
// WeaponSystem.fuseWeapons）。目前先做三組，數值公式統一是「兩把 5 級數值取平均
// 再乘 0.75（避免直接相加爆炸性過強）／冷卻取兩者較短再乘 1.1」；範圍/數量類
// 則是取較大值再放大，讓融合後的武器有明顯的體型/範圍升級感。
// 暫時不開放融合武器再往上進化——之後有需要再加。
export const WEAPON_FUSIONS = {
  lightning_knife: {
    id: 'lightning_knife',
    name: '電擊飛刃',
    parents: ['lightning', 'knife'],
    desc: '飛刀融合雷電。連續投擲帶電飛刀，命中後會對附近一名敵人補上一道連鎖閃電（傷害為本體 50%）。',
    icon: 'weapon_lightning_knife_lv5',
    stats: { dmg: 35, cooldown: 374, count: 5, speed: 500, pierce: 9, chainRange: 130 }, // pierce 9 = 命中數 10
  },
  knife_sawblade: {
    id: 'knife_sawblade',
    name: '血肉風暴',
    parents: ['knife', 'sawblade'],
    desc: '飛刀融合鋸片。環繞身邊形成內外雙層旋轉刀陣，內圈鋸片、外圈飛刀反向旋轉，持續絞碎接觸到的一切。',
    icon: 'weapon_knife_sawblade_lv5',
    stats: { dmg: 23, innerCount: 4, outerCount: 4, innerRadius: 54, outerRadius: 92, rotSpeed: 4.2 },
  },
  fireball_frost: {
    id: 'fireball_frost',
    name: '世界末日',
    parents: ['fireball', 'frost'],
    desc: '火球融合冰霜。分別鎖定兩隻敵人，從天而降砸下隕石與大冰塊：隕石打中直接燃燒目標並留下燃燒地板，冰塊打中直接冰凍目標 1 秒並留下冰霜地板，經過地板的敵人會持續燃燒或減速。同時以自己為中心，冰柱與炎柱交替向八個方向刺出，補上一圈範圍傷害。',
    icon: 'weapon_fireball_frost_lv5',
    // 冷卻從 935 縮短到 700，玩家反應原本開火頻率太慢
    stats: { dmg: 48, cooldown: 700, aoe: 64 },
  },
};

// 依兩個武器 id（順序不拘）找出對應的融合配方，找不到回傳 undefined
export function findFusionFor(idA, idB) {
  return Object.values(WEAPON_FUSIONS).find((f) =>
    (f.parents[0] === idA && f.parents[1] === idB) || (f.parents[0] === idB && f.parents[1] === idA));
}

export function getWeaponLevelData(id, level) {
  const w = WEAPON_DATA[id];
  return { ...w, ...w.levels[Math.min(level, w.levels.length) - 1], level };
}

// 每種武器的擊退設定：force 是推開的力道，duration 是擊退持續多久（毫秒）
export const WEAPON_KNOCKBACK = {
  fireball: { force: 260, duration: 220 },
  lightning: { force: 170, duration: 150 },
  knife: { force: 210, duration: 150 },
  sawblade: { force: 300, duration: 120 },
  frost: { force: 350, duration: 260 },
  sword: { force: 320, duration: 200 },
  // 融合武器與進化版本也使用相同擊退設定
  knife_sawblade: { force: 300, duration: 120 },
};

// 武器五級滿了之後可以「進化」成更強的高階版本，不是單純數值疊加，
// 而是外觀（金色光環）與數值全面躍升的新武器
export const WEAPON_EVOLUTIONS = {
  // cooldownMult 沒指定的話會直接沿用 extraMult（範圍/數量的放大倍率），
  // 但「冷卻時間縮短的倍率」跟「範圍/數量放大的倍率」其實是兩件不同的事，
  // 共用同一個數字容易失控——火球進化成隕石之後就是因為這樣才變得太快，
  // 這裡拆開來讓冷卻可以單獨調鬆一點，不用跟著範圍倍率一起放大。
  fireball: {
    name: '隕石燄爆',
    desc: '火球術的最終進化。不再沿地面飛行，改為鎖定敵人後從天而降砸下巨大隕石，範圍與威力大幅提升。',
    dmgMult: 1.9, extraMult: 1.6, cooldownMult: 0.85,
  },
  lightning: {
    name: '雷霆風暴',
    desc: '雷電鎖鏈的最終進化。分裂數與傷害都大幅躍升，瞬間連鎖整群敵人。',
    dmgMult: 1.7, extraMult: 1.8, cooldownMult: 1.3,
  },
  knife: {
    name: '旋風飛刃',
    desc: '飛刀的最終進化。數量與穿透力大幅提升，形成一片刀刃風暴。',
    dmgMult: 1.6, extraMult: 1.8, cooldownMult: 1.3,
    // 一般武器進化的穿透力是「+1」（見 WeaponSystem._getEffectiveData），但飛刀
    // 進化要求命中數直接跳到 10（pierce=9，命中數＝pierce+1），用這個欄位覆蓋掉
    // 預設的 +1 規則。
    pierceOverride: 9,
  },
  sawblade: {
    name: '狂暴鋸輪',
    desc: '旋轉鋸片的最終進化。數量與轉速大幅提升，環繞成一圈死亡領域。',
    dmgMult: 1.7, extraMult: 1.6, cooldownMult: 1.3,
  },
  frost: {
    name: '永凍冰川',
    desc: '冰霜新星的最終進化。範圍與減速效果大幅提升，凍結一切靠近的敵人。',
    dmgMult: 1.8, extraMult: 1.6, cooldownMult: 1.3,
  },
  sword: {
    name: '劍陣風暴',
    desc: '劍氣斬的最終進化。攻擊半徑大幅提升，扇形夾角擴大成近乎一圈的環繞劍陣，範圍內敵人無所遁形。',
    // extraMult 這裡專門用來放大攻擊半徑（range）——劍氣斬只有 range 跟 arcDeg
    // 兩個受 extraMult 影響的欄位，arcDeg 另外被 arcOverride 蓋掉（見下方），
    // 所以這個倍率實際上只吃在 range 上。原本設 2（剛好翻倍）試玩後感覺範圍
    // 誇張過頭，調降到 1.5 倍。
    dmgMult: 1.8, extraMult: 1.5, cooldownMult: 1.2,
    // 一般武器進化的扇形角度是「乘 extraMult」，但劍氣斬進化要求直接跳到近乎
    // 滿圈（340 度，留一點縫隙做視覺上的「起手方向」），用這個欄位覆蓋掉
    // 預設的倍率規則（跟 WeaponSystem._getEffectiveData 對 pierceOverride 的
    // 處理方式一致）。
    arcOverride: 340,
  },
};
