// 裝備系統：五個裝備欄位，每個欄位都分「初心者／中階／高階」三個階級，
// 必須依序購買（買中階前要先買同部位的初心者，買高階前要先買中階）。
// 之後要擴充新裝備，只要在這裡新增項目、並在 TextureFactory.generateEquipmentIcons()
// 補上對應的圖示材質即可，InventoryScene / ShopScene 都是讀這份資料表動態產生內容。
export const EQUIP_SLOTS = ['weapon', 'helmet', 'clothes', 'pants', 'shoes'];

export const SLOT_LABELS = {
  weapon: '武器',
  helmet: '頭盔',
  clothes: '衣服',
  pants: '褲子',
  shoes: '鞋子',
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

// 中階／高階圖示沿用同一部位的圖案，用染色做出「越高階越亮眼」的區別
// （初心者維持原色、中階染銀藍、高階染金色），不用額外多畫 10 張圖示材質。
export const TIER_TINTS = {
  beginner: null,
  mid: 0xbfe6ff,
  high: 0xffe066,
};

// itemId 沿用原本的 "_basic" 命名當作初心者階（避免玩家原本存檔裡的裝備 id 失效），
// 中階／高階則用 "_mid" / "_high" 後綴。
export const EQUIPMENT_DATA = {
  weapon_basic: {
    id: 'weapon_basic', slot: 'weapon', tier: 'beginner', tierIndex: 0, prevId: null,
    name: '初心者劍', desc: '攻擊力 +5', price: TIER_PRICES.beginner, icon: 'equip_weapon',
    bonus: { attack: 5 },
  },
  weapon_mid: {
    id: 'weapon_mid', slot: 'weapon', tier: 'mid', tierIndex: 1, prevId: 'weapon_basic',
    name: '中階劍', desc: '攻擊力 +12', price: TIER_PRICES.mid, icon: 'equip_weapon',
    bonus: { attack: 12 },
  },
  weapon_high: {
    id: 'weapon_high', slot: 'weapon', tier: 'high', tierIndex: 2, prevId: 'weapon_mid',
    name: '高階劍', desc: '攻擊力 +25', price: TIER_PRICES.high, icon: 'equip_weapon',
    bonus: { attack: 25 },
  },

  helmet_basic: {
    id: 'helmet_basic', slot: 'helmet', tier: 'beginner', tierIndex: 0, prevId: null,
    name: '初心者頭盔', desc: '防禦力 +3', price: TIER_PRICES.beginner, icon: 'equip_helmet',
    bonus: { defense: 3 },
  },
  helmet_mid: {
    id: 'helmet_mid', slot: 'helmet', tier: 'mid', tierIndex: 1, prevId: 'helmet_basic',
    name: '中階頭盔', desc: '防禦力 +7', price: TIER_PRICES.mid, icon: 'equip_helmet',
    bonus: { defense: 7 },
  },
  helmet_high: {
    id: 'helmet_high', slot: 'helmet', tier: 'high', tierIndex: 2, prevId: 'helmet_mid',
    name: '高階頭盔', desc: '防禦力 +15', price: TIER_PRICES.high, icon: 'equip_helmet',
    bonus: { defense: 15 },
  },

  clothes_basic: {
    id: 'clothes_basic', slot: 'clothes', tier: 'beginner', tierIndex: 0, prevId: null,
    name: '初心者上衣', desc: '生命上限 +20', price: TIER_PRICES.beginner, icon: 'equip_clothes',
    bonus: { maxHp: 20 },
  },
  clothes_mid: {
    id: 'clothes_mid', slot: 'clothes', tier: 'mid', tierIndex: 1, prevId: 'clothes_basic',
    name: '中階上衣', desc: '生命上限 +45', price: TIER_PRICES.mid, icon: 'equip_clothes',
    bonus: { maxHp: 45 },
  },
  clothes_high: {
    id: 'clothes_high', slot: 'clothes', tier: 'high', tierIndex: 2, prevId: 'clothes_mid',
    name: '高階上衣', desc: '生命上限 +90', price: TIER_PRICES.high, icon: 'equip_clothes',
    bonus: { maxHp: 90 },
  },

  pants_basic: {
    id: 'pants_basic', slot: 'pants', tier: 'beginner', tierIndex: 0, prevId: null,
    name: '初心者褲子', desc: '防禦力 +2', price: TIER_PRICES.beginner, icon: 'equip_pants',
    bonus: { defense: 2 },
  },
  pants_mid: {
    id: 'pants_mid', slot: 'pants', tier: 'mid', tierIndex: 1, prevId: 'pants_basic',
    name: '中階褲子', desc: '防禦力 +5', price: TIER_PRICES.mid, icon: 'equip_pants',
    bonus: { defense: 5 },
  },
  pants_high: {
    id: 'pants_high', slot: 'pants', tier: 'high', tierIndex: 2, prevId: 'pants_mid',
    name: '高階褲子', desc: '防禦力 +10', price: TIER_PRICES.high, icon: 'equip_pants',
    bonus: { defense: 10 },
  },

  shoes_basic: {
    id: 'shoes_basic', slot: 'shoes', tier: 'beginner', tierIndex: 0, prevId: null,
    name: '初心者鞋子', desc: '移動速度 +10', price: TIER_PRICES.beginner, icon: 'equip_shoes',
    bonus: { moveSpeed: 10 },
  },
  shoes_mid: {
    id: 'shoes_mid', slot: 'shoes', tier: 'mid', tierIndex: 1, prevId: 'shoes_basic',
    name: '中階鞋子', desc: '移動速度 +22', price: TIER_PRICES.mid, icon: 'equip_shoes',
    bonus: { moveSpeed: 22 },
  },
  shoes_high: {
    id: 'shoes_high', slot: 'shoes', tier: 'high', tierIndex: 2, prevId: 'shoes_mid',
    name: '高階鞋子', desc: '移動速度 +40', price: TIER_PRICES.high, icon: 'equip_shoes',
    bonus: { moveSpeed: 40 },
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

// 商店排版順序：以部位分欄、階級由低到高分排
export const SHOP_ITEM_IDS = EQUIP_SLOTS.flatMap((slot) => EQUIP_LINES[slot]);
