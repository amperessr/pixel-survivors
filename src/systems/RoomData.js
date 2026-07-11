// 房間拼接資料：把地圖拆成一格一格 8x8（跟 MapGenerator.CHUNK_SIZE 對齊）的
// 「房間模板」，每個模板是一種固定花紋（開闊空地/小徑/水域/裝飾群...），
// MapGenerator 生成 chunk 時從對應地形的模板庫隨機挑一塊貼上去，而不是像
// 舊版那樣逐格算機率——這樣同一顆種子在同一個座標永遠選到同一個模板，
// 地圖才能被「重現」。
//
// Tile 代碼（三種地形共用同一套語意，方便 BIOME_TILE_RENDER 對照渲染）：
//   0 = 平地　1 = 小徑　2 = 水域(河流/綠洲/結冰湖)
//   3 = 平地 + 高大裝飾(樹/仙人掌/松樹，有碰撞)
//   4 = 平地 + 岩石裝飾(有碰撞)　5 = 平地 + 矮裝飾(花/乾灌木/雪灌木，無碰撞)
//
// 資料壓縮：模板不存成 8x8 的二維陣列或攤平成 64 個數字的 JSON（那樣每個模板
// 要 200+ 字元），改存「RLE 跑程編碼」字串——格式 "<代碼>-<連續次數>,..."，
// 例如 "0-24,1-16,0-24" 代表「24 格平地、接著 16 格小徑、再 24 格平地」，
// decodeRLE() 在執行期展開回 64 格的代碼陣列。多數模板都有大片同代碼的區域
// （大片平地中間穿插裝飾/小徑），RLE 壓縮效果很好，同時字串本身還算可讀，
// 不用上 Base64/二進位——這批資料活在原始碼裡、不是網路傳輸，可讀性比極限壓縮更重要。

export const ROOM_SIZE = 8; // 跟 MapGenerator.CHUNK_SIZE 對齊，一個房間＝一個 chunk

// ---- RLE Codec ----
export function encodeRLE(codes) {
  let out = '';
  let i = 0;
  while (i < codes.length) {
    let j = i;
    while (j < codes.length && codes[j] === codes[i]) j++;
    out += (out ? ',' : '') + codes[i] + '-' + (j - i);
    i = j;
  }
  return out;
}

export function decodeRLE(str) {
  const codes = [];
  str.split(',').forEach((tok) => {
    const [codeStr, countStr] = tok.split('-');
    const code = Number(codeStr);
    const count = Number(countStr);
    for (let k = 0; k < count; k++) codes.push(code);
  });
  return codes;
}

// 幾個模板是「固定小花紋重複貼滿整格」（例如岩石帶、密集樹林），與其手動把
// 同一組 token 貼 8~16 次容易數錯，這裡用小工具組出來，一樣是「執行期才展開
// 成完整資料」的壓縮寫法，只是 pattern 本身也用簡短字串描述。
function repeatPattern(pattern, times) {
  return Array(times).fill(pattern).join(',');
}

// 開發期防呆：模板數量算錯（漏格/多格）會直接讓 tilemap 的 putTileAt 對不上
// chunk 座標，與其上線後才發現地圖出現裂縫，這裡在模組載入當下就檢查每個
// 模板展開後剛好是 ROOM_SIZE*ROOM_SIZE 格，算錯會直接在主控台報錯方便抓。
function validateTemplates(name, list) {
  const expected = ROOM_SIZE * ROOM_SIZE;
  list.forEach((rle, i) => {
    const len = decodeRLE(rle).length;
    if (len !== expected) {
      console.error(`[RoomData] ${name}[${i}] 展開後長度 ${len}，預期 ${expected}：${rle}`);
    }
  });
  return list;
}

// ---- 房間模板（各地形 5 種花紋；grassForest 是汪汪大作戰森林場景專用的
// 高密度樹林變體，取代舊版用機率閾值硬拉高樹木機率的做法）----
export const ROOM_TEMPLATES = {
  grass: validateTemplates('grass', [
    '0-20,5-1,0-15,5-1,0-15,5-1,0-11',   // 開闊空地，零星花朵
    '0-24,1-16,0-24',                     // 小徑橫越
    '0-48,2-16',                          // 河岸（底部兩排是河流）
    repeatPattern('0-6,4-2', 8),          // 岩石帶
    repeatPattern('0-4,3-4', 8),          // 密集樹林
  ]),
  grassForest: validateTemplates('grassForest', [
    repeatPattern('0-1,3-3', 16),         // 超高密度樹林
    '3-28,1-8,3-28',                      // 樹林中一條小徑穿越
  ]),
  desert: validateTemplates('desert', [
    '0-22,5-1,0-18,5-1,0-22',             // 開闊沙丘，零星乾灌木
    '0-24,1-16,0-24',                     // 沙徑橫越
    '0-27,2-10,0-27',                     // 綠洲水塘
    repeatPattern('0-4,3-4', 8),          // 仙人掌群
    repeatPattern('0-6,4-2', 8),          // 沙丘岩脊
  ]),
  snow: validateTemplates('snow', [
    '0-22,5-1,0-18,5-1,0-22',             // 開闊雪原，零星雪灌木
    '0-24,1-16,0-24',                     // 雪徑橫越
    '0-27,2-10,0-27',                     // 結冰湖
    repeatPattern('0-4,3-4', 8),          // 松林
    repeatPattern('0-6,4-2', 8),          // 冰岩脊
  ]),
};

// 每種地形對照哪張地板圖塊集（供 Phaser Tilemap 當 tileset 來源，見
// TextureFactory 產生的 tileset_grass/tileset_desert/tileset_snow，frame
// 0/1/2 分別對應 tile 代碼 0/1/2），以及裝飾代碼(3/4/5)各自要疊哪張圖、
// 需不需要碰撞體（有碰撞的比照現有 obj_tree/obj_rock 的 body 設定方式）。
export const BIOME_TILE_RENDER = {
  grass: {
    tileset: 'tileset_grass',
    decor: {
      3: { tex: 'obj_tree', solid: true },
      4: { tex: 'obj_rock', solid: true },
      5: { tex: 'obj_flower', solid: false },
    },
  },
  desert: {
    tileset: 'tileset_desert',
    decor: {
      3: { tex: 'obj_cactus', solid: true },
      4: { tex: 'obj_dune_rock', solid: true },
      5: { tex: 'obj_dry_bush', solid: false },
    },
  },
  snow: {
    tileset: 'tileset_snow',
    decor: {
      3: { tex: 'obj_pine', solid: true },
      4: { tex: 'obj_ice_rock', solid: true },
      5: { tex: 'obj_snow_bush', solid: false },
    },
  },
};

export const BIOME_IDS = ['grass', 'desert', 'snow'];
