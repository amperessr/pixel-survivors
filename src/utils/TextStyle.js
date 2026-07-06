// 統一的文字樣式：使用系統內建的「黑體」類粗體中文字型，確保可讀性
// （原本沒有指定 fontFamily 時，Phaser 預設字型是 Courier 等西文字型，
// 中文字會退回瀏覽器隨便挑的字型，筆畫細、不好辨識）
export const FONT_FAMILY =
  '"Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "PingFang SC", ' +
  '"Heiti TC", "Noto Sans TC", "Noto Sans CJK TC", Arial, sans-serif';

// 用法：this.add.text(x, y, str, textStyle({ fontSize: '20px', color: '#fff' }))
// 預設一律使用粗體黑體；若呼叫端自己指定了 fontStyle（例如標題想用 italic 斜體）
// 則以呼叫端的設定為準。
export function textStyle(style = {}) {
  return {
    fontFamily: FONT_FAMILY,
    fontStyle: 'bold',
    ...style,
  };
}
