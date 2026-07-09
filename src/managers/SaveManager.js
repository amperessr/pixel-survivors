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
const STAT_LEVEL_KEY = 'pixelSurvivors_statLevel'; // 永久等級（跟進遊戲後的戰鬥內等級是兩回事）
const STAT_EXP_KEY = 'pixelSurvivors_statExp';     // 目前等級內已累積的經驗值
const STAT_POINTS_KEY = 'pixelSurvivors_statPoints'; // 還沒花掉的技能點
const STAT_INVEST_KEY = 'pixelSurvivors_statInvest'; // JSON：七項能力值各自已投資的點數（重置時只退這個）
const MAIL_STATUS_KEY = 'pixelSurvivors_mailStatus'; // JSON：{ [郵件id]: 'claimed' | 'deleted' }
const LEVEL_UP_AUTO_KEY = 'pixelSurvivors_levelUpAutoMode'; // '1' = 全自動（升級自動選最左邊的卡片），其餘/沒有 = 半自動

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

// ---------- 已裝備物品（weapon / helmet / clothes / pants / shoes / ring1 / ring2）----------
export function getEquipped() {
  try {
    const raw = JSON.parse(localStorage.getItem(EQUIPPED_KEY) || '{}');
    return {
      weapon: raw.weapon || null,
      helmet: raw.helmet || null,
      clothes: raw.clothes || null,
      pants: raw.pants || null,
      shoes: raw.shoes || null,
      ring1: raw.ring1 || null,
      ring2: raw.ring2 || null,
    };
  } catch {
    return { weapon: null, helmet: null, clothes: null, pants: null, shoes: null, ring1: null, ring2: null };
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

// ---------- 信箱（MailData.js 定義的信件，這裡只記錄每封信的領取/刪除狀態）----------
// 狀態表用 { [郵件id]: 'claimed' | 'deleted' } 這種 map，沒出現在裡面的 id
// 就代表「還沒處理」（信箱列表會顯示成未讀）。
export function getMailStatus() {
  try {
    const raw = JSON.parse(localStorage.getItem(MAIL_STATUS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function _setMailStatus(status) {
  localStorage.setItem(MAIL_STATUS_KEY, JSON.stringify(status));
  _scheduleCloudPush();
}

export function isMailClaimed(id) { return getMailStatus()[id] === 'claimed'; }
export function isMailDeleted(id) { return getMailStatus()[id] === 'deleted'; }

// 標記一封信已領取（實際發放金幣/道具的邏輯在 MailboxScene，這裡只負責記錄狀態，
// 避免同一封信被重複領取）。已經領過或刪除過的信再呼叫一次會直接失敗（回傳 false）。
export function claimMail(id) {
  const status = getMailStatus();
  if (status[id]) return false;
  status[id] = 'claimed';
  _setMailStatus(status);
  return true;
}

// 刪除一封信（不管有沒有領取過都能刪，刪除後信箱列表就不會再顯示）
export function deleteMail(id) {
  const status = getMailStatus();
  status[id] = 'deleted';
  _setMailStatus(status);
}

// ---------- 自動戒指：升級選卡模式（半自動＝維持現狀手動選，全自動＝自動選最左邊那張卡）----------
export function isLevelUpAutoMode() {
  return localStorage.getItem(LEVEL_UP_AUTO_KEY) === '1';
}

export function setLevelUpAutoMode(auto) {
  localStorage.setItem(LEVEL_UP_AUTO_KEY, auto ? '1' : '0');
  _scheduleCloudPush();
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

// ---------- 永久等級系統 ----------
// 注意：這個等級跟「進遊戲後那場戰鬥」的等級（Player.level，決定開局技能/被動選單）
// 完全是兩回事——這是跨場次永久保留、只在背包／主選單顯示的帳號等級，用來發放
// 可以永久投資能力值的技能點。
//
// 經驗值公式分三段，難度依序遞增：
//   Lv 1~49　：溫和的多項式成長（BASE * L^EXP1），練起來很輕鬆
//   Lv 50~99 ：改成複利成長（每級 x GROWTH2），明顯感覺變硬
//   Lv 100+  ：複利成長但倍率更高（每級 x GROWTH3），刻意做得很硬，只有願意長期投入的玩家才練得上去
// 三段在交界處都是「接著前一段最後的數值繼續複利」，不會出現數字忽然斷層式跳躍。
const STAT_EXP_BASE = 25;
const STAT_EXP_TIER1_EXPONENT = 1.6;
const STAT_EXP_TIER1_MAX = 50;  // 到第 50 級之前都算 tier1
const STAT_EXP_TIER2_MAX = 100; // 50~99 算 tier2，100 以後算 tier3
const STAT_EXP_TIER2_GROWTH = 1.045; // 50 級複利下來大約 x9
const STAT_EXP_TIER3_GROWTH = 1.08;  // 複利更陡，100 級之後每一級都要磨很久
const STAT_POINTS_PER_LEVEL = 3;

// 七項能力值都能用升級點數投資，key 直接對應 Player.stats 的欄位名稱，方便
// GameScene/InventoryScene 直接用同一個 key 查加成，不用另外做一層對照表。
// 只有爆擊率有上限（40%，即 200 點 * 0.2%），其餘沒有上限，純粹受限於玩家
// 願意花多少等級去換點數。
const STAT_INVEST_DEFS = {
  maxHp: { perPoint: 5, cap: null },
  attack: { perPoint: 2, cap: null },
  defense: { perPoint: 1, cap: null },
  moveSpeed: { perPoint: 2, cap: null },
  atkSpeed: { perPoint: 0.3, cap: null },
  critRate: { perPoint: 0.2, cap: 200 }, // 40% 上限
  critDmg: { perPoint: 1, cap: null },
};
const RESET_STAT_POINTS_COST = 100000;

// 從 level 升到 level+1 所需經驗值
function expForLevel(level) {
  const tier1 = (L) => Math.round(STAT_EXP_BASE * Math.pow(L, STAT_EXP_TIER1_EXPONENT));
  if (level < STAT_EXP_TIER1_MAX) return tier1(level);

  const e49 = tier1(STAT_EXP_TIER1_MAX - 1);
  if (level < STAT_EXP_TIER2_MAX) {
    const rel = level - (STAT_EXP_TIER1_MAX - 1); // 50 級時 rel=1
    return Math.round(e49 * Math.pow(STAT_EXP_TIER2_GROWTH, rel));
  }

  const e99 = Math.round(e49 * Math.pow(STAT_EXP_TIER2_GROWTH, STAT_EXP_TIER2_MAX - STAT_EXP_TIER1_MAX + 1));
  const rel = level - (STAT_EXP_TIER2_MAX - 1); // 100 級時 rel=1
  return Math.round(e99 * Math.pow(STAT_EXP_TIER3_GROWTH, rel));
}

export function getStatLevel() {
  return Math.max(1, parseInt(localStorage.getItem(STAT_LEVEL_KEY) || '1', 10));
}

export function getStatExp() {
  return Math.max(0, parseInt(localStorage.getItem(STAT_EXP_KEY) || '0', 10));
}

// 目前等級升到下一級所需的經驗值（UI 畫進度條用）
export function getStatExpToNext() {
  return expForLevel(getStatLevel());
}

export function getStatPoints() {
  return Math.max(0, parseInt(localStorage.getItem(STAT_POINTS_KEY) || '0', 10));
}

// 每個能力值目前已投資的點數（key 見 STAT_INVEST_DEFS：maxHp/attack/defense/
// moveSpeed/atkSpeed/critRate/critDmg）
export function getStatInvest() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STAT_INVEST_KEY) || '{}');
    for (const key of Object.keys(STAT_INVEST_DEFS)) {
      out[key] = Math.max(0, parseInt(raw[key], 10) || 0);
    }
  } catch {
    for (const key of Object.keys(STAT_INVEST_DEFS)) out[key] = 0;
  }
  return out;
}

function _setStatInvest(invest) {
  localStorage.setItem(STAT_INVEST_KEY, JSON.stringify(invest));
}

// 某個能力值已投資的點數換算成實際加成數值
export function getStatBonus(key) {
  const def = STAT_INVEST_DEFS[key];
  if (!def) return 0;
  return getStatInvest()[key] * def.perPoint;
}

// 增加永久經驗值，處理連續升級（一次給很多經驗值可能一口氣跳好幾級）；
// 每升一級發放 STAT_POINTS_PER_LEVEL 點技能點。回傳升了幾級，方便呼叫端顯示提示。
export function addStatExp(amount) {
  if (amount <= 0) return 0;
  let level = getStatLevel();
  let exp = getStatExp() + Math.floor(amount);
  let levelsGained = 0;

  let need = expForLevel(level);
  while (exp >= need) {
    exp -= need;
    level += 1;
    levelsGained += 1;
    need = expForLevel(level);
  }

  localStorage.setItem(STAT_LEVEL_KEY, String(level));
  localStorage.setItem(STAT_EXP_KEY, String(exp));
  if (levelsGained > 0) {
    localStorage.setItem(STAT_POINTS_KEY, String(getStatPoints() + levelsGained * STAT_POINTS_PER_LEVEL));
  }
  _scheduleCloudPush();
  return levelsGained;
}

// 把一點技能點投資到指定能力值（key 見 STAT_INVEST_DEFS）：沒有剩餘點數、
// 或該項已經到上限（目前只有爆擊率有 40% 上限）就不會成功。
// 回傳是否真的投資成功（呼叫端可以用這個決定要不要繼續讓玩家點下一次）。
export function investStatPoint(key) {
  const def = STAT_INVEST_DEFS[key];
  if (!def) return false;
  const points = getStatPoints();
  const invest = getStatInvest();
  if (points <= 0) return false;
  if (def.cap != null && invest[key] >= def.cap) return false;
  invest[key] += 1;
  _setStatInvest(invest);
  localStorage.setItem(STAT_POINTS_KEY, String(points - 1));
  _scheduleCloudPush();
  return true;
}

// 重置所有升級獲得的能力值：把七項能力值已投資的點數全部退回可用點數池，
// 裝備本身的加成完全不受影響。需要花費 10 萬金幣，金幣不夠就不會執行（回傳 false）。
export function resetStatPoints() {
  if (!spendGold(RESET_STAT_POINTS_COST)) return false;
  const invest = getStatInvest();
  const totalInvested = Object.values(invest).reduce((a, b) => a + b, 0);
  localStorage.setItem(STAT_POINTS_KEY, String(getStatPoints() + totalInvested));
  const cleared = {};
  for (const key of Object.keys(STAT_INVEST_DEFS)) cleared[key] = 0;
  _setStatInvest(cleared);
  _scheduleCloudPush();
  return true;
}

export const RESET_STAT_POINTS_GOLD_COST = RESET_STAT_POINTS_COST;
export { STAT_INVEST_DEFS };

// ---------- 帳號雲端同步 ----------

// 把目前本機的存檔內容打包成一個物件，用來上傳／覆蓋雲端帳號資料
function _gatherLocalBundle() {
  return {
    gold: getGold(),
    inventory: getInventory(),
    equipped: getEquipped(),
    checkpointStage: getCheckpointStage(),
    bestScore: getBestScore(),
    statLevel: getStatLevel(),
    statExp: getStatExp(),
    statPoints: getStatPoints(),
    statInvest: getStatInvest(),
    mailStatus: getMailStatus(),
    levelUpAutoMode: isLevelUpAutoMode(),
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
  if (typeof data.statLevel === 'number') {
    localStorage.setItem(STAT_LEVEL_KEY, String(Math.max(1, Math.floor(data.statLevel))));
  }
  if (typeof data.statExp === 'number') {
    localStorage.setItem(STAT_EXP_KEY, String(Math.max(0, Math.floor(data.statExp))));
  }
  if (typeof data.statPoints === 'number') {
    localStorage.setItem(STAT_POINTS_KEY, String(Math.max(0, Math.floor(data.statPoints))));
  }
  if (data.statInvest && typeof data.statInvest === 'object') {
    const cleaned = {};
    for (const key of Object.keys(STAT_INVEST_DEFS)) {
      cleaned[key] = Math.max(0, Math.floor(data.statInvest[key]) || 0);
    }
    localStorage.setItem(STAT_INVEST_KEY, JSON.stringify(cleaned));
  }
  if (data.mailStatus && typeof data.mailStatus === 'object') {
    localStorage.setItem(MAIL_STATUS_KEY, JSON.stringify(data.mailStatus));
  }
  if (typeof data.levelUpAutoMode === 'boolean') {
    localStorage.setItem(LEVEL_UP_AUTO_KEY, data.levelUpAutoMode ? '1' : '0');
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
  localStorage.removeItem(STAT_LEVEL_KEY);
  localStorage.removeItem(STAT_EXP_KEY);
  localStorage.removeItem(STAT_POINTS_KEY);
  localStorage.removeItem(STAT_INVEST_KEY);
  localStorage.removeItem(MAIL_STATUS_KEY);
  localStorage.removeItem(LEVEL_UP_AUTO_KEY);
  location.reload();
}
