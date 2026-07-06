// 裝備系統：五個裝備欄位，目前商店只賣「基本」款各一件，各 3000 元。
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

export const EQUIPMENT_DATA = {
  weapon_basic: {
    id: 'weapon_basic', slot: 'weapon', name: '新手劍',
    desc: '攻擊力 +5', price: 3000, icon: 'equip_weapon',
    bonus: { attack: 5 },
  },
  helmet_basic: {
    id: 'helmet_basic', slot: 'helmet', name: '新手頭盔',
    desc: '防禦力 +3', price: 3000, icon: 'equip_helmet',
    bonus: { defense: 3 },
  },
  clothes_basic: {
    id: 'clothes_basic', slot: 'clothes', name: '新手上衣',
    desc: '生命上限 +20', price: 3000, icon: 'equip_clothes',
    bonus: { maxHp: 20 },
  },
  pants_basic: {
    id: 'pants_basic', slot: 'pants', name: '新手褲子',
    desc: '防禦力 +2', price: 3000, icon: 'equip_pants',
    bonus: { defense: 2 },
  },
  shoes_basic: {
    id: 'shoes_basic', slot: 'shoes', name: '新手鞋子',
    desc: '移動速度 +10', price: 3000, icon: 'equip_shoes',
    bonus: { moveSpeed: 10 },
  },
};

// 商店目前只賣這五件基本款（每個玩家都能買，不限購買次數，買了會進背包）
export const SHOP_ITEM_IDS = ['weapon_basic', 'helmet_basic', 'clothes_basic', 'pants_basic', 'shoes_basic'];
