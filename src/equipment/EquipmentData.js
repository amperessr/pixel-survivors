// 裝備系統：五個裝備欄位，每個欄位都分「初心者／中階／高階」三個階級，
// 必須依序購買（買中階前要先買同部位的初心者，買高階前要先買中階）。
// 之後要擴充新裝備，只要在這裡新增項目、並在 TextureFactory.generateEquipmentIcons()
// 補上對應的圖示材質即可，InventoryScene / ShopScene 都是讀這份資料表動態產生內容。
export const EQUIP_SLOTS = ['weapon', 'helmet', 'clothes', 'pants', 'shoes'];

// 戒指欄位：跟上面五個裝備欄不同，不是「初心者/中階/高階」可升級購買的裝備，
// 而是各自獨立、僅能從扭蛋機抽到的稀有戒指。目前只有兩種戒指、剛好對應兩個欄位，
// 所以先簡化成每個欄位固定對應一種戒指（見 RING_DATA 的 slot 欄位），
// 之後戒指種類變多的話再改成跟一般裝備一樣「同類型任選欄位」。
export const RING_SLOTS = ['ring1', 'ring2'];

// 裝備稀有度：純視覺分級（名稱＋顏色），目前商店三階固定對應
// 初心者=普通／中階=優秀／高階=稀有；扭蛋機的一般裝備涵蓋普通～傳說五階
// （見下面 GACHA_BANDS），戒指則是傳說（回血/引力）／神話（自動/分身）。
export const RARITY_IDS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const RARITY_DATA = {
  common: { id: 'common', label: '普通', color: 0xe8e8e8 },
  uncommon: { id: 'uncommon', label: '優秀', color: 0x2ecc71 },
  rare: { id: 'rare', label: '稀有', color: 0x3d9dff },
  epic: { id: 'epic', label: '史詩', color: 0xb14dff },
  legendary: { id: 'legendary', label: '傳說', color: 0xff9d2e },
  mythic: { id: 'mythic', label: '神話', color: 0xff3b3b },
};

// 每項能力值在各稀有度下「合理」的數值範圍，作為之後新增/調整裝備數值時的平衡依據。
// 現有裝備都是固定數值（不是抽獎隨機取得），下面 EQUIPMENT_DATA 裡填的數字都落在
// 對應稀有度的範圍內；之後要加新裝備，直接對照這份表決定數值即可。
export const RARITY_STAT_RANGES = {
  attack: { common: [1, 10], uncommon: [8, 20], rare: [18, 35], epic: [30, 55], legendary: [50, 90], mythic: [85, 150] },
  defense: { common: [1, 5], uncommon: [4, 10], rare: [8, 18], epic: [15, 30], legendary: [28, 50], mythic: [45, 80] },
  maxHp: { common: [10, 30], uncommon: [25, 60], rare: [55, 120], epic: [100, 200], legendary: [180, 320], mythic: [300, 500] },
  // moveSpeed 只有鞋子在用（見 GACHA_STAT_KEY）；砍半後玩家反應還是太快，這次再砍掉約 40%
  moveSpeed: { common: [2, 5], uncommon: [4, 8], rare: [8, 15], epic: [14, 23], legendary: [21, 33], mythic: [32, 48] },
};

export const SLOT_LABELS = {
  weapon: '武器',
  helmet: '頭盔',
  clothes: '衣服',
  pants: '褲子',
  shoes: '鞋子',
  ring1: '戒指',
  ring2: '戒指',
};

export const TIERS = ['beginner', 'mid', 'high'];

export const TIER_LABELS = {
  beginner: '初心者',
  mid: '中階',
  high: '高階',
};

export const TIER_PRICES = {
  beginner: 3000,
  mid: 5000,
  high: 10000,
};

// itemId 沿用原本的 "_basic" 命名當作初心者階（避免玩家原本存檔裡的裝備 id 失效），
// 中階／高階則用 "_mid" / "_high" 後綴。圖示改用玩家提供的正式美術圖（去背後裁切自
// 五部位 x 三階級的裝備總覽圖，見 assets/equip_<slot>_<tier>.png），每階都是各自
// 獨立的圖案與配色，不用再靠 TIER_TINTS 染色區分階級。
export const EQUIPMENT_DATA = {
  weapon_basic: {
    id: 'weapon_basic', slot: 'weapon', tier: 'beginner', tierIndex: 0, prevId: null, rarity: 'common',
    name: '初心者劍', desc: '攻擊力 +5', price: TIER_PRICES.beginner, icon: 'equip_weapon_beginner',
    bonus: { attack: 5 },
  },
  weapon_mid: {
    id: 'weapon_mid', slot: 'weapon', tier: 'mid', tierIndex: 1, prevId: 'weapon_basic', rarity: 'uncommon',
    name: '中階劍', desc: '攻擊力 +12', price: TIER_PRICES.mid, icon: 'equip_weapon_mid',
    bonus: { attack: 12 },
  },
  weapon_high: {
    id: 'weapon_high', slot: 'weapon', tier: 'high', tierIndex: 2, prevId: 'weapon_mid', rarity: 'rare',
    name: '高階劍', desc: '攻擊力 +25', price: TIER_PRICES.high, icon: 'equip_weapon_high',
    bonus: { attack: 25 },
  },

  helmet_basic: {
    id: 'helmet_basic', slot: 'helmet', tier: 'beginner', tierIndex: 0, prevId: null, rarity: 'common',
    name: '初心者頭盔', desc: '防禦力 +3', price: TIER_PRICES.beginner, icon: 'equip_helmet_beginner',
    bonus: { defense: 3 },
  },
  helmet_mid: {
    id: 'helmet_mid', slot: 'helmet', tier: 'mid', tierIndex: 1, prevId: 'helmet_basic', rarity: 'uncommon',
    name: '中階頭盔', desc: '防禦力 +7', price: TIER_PRICES.mid, icon: 'equip_helmet_mid',
    bonus: { defense: 7 },
  },
  helmet_high: {
    id: 'helmet_high', slot: 'helmet', tier: 'high', tierIndex: 2, prevId: 'helmet_mid', rarity: 'rare',
    name: '高階頭盔', desc: '防禦力 +15', price: TIER_PRICES.high, icon: 'equip_helmet_high',
    bonus: { defense: 15 },
  },

  clothes_basic: {
    id: 'clothes_basic', slot: 'clothes', tier: 'beginner', tierIndex: 0, prevId: null, rarity: 'common',
    name: '初心者上衣', desc: '生命上限 +20', price: TIER_PRICES.beginner, icon: 'equip_clothes_beginner',
    bonus: { maxHp: 20 },
  },
  clothes_mid: {
    id: 'clothes_mid', slot: 'clothes', tier: 'mid', tierIndex: 1, prevId: 'clothes_basic', rarity: 'uncommon',
    name: '中階上衣', desc: '生命上限 +45', price: TIER_PRICES.mid, icon: 'equip_clothes_mid',
    bonus: { maxHp: 45 },
  },
  clothes_high: {
    id: 'clothes_high', slot: 'clothes', tier: 'high', tierIndex: 2, prevId: 'clothes_mid', rarity: 'rare',
    name: '高階上衣', desc: '生命上限 +90', price: TIER_PRICES.high, icon: 'equip_clothes_high',
    bonus: { maxHp: 90 },
  },

  pants_basic: {
    id: 'pants_basic', slot: 'pants', tier: 'beginner', tierIndex: 0, prevId: null, rarity: 'common',
    name: '初心者褲子', desc: '防禦力 +2', price: TIER_PRICES.beginner, icon: 'equip_pants_beginner',
    bonus: { defense: 2 },
  },
  pants_mid: {
    id: 'pants_mid', slot: 'pants', tier: 'mid', tierIndex: 1, prevId: 'pants_basic', rarity: 'uncommon',
    name: '中階褲子', desc: '防禦力 +5', price: TIER_PRICES.mid, icon: 'equip_pants_mid',
    bonus: { defense: 5 },
  },
  pants_high: {
    id: 'pants_high', slot: 'pants', tier: 'high', tierIndex: 2, prevId: 'pants_mid', rarity: 'rare',
    name: '高階褲子', desc: '防禦力 +10', price: TIER_PRICES.high, icon: 'equip_pants_high',
    bonus: { defense: 10 },
  },

  // 鞋子的移動速度加成原本 10/22/40，先砍半到 5/11/20 玩家反應還是太快，
  // 這次再砍掉約 40%
  shoes_basic: {
    id: 'shoes_basic', slot: 'shoes', tier: 'beginner', tierIndex: 0, prevId: null, rarity: 'common',
    name: '初心者鞋子', desc: '移動速度 +3', price: TIER_PRICES.beginner, icon: 'equip_shoes_beginner',
    bonus: { moveSpeed: 3 },
  },
  shoes_mid: {
    id: 'shoes_mid', slot: 'shoes', tier: 'mid', tierIndex: 1, prevId: 'shoes_basic', rarity: 'uncommon',
    name: '中階鞋子', desc: '移動速度 +7', price: TIER_PRICES.mid, icon: 'equip_shoes_mid',
    bonus: { moveSpeed: 7 },
  },
  shoes_high: {
    id: 'shoes_high', slot: 'shoes', tier: 'high', tierIndex: 2, prevId: 'shoes_mid', rarity: 'rare',
    name: '高階鞋子', desc: '移動速度 +12', price: TIER_PRICES.high, icon: 'equip_shoes_high',
    bonus: { moveSpeed: 12 },
  },

  // 戒指：僅能從扭蛋機抽到，商店不販售（不會出現在 SHOP_ITEM_IDS），沒有階級/升級。
  // slot 統一是 'ring'：四種戒指共用兩個戒指欄位（ring1/ring2），穿戴時裝進
  // 第一個空的戒指欄，兩欄都滿了就換掉 ring1（見 InventoryScene._equipFromInventory）。
  ring_heal: {
    id: 'ring_heal', slot: 'ring', tier: null, tierIndex: 0, prevId: null, rarity: 'legendary',
    name: '回血戒指', desc: '掉落的血包有 30% 機率自動飛向玩家。（僅扭蛋機取得）',
    icon: 'ring_heal', bonus: {},
  },
  ring_auto: {
    id: 'ring_auto', slot: 'ring', tier: null, tierIndex: 0, prevId: null, rarity: 'mythic',
    name: '自動戒指', desc: '自動幫玩家移動、閃避怪物、拾取血包/磁鐵/經驗值。玩家手動操作時優先聽玩家的，停止操作 1 秒後恢復自動。（僅扭蛋機取得）',
    icon: 'ring_auto', bonus: {},
  },
  ring_gravity: {
    id: 'ring_gravity', slot: 'ring', tier: null, tierIndex: 0, prevId: null, rarity: 'legendary',
    name: '引力戒', desc: '撿取地圖物件（血包、磁鐵）的範圍變成三倍。（僅扭蛋機取得）',
    icon: 'ring_gravity', bonus: {},
  },
  ring_clone: {
    id: 'ring_clone', slot: 'ring', tier: null, tierIndex: 0, prevId: null, rarity: 'mythic',
    name: '分身戒', desc: '召喚一個怪物打不到的分身幻影，跟隨本尊一起攻擊，攻擊力為本尊的一半。（僅扭蛋機取得）',
    icon: 'ring_clone', bonus: {},
  },
};

// 每個部位依「初心者→中階→高階」排序的 id 清單，購買限制／背包升級都靠這份表查詢
export const EQUIP_LINES = {
  weapon: ['weapon_basic', 'weapon_mid', 'weapon_high'],
  helmet: ['helmet_basic', 'helmet_mid', 'helmet_high'],
  clothes: ['clothes_basic', 'clothes_mid', 'clothes_high'],
  pants: ['pants_basic', 'pants_mid', 'pants_high'],
  shoes: ['shoes_basic', 'shoes_mid', 'shoes_high'],
};

// 四種戒指只能從扭蛋機取得，不會出現在商店購買清單裡。
export const GACHA_RING_IDS = ['ring_heal', 'ring_auto', 'ring_gravity', 'ring_clone'];

// 商店排版順序：以部位分欄、階級由低到高分排
export const SHOP_ITEM_IDS = EQUIP_SLOTS.flatMap((slot) => EQUIP_LINES[slot]);

// 扭蛋機專用裝備：5 部位 x 20 款普通～史詩（assets/equip_<slot>_g01~g20.png，
// 切自玩家提供的參考圖）＋ 5 部位 x 5 套傳說（見下面 LEGENDARY_SERIES），
// 只能扭蛋抽到、不會出現在商店（不列在 EQUIP_LINES / SHOP_ITEM_IDS 裡）。
// 1~7 普通／8~12 優秀／13~17 稀有／18~20 史詩，數值依 RARITY_STAT_RANGES 的
// [下限,上限] 在同一稀有度區間內平均遞增分佈，越後面的編號數值越高。
const GACHA_STAT_KEY = { weapon: 'attack', helmet: 'defense', clothes: 'maxHp', pants: 'defense', shoes: 'moveSpeed' };
const GACHA_STAT_LABEL = { attack: '攻擊力', defense: '防禦力', maxHp: '生命上限', moveSpeed: '移動速度' };
const GACHA_NAME_BASE = {
  weapon: { common: '訓練劍', uncommon: '精鋼劍', rare: '秘銀劍', epic: '龍紋劍' },
  helmet: { common: '皮革帽', uncommon: '精鋼盔', rare: '秘銀盔', epic: '龍紋盔' },
  clothes: { common: '布甲', uncommon: '精鋼鎧', rare: '秘銀鎧', epic: '龍紋鎧' },
  pants: { common: '布褲', uncommon: '精鋼護腿', rare: '秘銀護腿', epic: '龍紋護腿' },
  shoes: { common: '布鞋', uncommon: '精鋼靴', rare: '秘銀靴', epic: '龍紋靴' },
};
const GACHA_BANDS = [
  { rarity: 'common', count: 7 },
  { rarity: 'uncommon', count: 5 },
  { rarity: 'rare', count: 5 },
  { rarity: 'epic', count: 3 },
];

// 把 [min,max] 依 n 等份算出遞增數值（n=1 時直接回傳上限）
function _spreadRange(min, max, n) {
  if (n <= 1) return [max];
  const out = [];
  for (let k = 0; k < n; k++) out.push(Math.round(min + (max - min) * (k / (n - 1))));
  return out;
}

export const GACHA_EQUIPMENT_IDS = [];

EQUIP_SLOTS.forEach((slot) => {
  const statKey = GACHA_STAT_KEY[slot];
  let idx = 0;
  GACHA_BANDS.forEach((band) => {
    const [lo, hi] = RARITY_STAT_RANGES[statKey][band.rarity];
    const values = _spreadRange(lo, hi, band.count);
    values.forEach((val, i) => {
      idx++;
      const g = String(idx).padStart(2, '0');
      const id = `${slot}_g${g}`;
      EQUIPMENT_DATA[id] = {
        id, slot, tier: null, tierIndex: 0, prevId: null, rarity: band.rarity,
        name: `${GACHA_NAME_BASE[slot][band.rarity]}·${i + 1}`,
        desc: `${GACHA_STAT_LABEL[statKey]} +${val}（僅扭蛋機取得）`,
        icon: `equip_${id}`, bonus: { [statKey]: val },
      };
      GACHA_EQUIPMENT_IDS.push(id);
    });
  });
});

// 傳說階：5 個主題套裝（烈焰/寒冰/聖光/狂風/雷霆），每套 5 部位，共 25 件，
// 用玩家提供的正式美術圖（assets/equip_legendary_<slot>_<slug>.png，切自
// D:\遊戲檔案\素材 底下的 5 張系列圖）。數值統一用該部位 legendary 級距的上限
// （不像普通～史詩那樣依編號遞增分佈——5 套之間是主題不同，不是強度分級）。
const LEGENDARY_SERIES = [
  { slug: 'flame', label: '烈焰' },
  { slug: 'ice', label: '寒冰' },
  { slug: 'holy', label: '聖光' },
  { slug: 'wind', label: '狂風' },
  { slug: 'thunder', label: '雷霆' },
];
const LEGENDARY_SLOT_SUFFIX = { weapon: '劍', helmet: '盔', clothes: '鎧', pants: '護腿', shoes: '靴' };

// 套裝效果：同一套主題裝（不分部位、戒指不算）湊滿 3 件／5 件會額外觸發，見
// GameScene._computeSetBonuses() 怎麼統計件數、實際效果分別實作在
// GameScene/EnemySystem/WeaponSystem 對應的傷害/狀態邏輯裡（搜尋 setBonuses）。
export const LEGENDARY_SET_BONUS_TEXT = {
  flame: { label: '烈焰套裝', three: '燃燒持續時間 +50%', five: '燃燒傷害額外 +10% 攻擊力' },
  ice: { label: '寒冰套裝', three: '緩速持續時間 +50%', five: '冰凍結束時造成 10% 攻擊力傷害' },
  wind: { label: '狂風套裝', three: '擊退效果 +100%', five: '所有技能大小 +100%' },
  holy: { label: '聖光套裝', three: '攻擊速度 +30%', five: '攻擊速度額外 +100%' },
  thunder: { label: '雷霆套裝', three: '雷電系技能 30% 機率造成 1 秒麻痺', five: '攻擊麻痺中的怪物額外造成 10% 攻擊力傷害' },
};

EQUIP_SLOTS.forEach((slot) => {
  const statKey = GACHA_STAT_KEY[slot];
  const [, hi] = RARITY_STAT_RANGES[statKey].legendary;
  LEGENDARY_SERIES.forEach(({ slug, label }) => {
    const id = `${slot}_legendary_${slug}`;
    const setText = LEGENDARY_SET_BONUS_TEXT[slug];
    EQUIPMENT_DATA[id] = {
      id, slot, tier: null, tierIndex: 0, prevId: null, rarity: 'legendary',
      name: `${label}${LEGENDARY_SLOT_SUFFIX[slot]}`,
      desc: `${GACHA_STAT_LABEL[statKey]} +${hi}（僅扭蛋機取得）\n${setText.label} 3件：${setText.three}\n5件：${setText.five}`,
      icon: `equip_legendary_${slot}_${slug}`, bonus: { [statKey]: hi },
      setSlug: slug,
    };
    GACHA_EQUIPMENT_IDS.push(id);
  });
});

// 依裝備 id 找出它屬於哪一套傳說套裝的 slug（flame/ice/wind/holy/thunder），
// 不是傳說套裝裝備（含戒指、非傳說裝備）一律回傳 null。
export function getLegendarySeriesSlug(itemId) {
  return (EQUIPMENT_DATA[itemId] && EQUIPMENT_DATA[itemId].setSlug) || null;
}

// 抽獎機率表：直接是百分比，加總剛好 100%。六個稀有度全部有對應的裝備可抽到：
// 普通/優秀/稀有/史詩是編號式一般裝備（1-7/8-12/13-17/18-20），傳說是 5 部位
// x 5 套主題裝（見 LEGENDARY_SERIES）額外加兩個戒指（回血戒指/引力戒）、
// 神話＝自動戒指/分身戒。神話 0.1%、傳說 1%，其餘依「越稀有掉率越低」
// 照比例補滿剩下的 98.9%。
export const GACHA_RARITY_WEIGHTS = {
  common: 46.41,
  uncommon: 27.80,
  rare: 15.40,
  epic: 9.29,
  legendary: 1,
  mythic: 0.1,
};

// 背包出售的單件售價（依稀有度，六階都可以賣，包含戒指）
export const SELL_PRICES = {
  common: 100,
  uncommon: 300,
  rare: 500,
  epic: 1000,
  legendary: 5000,
  mythic: 10000,
};

// 依稀有度分組的完整抽獎池（一般裝備 100 件 + 兩種戒指），供 rollGachaItem() 使用。
export const GACHA_POOL_BY_RARITY = {};
[...GACHA_EQUIPMENT_IDS, ...GACHA_RING_IDS].forEach((id) => {
  const r = EQUIPMENT_DATA[id].rarity;
  (GACHA_POOL_BY_RARITY[r] = GACHA_POOL_BY_RARITY[r] || []).push(id);
});

// 抽一次：先依權重表隨機決定稀有度，再從該稀有度的池子裡均勻隨機選一件。
// forceRarity 給保底機制用（見 ShopScene._gachaPull 的 100 抽保底邏輯）：
// 有帶這個參數就跳過機率表，直接從指定稀有度的池子裡抽。
export function rollGachaItem(forceRarity) {
  let picked = forceRarity;
  if (!picked) {
    const total = Object.values(GACHA_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    picked = 'common';
    for (const rarity of Object.keys(GACHA_RARITY_WEIGHTS)) {
      const w = GACHA_RARITY_WEIGHTS[rarity];
      if (roll < w) { picked = rarity; break; }
      roll -= w;
    }
  }
  const pool = GACHA_POOL_BY_RARITY[picked] || GACHA_POOL_BY_RARITY.common;
  return pool[Math.floor(Math.random() * pool.length)];
}
