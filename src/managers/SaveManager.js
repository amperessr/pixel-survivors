// 本地儲存管理：玩家名稱僅需詢問一次，之後從 localStorage 讀取
const NAME_KEY = 'pixelSurvivors_playerName';
const BEST_KEY = 'pixelSurvivors_bestScore';
const GOLD_KEY = 'pixelSurvivors_gold';
const INVENTORY_KEY = 'pixelSurvivors_inventory'; // JSON: 長度 50 的陣列，每格是 itemId 或 null
const EQUIPPED_KEY = 'pixelSurvivors_equipped';   // JSON: { weapon, helmet, clothes, pants, shoes }
const CHECKPOINT_KEY = 'pixelSurvivors_checkpointStage'; // 目前記錄到的最高關卡存檔點（每 5 關記一次）

const INVENTORY_SIZE = 50; // 5 列 x 10 欄，跟楓之谷倉庫一樣的排法

export function getPlayerName() {
  return localStorage.getItem(NAME_KEY);
}

export function setPlayerName(name) {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 12));
}

export function getBestScore() {
  return parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
}

export function setBestScore(score) {
  const best = getBestScore();
  if (score > best) {
    localStorage.setItem(BEST_KEY, String(score));
  }
}

// ---------- 金幣 ----------
export function getGold() {
  return parseInt(localStorage.getItem(GOLD_KEY) || '0', 10);
}

export function setGold(amount) {
  localStorage.setItem(GOLD_KEY, String(Math.max(0, Math.floor(amount))));
}

export function addGold(amount) {
  const next = getGold() + Math.floor(amount);
  setGold(next);
  return next;
}

// 花費金幣：金額不足時回傳 false、不會扣款；足夠的話扣款並回傳 true
export function spendGold(amount) {
  const cur = getGold();
  if (cur < amount) return false;
  setGold(cur - amount);
  return true;
}

// ---------- 背包（50 格，5x10）----------
export function getInventory() {
  try {
    const raw = JSON.parse(localStorage.getItem(INVENTORY_KEY) || '[]');
    const arr = Array.isArray(raw) ? raw : [];
    while (arr.length < INVENTORY_SIZE) arr.push(null);
    return arr.slice(0, INVENTORY_SIZE);
  } catch {
    return new Array(INVENTORY_SIZE).fill(null);
  }
}

export function setInventory(arr) {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(arr.slice(0, INVENTORY_SIZE)));
}

// 把一個 itemId 塞進背包第一個空格；背包滿了回傳 false（呼叫端可以提示玩家背包已滿）
export function addItemToInventory(itemId) {
  const inv = getInventory();
  const idx = inv.findIndex((slot) => !slot);
  if (idx === -1) return false;
  inv[idx] = itemId;
  setInventory(inv);
  return true;
}

// ---------- 已裝備物品（weapon / helmet / clothes / pants / shoes）----------
export function getEquipped() {
  try {
    const raw = JSON.parse(localStorage.getItem(EQUIPPED_KEY) || '{}');
    return {
      weapon: raw.weapon || null,
      helmet: raw.helmet || null,
      clothes: raw.clothes || null,
      pants: raw.pants || null,
      shoes: raw.shoes || null,
    };
  } catch {
    return { weapon: null, helmet: null, clothes: null, pants: null, shoes: null };
  }
}

export function setEquipped(equipped) {
  localStorage.setItem(EQUIPPED_KEY, JSON.stringify(equipped));
}

// 某個裝備 id 目前是否已經擁有（不管是穿在身上還是放在背包裡）——
// 用來判斷商店裡「已購買」／「前一階是否已擁有」的狀態
export function isItemOwned(itemId) {
  if (!itemId) return false;
  const equipped = getEquipped();
  if (Object.values(equipped).includes(itemId)) return true;
  return getInventory().includes(itemId);
}

// 把裝備從舊 id 升級成新 id：不管舊裝備目前是穿在身上（哪一個欄位）還是放在
// 背包裡（哪一格），都直接原地換成新 id，不會在背包多長出一件；
// 如果找不到舊裝備（例如買的是初心者階，沒有前一階可以升級），就照一般方式塞進背包空格。
export function upgradeEquipment(oldItemId, newItemId) {
  if (oldItemId) {
    const equipped = getEquipped();
    const equippedSlot = Object.keys(equipped).find((slot) => equipped[slot] === oldItemId);
    if (equippedSlot) {
      equipped[equippedSlot] = newItemId;
      setEquipped(equipped);
      return true;
    }
    const inv = getInventory();
    const idx = inv.indexOf(oldItemId);
    if (idx !== -1) {
      inv[idx] = newItemId;
      setInventory(inv);
      return true;
    }
  }
  return addItemToInventory(newItemId);
}

// ---------- 關卡存檔點（每 5 關記錄一次，只會往前推進、不會被較小的關卡數蓋掉）----------
export function getCheckpointStage() {
  return Math.max(1, parseInt(localStorage.getItem(CHECKPOINT_KEY) || '1', 10));
}

export function setCheckpointStage(stage) {
  if (stage > getCheckpointStage()) {
    localStorage.setItem(CHECKPOINT_KEY, String(Math.floor(stage)));
  }
}

// 顯示 HTML 名稱輸入 Modal，回傳 Promise<string>
export function promptPlayerName() {
  return new Promise((resolve) => {
    const existing = getPlayerName();
    if (existing) {
      resolve(existing);
      return;
    }
    const modal = document.getElementById('name-modal');
    const input = document.getElementById('name-input');
    const btn = document.getElementById('name-confirm');
    modal.classList.remove('hidden');
    input.focus();

    const confirm = () => {
      const val = input.value.trim() || `冒險者${Math.floor(Math.random() * 9000 + 1000)}`;
      setPlayerName(val);
      modal.classList.add('hidden');
      btn.removeEventListener('click', confirm);
      input.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') confirm();
    };
    btn.addEventListener('click', confirm);
    input.addEventListener('keydown', onKey);
  });
}
