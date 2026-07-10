// Firebase Realtime Database 排行榜整合
// 注意：依需求規格，使用 Realtime Database，不使用 Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  query,
  orderByChild,
  limitToLast,
  onValue,
  get,
  set,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// 專案設定：使用使用者提供的 Realtime Database URL
const firebaseConfig = {
  databaseURL:
    "https://game-text-cd3c2-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

let app = null;
let db = null;

function ensureInit() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
}

/**
 * 上傳分數紀錄到排行榜。
 * 改版（修正「榜上的人一直消失」）：不再每場遊戲 push 一筆新紀錄（那會讓資料庫
 * 無限成長，顯示端只撈前 100 筆原始紀錄，常玩的人一個人就佔掉幾十筆，把其他人的
 * 最高分擠出窗口、名字就從榜上消失）——改成每個玩家在 leaderboardBest/<名字> 底下
 * 永遠只存「一筆」自己的最高分，新分數比較高才覆蓋，每人固定一筆、誰也擠不掉誰。
 * @param {{name:string, score:number, kill:number, time:number, date:string}} entry
 */
export async function submitScore(entry) {
  try {
    ensureInit();
    const bestRef = ref(db, `leaderboardBest/${sanitizeNameKey(entry.name || "???")}`);
    const snapshot = await get(bestRef);
    if (!snapshot.exists() || (entry.score || 0) > (snapshot.val().score || 0)) {
      await set(bestRef, entry);
    }
    return true;
  } catch (err) {
    console.warn("[Firebase] 上傳分數失敗（可能離線或網路受限）：", err.message);
    return false;
  }
}

/**
 * 訂閱排行榜 TOP10，依 score 排序，即時同步。
 * 資料來源是 leaderboardBest（每個玩家固定一筆最高分，見 submitScore），
 * 直接撈前 10 筆就是前 10 名「不同的人」，不需要再去重，也不會有人被擠出窗口。
 * 舊的「每場一筆」leaderboard 節點資料已經在 2026-07-10 一次性搬移到
 * leaderboardBest（依名字取最高分），舊節點保留不動、但程式不再讀寫。
 * @param {(list: Array) => void} callback
 * @returns {Function} unsubscribe
 */
export function subscribeLeaderboard(callback) {
  try {
    ensureInit();
    const topQuery = query(ref(db, "leaderboardBest"), orderByChild("score"), limitToLast(10));
    const unsubscribe = onValue(
      topQuery,
      (snapshot) => {
        const rows = [];
        snapshot.forEach((child) => {
          rows.push(child.val());
        });
        rows.sort((a, b) => (b.score || 0) - (a.score || 0));
        callback(rows);
      },
      (err) => {
        console.warn("[Firebase] 讀取排行榜失敗：", err.message);
        callback([]);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn("[Firebase] 初始化失敗：", err.message);
    callback([]);
    return () => {};
  }
}

/**
 * 汪汪大作戰（限時挑戰活動）專用排行榜：跟一般排行榜的 leaderboardBest 是完全
 * 獨立的節點，存的是「對汪汪造成的實際減血量」（單次最高），規則跟 submitScore
 * 一樣——每個玩家固定一筆最高紀錄，新紀錄比較高才覆蓋。
 * @param {{name:string, damage:number, date:string}} entry
 */
export async function submitWoofWarScore(entry) {
  try {
    ensureInit();
    const bestRef = ref(db, `woofWarLeaderboardBest/${sanitizeNameKey(entry.name || "???")}`);
    const snapshot = await get(bestRef);
    if (!snapshot.exists() || (entry.damage || 0) > (snapshot.val().damage || 0)) {
      await set(bestRef, entry);
    }
    return true;
  } catch (err) {
    console.warn("[Firebase] 上傳汪汪大作戰分數失敗（可能離線或網路受限）：", err.message);
    return false;
  }
}

/**
 * 訂閱汪汪大作戰排行榜 TOP10，依傷害排序，即時同步。
 * @param {(list: Array) => void} callback
 * @returns {Function} unsubscribe
 */
export function subscribeWoofWarLeaderboard(callback) {
  try {
    ensureInit();
    const topQuery = query(ref(db, "woofWarLeaderboardBest"), orderByChild("damage"), limitToLast(10));
    const unsubscribe = onValue(
      topQuery,
      (snapshot) => {
        const rows = [];
        snapshot.forEach((child) => { rows.push(child.val()); });
        rows.sort((a, b) => (b.damage || 0) - (a.damage || 0));
        callback(rows);
      },
      (err) => {
        console.warn("[Firebase] 讀取汪汪大作戰排行榜失敗：", err.message);
        callback([]);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn("[Firebase] 初始化失敗：", err.message);
    callback([]);
    return () => {};
  }
}

/**
 * 撈「完整」汪汪大作戰排行榜（不像 subscribeWoofWarLeaderboard 卡在 TOP10），
 * 依傷害由高到低排序，供活動結束後結算 TOP1~3／參加獎用——需要知道每個玩家
 * 的實際名次，也需要知道「有沒有參加過」（陣列裡有沒有這個名字），只抓 TOP10
 * 沒辦法回答這兩個問題。只在活動結束後、每個玩家自己的帳號只需要撈一次
 * （見 WoofWarRewardSystem.resolveWoofWarRewardIfNeeded 的快取判斷），不會頻繁呼叫。
 * @returns {Promise<Array<{name:string, damage:number, date:string}>>}
 */
export async function fetchFullWoofWarLeaderboard() {
  try {
    ensureInit();
    const snapshot = await get(ref(db, 'woofWarLeaderboardBest'));
    const rows = [];
    snapshot.forEach((child) => { rows.push(child.val()); });
    rows.sort((a, b) => (b.damage || 0) - (a.damage || 0));
    return rows;
  } catch (err) {
    console.warn('[Firebase] 讀取完整汪汪排行榜失敗：', err.message);
    return [];
  }
}

// ---------- 帳號系統：用名字＋密碼把存檔（金幣/裝備/背包/關卡進度）同步到雲端， ----------
// ---------- 讓同一個名字在不同電腦登入都能讀到最新進度。 ----------

// Realtime Database 的 key 不能包含 . # $ [ ] / ，把這些字元換掉，
// 避免玩家名字剛好用到這些符號時整個路徑失效。
function sanitizeNameKey(name) {
  return String(name).replace(/[.#$/\[\]]/g, "_");
}

// 密碼不能明碼存在資料庫裡：用瀏覽器內建的 Web Crypto API 做 SHA-256 雜湊，
// 資料庫裡只會存雜湊後的字串，存取時也只比對雜湊值。
export async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 讀取某個名字底下的雲端帳號資料。
 * @returns {Promise<{exists:boolean, data:Object|null}>}
 */
export async function fetchAccount(name) {
  ensureInit();
  const accountRef = ref(db, `accounts/${sanitizeNameKey(name)}`);
  const snapshot = await get(accountRef);
  if (!snapshot.exists()) return { exists: false, data: null };
  return { exists: true, data: snapshot.val() };
}

/**
 * 把整包帳號資料（密碼雜湊 + 金幣/裝備/背包/關卡進度）寫入雲端，
 * 用 set() 整包覆蓋，不是只更新單一欄位，避免不同裝置各自局部更新造成資料不一致。
 */
export async function saveAccount(name, data) {
  ensureInit();
  const accountRef = ref(db, `accounts/${sanitizeNameKey(name)}`);
  await set(accountRef, data);
}
