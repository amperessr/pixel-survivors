// 存檔管理：本機用 localStorage 當「隨時可同步讀取」的快取，實際的帳號主資料
// （金幣/裝備/背包/關卡進度）用名字＋密碼同步到 Firebase Realtime Database，
// 讓同一個帳號在不同電腦登入都能讀到最新進度。
//
// 設計原則：遊戲裡其他程式碼（GameScene/ShopScene/InventoryScene...）完全不用
// 改寫成非同步——所有 getXxx() 讀取的還是本機 localStorage（永遠同步、立即回傳），
// 只有「登入」(promptPlayerName) 是非同步的雲端存取；每次 setXxx() 寫入本機之後，
// 會額外（不等待）把整包存檔資料推上雲端，讓其他裝置下次登入能讀到。
import { fetchAccount, saveAccount, hashPassword } from '../firebase/firebase.js';

const NAME_KEY = 'pixelSurvivors_playerName';
const PASSWORD_HASH_KEY = 'pixelSurvivors_passwordHash';
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
    _scheduleCloudPush();
  }
}

// ---------- 金幣 ----------
export function getGold() {
  return parseInt(localStorage.getItem(GOLD_KEY) || '0', 10);
}

export function setGold(amount) {
  localStorage.setItem(GOLD_KEY, String(Math.max(0, Math.floor(amount))));
  _scheduleCloudPush();
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
  _scheduleCloudPush();
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
  _scheduleCloudPush();
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
    _scheduleCloudPush();
  }
}

// ---------- 帳號雲端同步 ----------

// 把目前本機的存檔內容打包成一個物件，用來上傳／覆蓋雲端帳號資料
function _gatherLocalBundle() {
  return {
    gold: getGold(),
    inventory: getInventory(),
    equipped: getEquipped(),
    checkpointStage: getCheckpointStage(),
    bestScore: getBestScore(),
  };
}

// 用雲端拉回來的帳號資料覆蓋本機（登入成功時呼叫）——直接覆蓋而不是取大值，
// 因為「登入帳號」的語意就是「這個帳號目前的進度就是雲端這份」。
function _applyCloudBundle(data) {
  if (!data) return;
  if (typeof data.gold === 'number') localStorage.setItem(GOLD_KEY, String(Math.max(0, Math.floor(data.gold))));
  if (Array.isArray(data.inventory)) setInventoryRaw(data.inventory);
  if (data.equipped && typeof data.equipped === 'object') {
    localStorage.setItem(EQUIPPED_KEY, JSON.stringify(data.equipped));
  }
  if (typeof data.checkpointStage === 'number') {
    localStorage.setItem(CHECKPOINT_KEY, String(Math.max(1, Math.floor(data.checkpointStage))));
  }
  if (typeof data.bestScore === 'number') {
    localStorage.setItem(BEST_KEY, String(Math.max(0, Math.floor(data.bestScore))));
  }
}

// 跟 setInventory 一樣但不觸發雲端推送（套用雲端資料時不需要「推」回去，資料就是從那邊來的）
function setInventoryRaw(arr) {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(arr.slice(0, INVENTORY_SIZE)));
}

// 推送到雲端做了 500ms 防抖：連續好幾個動作（例如商店裡連續買好幾件裝備）
// 只會真的送出最後那一次的完整快照，不會每改一個欄位就發一次網路請求。
let _pushTimer = null;
function _scheduleCloudPush() {
  const name = getPlayerName();
  const passwordHash = localStorage.getItem(PASSWORD_HASH_KEY);
  if (!name || !passwordHash) return; // 還沒登入完成，不用推（正常流程一定會先登入才能玩）
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    saveAccount(name, { passwordHash, ..._gatherLocalBundle() }).catch((err) => {
      console.warn('[SaveManager] 同步存檔到雲端失敗（可能離線），本機資料仍會正常保存：', err.message);
    });
  }, 500);
}

// 這台裝置先前已經登入過（本機有快取的名字＋密碼雜湊）：背景嘗試從雲端拉最新進度，
// 拉取失敗（離線、密碼在別處被改過等）就沿用本機現有資料，不會擋住遊戲開始。
async function _trySilentResync(name, passwordHash) {
  try {
    const { exists, data } = await fetchAccount(name);
    if (exists && data && data.passwordHash === passwordHash) {
      _applyCloudBundle(data);
    }
  } catch (err) {
    console.warn('[SaveManager] 背景同步雲端存檔失敗（可能離線），沿用本機資料：', err.message);
  }
}

// 顯示 HTML 名稱＋密碼輸入 Modal，處理登入/註冊流程，回傳 Promise<string>（玩家名字）
function _runLoginModal(resolve) {
  const modal = document.getElementById('name-modal');
  const nameInput = document.getElementById('name-input');
  const pwInput = document.getElementById('password-input');
  const errorEl = document.getElementById('name-error');
  const btn = document.getElementById('name-confirm');
  modal.classList.remove('hidden');
  nameInput.focus();

  const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
  const clearError = () => errorEl.classList.add('hidden');
  const cleanup = () => {
    btn.removeEventListener('click', onConfirm);
    nameInput.removeEventListener('keydown', onKey);
    pwInput.removeEventListener('keydown', onKey);
  };

  const onConfirm = async () => {
    clearError();
    const name = nameInput.value.trim().slice(0, 12) || `冒險者${Math.floor(Math.random() * 9000 + 1000)}`;
    const password = pwInput.value;
    if (!password) { showError('請輸入密碼'); return; }

    btn.disabled = true;
    try {
      const passwordHash = await hashPassword(password);
      const { exists, data } = await fetchAccount(name);
      if (exists) {
        if (data.passwordHash !== passwordHash) {
          showError('密碼錯誤，請再試一次');
          btn.disabled = false;
          return;
        }
        _applyCloudBundle(data);
      } else {
        // 新帳號：把這台裝置目前的存檔內容當作初始進度存上雲端
        await saveAccount(name, { passwordHash, ..._gatherLocalBundle() });
      }
      setPlayerName(name);
      localStorage.setItem(PASSWORD_HASH_KEY, passwordHash);
      modal.classList.add('hidden');
      cleanup();
      resolve(name);
    } catch (err) {
      console.warn('[SaveManager] 登入時連線雲端失敗：', err.message);
      showError('無法連線到伺服器，請檢查網路後再試一次');
      btn.disabled = false;
    }
  };
  const onKey = (e) => { if (e.key === 'Enter') onConfirm(); };
  btn.addEventListener('click', onConfirm);
  nameInput.addEventListener('keydown', onKey);
  pwInput.addEventListener('keydown', onKey);
}

export function promptPlayerName() {
  return new Promise((resolve) => {
    const existingName = getPlayerName();
    const existingHash = localStorage.getItem(PASSWORD_HASH_KEY);
    if (existingName && existingHash) {
      // 這台裝置先前已經登入過，先在背景跟雲端同步一次最新進度，
      // 確認/失敗都會照樣繼續（不會因為離線就卡住無法開始遊戲）。
      _trySilentResync(existingName, existingHash).finally(() => resolve(existingName));
      return;
    }
    _runLoginModal(resolve);
  });
}

// 登出：清掉本機快取的帳號身份「跟」所有存檔欄位，回到全新未登入的狀態。
// 一定要連同金幣/背包/裝備/關卡/最佳分數一起清掉，不能只清身份——不然下一個
// 登入的帳號（不管是新帳號還是別的既有帳號）會在雲端資料還沒拉回來前，
// 先讀到上一個帳號留在本機的舊資料，等於帳號之間互相污染。
// 清完直接重新整理頁面，確保沒有任何場景還留著舊帳號的記憶體狀態。
export function logout() {
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(PASSWORD_HASH_KEY);
  localStorage.removeItem(GOLD_KEY);
  localStorage.removeItem(INVENTORY_KEY);
  localStorage.removeItem(EQUIPPED_KEY);
  localStorage.removeItem(CHECKPOINT_KEY);
  localStorage.removeItem(BEST_KEY);
  location.reload();
}
