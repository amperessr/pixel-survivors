// 五種被動能力，每種十階，直接強化角色數值，並間接觸發武器聯動效果
export const PASSIVE_IDS = ['attack', 'critRate', 'critDmg', 'atkSpeed', 'moveSpeed'];

// 被動技能等級上限。武器上限是 5 級（見 WeaponSystem.isMaxed），被動則比照
// 「數值型」被動的設計拉長到 10 級，讓被動線在武器全部進化後還有成長空間。
export const MAX_PASSIVE_LEVEL = 10;

// 說明文字明確寫出「強化哪些技能、怎麼強化、倍率多少」。技能的體積/數量/範圍
// 只由「本場選到的被動卡片張數」決定（見 WeaponSystem），不受角色永久能力值與
// 裝備影響；傷害仍會吃攻擊力（含裝備）。
export const PASSIVE_DATA = {
  attack: {
    id: 'attack', name: '力量祝福', icon: 'icon_attack',
    desc: '每級攻擊力 +8%（提升所有武器傷害）；並使火系（火球術）與冰系（冰霜新星）技能\n（含各自的進化與融合版本）體積/範圍每級 +8%。',
    perLevel: 8, // 每級增加的百分比數值
  },
  critRate: {
    id: 'critRate', name: '幸運符文', icon: 'icon_critRate',
    desc: '每級爆擊率 +6%（所有武器命中都可能爆擊）；並使雷電鎖鏈每 2 級多分裂 1 次。',
    perLevel: 6,
  },
  critDmg: {
    id: 'critDmg', name: '致命打擊', icon: 'icon_critDmg',
    desc: '每級爆擊傷害 +15%。爆擊時的傷害倍率（基礎 150%，即爆擊為一般的 1.5 倍起跳）。',
    perLevel: 15,
  },
  atkSpeed: {
    id: 'atkSpeed', name: '疾風之刃', icon: 'icon_atkSpeed',
    desc: '每級攻擊速度 +8%（縮短武器冷卻）；並使飛刀與旋轉鋸片每 2 級各多 1 個、\n旋轉鋸片轉速每級 +8%。',
    perLevel: 8,
  },
  moveSpeed: {
    id: 'moveSpeed', name: '迅捷之靴', icon: 'icon_moveSpeed',
    desc: '每級移動速度 +6%。只影響角色跑速，不影響任何武器。',
    perLevel: 6,
  },
};

export function passiveLevelValue(id, level) {
  return PASSIVE_DATA[id].perLevel * level;
}
