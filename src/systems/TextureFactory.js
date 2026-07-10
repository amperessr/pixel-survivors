// 素材產生器：以 Canvas 動態繪製所有像素風美術素材並註冊為 Phaser 材質
// 依規格：若無法直接產生 PNG，改以 Canvas 動態生成 (可愛 Q 版 / 明亮色彩 / 2.5D 俯視風格)
export default class TextureFactory {
  constructor(scene) {
    this.scene = scene;
  }

  // 建立一張畫布材質並回傳 context
  _canvas(key, w, h) {
    const tex = this.scene.textures.createCanvas(key, w, h);
    return { tex, ctx: tex.getContext() };
  }

  _finish(tex) {
    tex.refresh();
    // 重要：main.js 裡的 pixelArt:true 只會影響「載入的圖片」預設濾鏡，
    // 對於這種用 Canvas 動態畫出來、跑時建立的材質，Phaser 不會自動套用最近鄰濾鏡，
    // 預設會用 LINEAR（線性內插）造成放大時模糊。這裡強制設成 NEAREST，
    // 讓所有素材（角色、怪物、UI、特效...）放大後都維持清晰銳利的像素風。
    // 用 try/catch 包起來：就算這一步在某些瀏覽器/渲染模式下出狀況，
    // 也絕對不能讓後面所有素材（包含怪物）整批生不出來。
    try {
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    } catch (err) {
      console.warn('[TextureFactory] setFilter 失敗，改用預設濾鏡：', err);
    }
  }

  // 圓角矩形工具
  static roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  generateAll() {
    // 每個分類獨立 try/catch：就算某一類素材（例如角色）出了狀況，
    // 也不能連帶讓後面的怪物、UI、特效等材質整批生不出來。
    const steps = [
      ['generatePlayers', () => this.generatePlayers()],
      ['generateEnemies', () => this.generateEnemies()],
      ['generateBoss', () => this.generateBoss()],
      ['generateWeaponIcons', () => this.generateWeaponIcons()],
      ['generateProjectiles', () => this.generateProjectiles()],
      ['generatePassiveIcons', () => this.generatePassiveIcons()],
      ['generateTiles', () => this.generateTiles()],
      ['generateEffects', () => this.generateEffects()],
      ['generatePickups', () => this.generatePickups()],
      ['generateUI', () => this.generateUI()],
      ['generateGachaMachine', () => this.generateGachaMachine()],
      ['generateLootBalls', () => this.generateLootBalls()],
    ];
    for (const [name, fn] of steps) {
      try {
        fn();
      } catch (err) {
        console.error(`[TextureFactory] ${name} 產生素材時發生錯誤，已跳過並繼續下一批：`, err);
      }
    }
  }

  // ---------- 玩家四種角色 (Q版圓潤造型，用色區分職業) ----------
  // 注意：這裡用 64x64（原本 32x32 的兩倍）繪製，讓選角畫面放大顯示時
  // 有更多細節可看，而不是把一張很小的圖直接暴力放大變得死板。
  generatePlayers() {
    // 'balanced' 現在改用玩家提供的正式美術圖（藍色史萊姆，見 BootScene 的
    // player_balanced 圖片載入），不再程式產生，避免跟載入的圖片同一個材質 key 衝突。
    // 其餘三種角色目前選角畫面已經沒有入口（CharacterSelectScene 沒有被排進場景清單），
    // 保留程式產生只是不讓 Player.js 裡的 CHARACTERS 定義失效，不影響實際遊戲畫面。
    const palette = {
      attacker: { body: '#ff6b5b', trim: '#c73f30', eye: '#2b2b2b' },
      speedster: { body: '#5bd4ff', trim: '#2a9ec2', eye: '#2b2b2b' },
      tank: { body: '#8f6bff', trim: '#5b3fc7', eye: '#2b2b2b' },
    };
    for (const [id, c] of Object.entries(palette)) {
      const { tex, ctx } = this._canvas(`player_${id}`, 64, 64);
      // 陰影
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(32, 54, 18, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // 身體 (圓潤Q版)
      ctx.fillStyle = c.body;
      TextureFactory.roundRect(ctx, 14, 16, 36, 36, 16);
      ctx.fill();
      ctx.strokeStyle = c.trim;
      ctx.lineWidth = 4;
      ctx.stroke();
      // 頭頂高光
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      TextureFactory.roundRect(ctx, 18, 20, 16, 10, 6);
      ctx.fill();
      // 眼睛
      ctx.fillStyle = c.eye;
      ctx.beginPath(); ctx.arc(26, 34, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(38, 34, 3.2, 0, Math.PI * 2); ctx.fill();
      // 披風/裝飾 (區分職業)
      ctx.fillStyle = c.trim;
      ctx.fillRect(12, 24, 6, 20);
      ctx.fillRect(46, 24, 6, 20);
      this._finish(tex);
    }
  }

  // ---------- 敵人四種一般怪 ----------
  // 2026-07-10：四種怪物已全部換成玩家提供的正式美術圖（山豬/哥布林/骷髏/半獸人，
  // 見 assets/enemy_*.png），這裡不再需要程式產生頂替貼圖，改到 BootScene.preload()
  // 用 load.image() 載入即可。
  generateEnemies() {}

  // ---------- Boss (大型、威嚴、發光) ----------
  // Boss：黑藍色系西方龍。用 128x128 高解析度繪製（原本只有 64x64 太模糊），
  // 具備翅膀、龍角、發光雙眼、尖刺背脊與捲曲尾巴。
  generateBoss() {
    const { tex, ctx } = this._canvas('boss_main', 128, 128);
    const cx = 64, cy = 66;

    // 深藍光暈
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 70);
    grad.addColorStop(0, 'rgba(70,110,255,0.4)');
    grad.addColorStop(1, 'rgba(70,110,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    // 尾巴（從身體後方向下捲起）
    ctx.strokeStyle = '#141c33';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy + 32);
    ctx.quadraticCurveTo(cx + 34, cy + 52, cx + 14, cy + 72);
    ctx.stroke();
    ctx.fillStyle = '#0a0e1c';
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy + 72); ctx.lineTo(cx + 22, cy + 64); ctx.lineTo(cx + 24, cy + 78);
    ctx.closePath(); ctx.fill();

    // 翅膀（蝙蝠翼狀，左右對稱）
    const drawWing = (dir) => {
      ctx.fillStyle = '#0d1226';
      ctx.beginPath();
      ctx.moveTo(cx + dir * 16, cy - 10);
      ctx.lineTo(cx + dir * 62, cy - 40);
      ctx.lineTo(cx + dir * 50, cy - 8);
      ctx.lineTo(cx + dir * 66, cy + 4);
      ctx.lineTo(cx + dir * 44, cy + 8);
      ctx.lineTo(cx + dir * 50, cy + 26);
      ctx.lineTo(cx + dir * 22, cy + 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#33488a';
      ctx.lineWidth = 2;
      ctx.stroke();
      // 翼膜紋路
      ctx.strokeStyle = 'rgba(80,110,200,0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + dir * 16, cy - 10); ctx.lineTo(cx + dir * 50, cy - 8);
      ctx.moveTo(cx + dir * 16, cy - 10); ctx.lineTo(cx + dir * 44, cy + 8);
      ctx.stroke();
    };
    drawWing(-1);
    drawWing(1);

    // 身體（漸層深藍到近黑）
    const bodyGrad = ctx.createLinearGradient(cx, cy - 34, cx, cy + 34);
    bodyGrad.addColorStop(0, '#2d3f73');
    bodyGrad.addColorStop(1, '#12192e');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 28, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#080b16';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 腹部亮藍鱗片
    ctx.fillStyle = '#3f62a8';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18, 13, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,30,60,0.5)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 4 + i * 9, 13 - i, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 背脊尖刺
    ctx.fillStyle = '#080b16';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 12 - 5, cy - 20);
      ctx.lineTo(cx + i * 12, cy - 36);
      ctx.lineTo(cx + i * 12 + 5, cy - 20);
      ctx.closePath();
      ctx.fill();
    }

    // 頭部
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 32, 19, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#080b16';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 龍角
    ctx.fillStyle = '#cbd5e0';
    ctx.beginPath(); ctx.moveTo(cx - 15, cy - 42); ctx.lineTo(cx - 25, cy - 64); ctx.lineTo(cx - 8, cy - 45); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 15, cy - 42); ctx.lineTo(cx + 25, cy - 64); ctx.lineTo(cx + 8, cy - 45); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a97a8';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 鼻吻／嘴部
    ctx.fillStyle = '#101830';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 19, 10, 8, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#dfe6ee';
    for (let i = -6; i <= 6; i += 4) {
      ctx.fillRect(cx + i, cy - 21, 2, 4);
    }

    // 發光雙眼（冰藍色，符合黑藍龍設定）
    const drawEye = (dx) => {
      ctx.fillStyle = '#8fe3ff';
      ctx.beginPath(); ctx.arc(cx + dx, cy - 34, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eafcff';
      ctx.beginPath(); ctx.arc(cx + dx, cy - 34, 1.7, 0, Math.PI * 2); ctx.fill();
    };
    drawEye(-8);
    drawEye(8);

    // 陰影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 46, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    this._finish(tex);
  }

  // ---------- 武器圖示 (5種 x 5階：以顏色深淺與大小表現階級) ----------
  generateWeaponIcons() {
    const weapons = {
      fireball: { base: '#ff8a3d', glow: '#ffdd55' },
      lightning: { base: '#ffe94d', glow: '#fff9c4' },
      knife: { base: '#c9d6df', glow: '#8fa3ad' },
      sawblade: { base: '#c0c0c0', glow: '#6e6e6e' },
      frost: { base: '#8fe3ff', glow: '#e3faff' },
    };
    for (const [id, c] of Object.entries(weapons)) {
      for (let lvl = 1; lvl <= 5; lvl++) {
        const size = 20 + lvl * 3;
        const { tex, ctx } = this._canvas(`weapon_${id}_lv${lvl}`, size, size);
        const cx = size / 2, cy = size / 2, r = size / 2 - 2;
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
        grad.addColorStop(0, c.glow);
        grad.addColorStop(1, c.base);
        ctx.fillStyle = grad;
        if (id === 'knife') {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2, -r, 4, r * 2);
          ctx.restore();
        } else if (id === 'sawblade') {
          ctx.beginPath();
          const teeth = 8;
          for (let i = 0; i < teeth * 2; i++) {
            const ang = (i / (teeth * 2)) * Math.PI * 2;
            const rr = i % 2 === 0 ? r : r * 0.7;
            const px = cx + Math.cos(ang) * rr;
            const py = cy + Math.sin(ang) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#555';
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fill();
        } else if (id === 'lightning') {
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.2, cy - r);
          ctx.lineTo(cx + r * 0.3, cy - r * 0.1);
          ctx.lineTo(cx - r * 0.1, cy - r * 0.1);
          ctx.lineTo(cx + r * 0.2, cy + r);
          ctx.lineTo(cx - r * 0.3, cy + r * 0.1);
          ctx.lineTo(cx + r * 0.1, cy + r * 0.1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        this._finish(tex);
      }
    }
  }

  // ---------- 飛行道具實體 (用於場上實際發射的物件) ----------
  generateProjectiles() {
    const defs = {
      proj_fireball: { color: '#ff8a3d', glow: '#ffdd55', r: 8 },
      proj_lightning: { color: '#ffe94d', glow: '#fff9c4', r: 6 },
      proj_knife: { color: '#c9d6df', glow: '#8fa3ad', r: 5 },
      proj_sawblade: { color: '#c0c0c0', glow: '#6e6e6e', r: 9 },
      proj_frost: { color: '#8fe3ff', glow: '#e3faff', r: 7 },
    };
    for (const [key, d] of Object.entries(defs)) {
      const size = d.r * 2 + 4;
      const { tex, ctx } = this._canvas(key, size, size);
      const cx = size / 2, cy = size / 2;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, d.r);
      grad.addColorStop(0, d.glow);
      grad.addColorStop(1, d.color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, d.r, 0, Math.PI * 2);
      ctx.fill();
      this._finish(tex);
    }
  }

  // ---------- 被動能力圖示 ----------
  generatePassiveIcons() {
    const passives = {
      attack: '#ff5b5b',
      critRate: '#ffd93d',
      critDmg: '#ff9d3d',
      atkSpeed: '#5bd4ff',
      moveSpeed: '#5bff8f',
      defense: '#8fa3b8', // 防禦目前不是被動技能項目，但底部狀態列要用同一套圖示風格顯示防禦力
    };
    for (const [id, color] of Object.entries(passives)) {
      const { tex, ctx } = this._canvas(`icon_${id}`, 22, 22);
      ctx.fillStyle = color;
      TextureFactory.roundRect(ctx, 2, 2, 18, 18, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(11, 5); ctx.lineTo(14, 11); ctx.lineTo(11, 17); ctx.lineTo(8, 11);
      ctx.closePath();
      ctx.fill();
      this._finish(tex);
    }
  }

  // ---------- 地圖 Tile (草地/樹/石頭/花/河流/小路) ----------
  generateTiles() {
    const T = 32;
    // 草地
    {
      const { tex, ctx } = this._canvas('tile_grass', T, T);
      ctx.fillStyle = '#5cb85c';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(80,160,80,0.5)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(Math.random() * T, Math.random() * T, 2, 2);
      }
      this._finish(tex);
    }
    // 小路
    {
      const { tex, ctx } = this._canvas('tile_path', T, T);
      ctx.fillStyle = '#d8c48a';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(160,140,90,0.4)';
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(Math.random() * T, Math.random() * T, 2, 2);
      }
      this._finish(tex);
    }
    // 河流
    {
      const { tex, ctx } = this._canvas('tile_river', T, T);
      ctx.fillStyle = '#4aa3e0';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(0, 10, T, 3);
      ctx.fillRect(0, 22, T, 2);
      this._finish(tex);
    }
    // 樹
    {
      const { tex, ctx } = this._canvas('obj_tree', T, T + 12);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(T / 2, T + 8, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a4a2a';
      ctx.fillRect(T / 2 - 3, T - 8, 6, 16);
      ctx.fillStyle = '#3f9e4a';
      ctx.beginPath(); ctx.arc(T / 2, 12, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#57c266';
      ctx.beginPath(); ctx.arc(T / 2 - 5, 8, 7, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 石頭
    {
      const { tex, ctx } = this._canvas('obj_rock', T, T);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(16, 26, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a9a9a';
      ctx.beginPath(); ctx.ellipse(16, 18, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.ellipse(12, 14, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 花
    {
      const { tex, ctx } = this._canvas('obj_flower', T, T);
      const colors = ['#ff6b9d', '#ffd93d', '#fff'];
      const c = colors[Math.floor(Math.random() * colors.length)];
      ctx.fillStyle = '#3f9e4a';
      ctx.fillRect(15, 18, 2, 10);
      ctx.fillStyle = c;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(16 + Math.cos(ang) * 4, 16 + Math.sin(ang) * 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath(); ctx.arc(16, 16, 2.5, 0, Math.PI * 2); ctx.fill();
      this._finish(tex);
    }
    // 背景 (更大範圍的草原漸層，作為 tilesprite 背景備援)
    {
      const { tex, ctx } = this._canvas('bg_field', 256, 256);
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#68c26a');
      grad.addColorStop(1, '#4fa851');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      this._finish(tex);
    }
  }

  // ---------- 特效 (爆擊/擊殺/火焰/雷電/冰凍/升級光圈/Boss死亡) ----------
  generateEffects() {
    const mk = (key, size, draw) => {
      const { tex, ctx } = this._canvas(key, size, size);
      draw(ctx, size);
      this._finish(tex);
    };
    mk('fx_crit', 28, (ctx, s) => {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 3;
      const cx = s / 2, cy = s / 2;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * 4, cy + Math.sin(ang) * 4);
        ctx.lineTo(cx + Math.cos(ang) * 12, cy + Math.sin(ang) * 12);
        ctx.stroke();
      }
    });
    mk('fx_kill', 26, (ctx, s) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); ctx.fill();
    });
    mk('fx_flame', 24, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#ffdd55');
      grad.addColorStop(0.6, '#ff8a3d');
      grad.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    mk('fx_bolt', 24, (ctx, s) => {
      ctx.strokeStyle = '#fff9c4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 2); ctx.lineTo(14, 10); ctx.lineTo(8, 12); ctx.lineTo(20, 22);
      ctx.stroke();
    });
    mk('fx_frost', 24, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#e3faff');
      grad.addColorStop(1, 'rgba(140,220,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    mk('fx_levelup', 64, (ctx, s) => {
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(111,211,255,0.5)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2); ctx.stroke();
    });
    mk('fx_bossdeath', 96, (ctx, s) => {
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.4, '#ffcf4d');
      grad.addColorStop(1, 'rgba(255,80,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });

    // 龍之翼遺物特效改用真實美術圖片（見 BootScene.preload() 載入的
    // 'fx_dragon_wing_pair'），這裡不再用 Canvas 畫近似形狀。

    // 龍爪招式特效已換成正式美術圖（fx_claw_slash_gold／fx_claw_slash_amber，見
    // BootScene.preload()），這裡不再用 Canvas 畫近似弧形。

    // 經驗寶石
    mk('gem_exp', 12, (ctx, s) => {
      ctx.fillStyle = '#6fe3ff';
      ctx.beginPath();
      ctx.moveTo(s / 2, 0); ctx.lineTo(s, s / 2); ctx.lineTo(s / 2, s); ctx.lineTo(0, s / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  // ---------- 拾取物：血包 ----------
  generatePickups() {
    const { tex, ctx } = this._canvas('pickup_heart', 30, 30);
    // 外層光暈
    const glow = ctx.createRadialGradient(15, 15, 2, 15, 15, 15);
    glow.addColorStop(0, 'rgba(255,90,110,0.55)');
    glow.addColorStop(1, 'rgba(255,90,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 30, 30);
    // 愛心形狀
    ctx.fillStyle = '#ff3d5a';
    ctx.beginPath();
    ctx.moveTo(15, 12);
    ctx.bezierCurveTo(15, 8, 9, 6, 6, 10);
    ctx.bezierCurveTo(2, 15, 8, 20, 15, 26);
    ctx.bezierCurveTo(22, 20, 28, 15, 24, 10);
    ctx.bezierCurveTo(21, 6, 15, 8, 15, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#a30020';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(10, 12, 2.6, 1.8, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // 十字白色標記，讓玩家一眼認出是補血道具
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(13, 15, 4, 9);
    ctx.fillRect(10.5, 17.5, 9, 4);
    this._finish(tex);

    this._genMagnetPickup();
  }

  // ---------- 拾取物：磁鐵（吸引地圖上所有經驗值） ----------
  _genMagnetPickup() {
    const { tex, ctx } = this._canvas('pickup_magnet', 30, 30);
    // 外層光暈（電光藍紫色，跟血包的紅色區隔開）
    const glow = ctx.createRadialGradient(15, 15, 2, 15, 15, 15);
    glow.addColorStop(0, 'rgba(120,140,255,0.55)');
    glow.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 30, 30);
    // 馬蹄形磁鐵造型：紅藍雙色兩腳 + 銀灰色橋身
    ctx.save();
    ctx.translate(15, 16);
    // 銀灰橋身（磁鐵頂部弧形本體）
    ctx.fillStyle = '#c7ccd6';
    ctx.beginPath();
    ctx.arc(0, -1, 8, Math.PI, 0, false);
    ctx.lineTo(8, 9);
    ctx.lineTo(4.5, 9);
    ctx.lineTo(4.5, -1);
    ctx.arc(0, -1, 4.5, 0, Math.PI, true);
    ctx.lineTo(-4.5, 9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6b7080';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 左腳（紅色磁極）
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(-8, 9, 3.5, 6);
    // 右腳（藍色磁極）
    ctx.fillStyle = '#4d7cff';
    ctx.fillRect(4.5, 9, 3.5, 6);
    // 磁極端頭高光
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(-8, 9, 3.5, 1.4);
    ctx.fillRect(4.5, 9, 3.5, 1.4);
    ctx.restore();
    this._finish(tex);
  }

  // ---------- 活動獎勵球（紅球=神話自選／金球=傳說自選）：128x128 跟正式裝備圖示
  // 同尺寸，才能塞進背包格不會忽大忽小。還沒有正式美術圖，先用 Canvas 畫一顆
  // 立體感光澤球＋問號（自選/未開啟的意象），之後有正式圖再依 CLAUDE.md 的慣例
  // 換成 BootScene.preload() 載入即可。----------
  generateLootBalls() {
    const mkBall = (key, rgbMain, rgbDark, rgbShine) => {
      const { tex, ctx } = this._canvas(key, 128, 128);
      const cx = 64, cy = 64, r = 50;
      const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.4);
      glow.addColorStop(0, `rgba(${rgbMain},0.5)`);
      glow.addColorStop(1, `rgba(${rgbMain},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 128, 128);

      const body = ctx.createRadialGradient(cx - 16, cy - 18, 6, cx, cy, r);
      body.addColorStop(0, `rgb(${rgbShine})`);
      body.addColorStop(0.45, `rgb(${rgbMain})`);
      body.addColorStop(1, `rgb(${rgbDark})`);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgb(${rgbDark})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(cx - 18, cy - 20, 12, 8, -0.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 46px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy + 3);
      this._finish(tex);
    };
    mkBall('ball_mythic', '255,60,60', '150,20,20', '255,190,190');
    mkBall('ball_legendary', '255,185,55', '170,110,10', '255,238,190');
  }

  // ---------- UI 元件 (血條框、經驗條框、按鈕背景) ----------
  generateUI() {
    const mk = (key, w, h, draw) => {
      const { tex, ctx } = this._canvas(key, w, h);
      draw(ctx);
      this._finish(tex);
    };
    mk('ui_bar_bg', 200, 16, (ctx) => {
      ctx.fillStyle = '#20232c';
      TextureFactory.roundRect(ctx, 0, 0, 200, 16, 6);
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.stroke();
    });
    // 羊皮紙風格按鈕：給主選單用，搭配風景封面圖背景，米色底＋咖啡色邊框，
    // 深色文字疊在上面隨時都看得清楚（不像 ui_bar_bg 深色底配深色文字，
    // 沒 hover 之前幾乎看不到字）
    mk('ui_button_parchment', 200, 60, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 0, 60);
      grad.addColorStop(0, '#f0e2bd');
      grad.addColorStop(1, '#dcc999');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 200, 60, 14);
      ctx.fill();
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = 4;
      TextureFactory.roundRect(ctx, 2, 2, 196, 56, 14);
      ctx.stroke();
    });
    mk('ui_bar_fill_hp', 200, 16, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 200, 0);
      grad.addColorStop(0, '#ff4d4d');
      grad.addColorStop(1, '#ff8a5b');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 200, 16, 6);
      ctx.fill();
    });
    mk('ui_bar_fill_xp', 200, 10, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 200, 0);
      grad.addColorStop(0, '#6fd3ff');
      grad.addColorStop(1, '#8fffd0');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 200, 10, 4);
      ctx.fill();
    });
    mk('ui_bar_fill_boss', 300, 18, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 300, 0);
      grad.addColorStop(0, '#c72d3d');
      grad.addColorStop(1, '#ff5b5b');
      ctx.fillStyle = grad;
      TextureFactory.roundRect(ctx, 0, 0, 300, 18, 6);
      ctx.fill();
    });
    mk('ui_panel', 260, 140, (ctx) => {
      ctx.fillStyle = 'rgba(20,22,32,0.9)';
      TextureFactory.roundRect(ctx, 0, 0, 260, 140, 10);
      ctx.fill();
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    mk('ui_card', 190, 240, (ctx) => {
      ctx.fillStyle = 'rgba(30,34,48,0.95)';
      TextureFactory.roundRect(ctx, 0, 0, 190, 240, 12);
      ctx.fill();
      ctx.strokeStyle = '#6fd3ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    // 底部狀態列（數值/裝備/技能）用的長條卡片底板：把「圖示+文字」框成一張
    // 獨立卡片，取代原本整塊面板裡沒有分隔、字浮在大片空白上的排版方式。
    mk('ui_stat_chip', 300, 60, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      TextureFactory.roundRect(ctx, 0, 0, 300, 60, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      TextureFactory.roundRect(ctx, 1, 1, 298, 58, 12);
      ctx.stroke();
    });
    // 背包格子：空格用的方形底板，5x10 格子共用同一張材質
    mk('ui_slot', 72, 72, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      TextureFactory.roundRect(ctx, 0, 0, 72, 72, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(111,211,255,0.5)';
      ctx.lineWidth = 2;
      TextureFactory.roundRect(ctx, 1, 1, 70, 70, 8);
      ctx.stroke();
    });
    // 裝備欄位（角色左側 5 個欄位）用的底板，比背包格子大一點、顏色也不同，
    // 方便玩家一眼分辨「這是身上穿的」跟「這是包包裡的」
    mk('ui_equip_slot', 96, 96, (ctx) => {
      ctx.fillStyle = 'rgba(255,224,102,0.08)';
      TextureFactory.roundRect(ctx, 0, 0, 96, 96, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,224,102,0.65)';
      ctx.lineWidth = 3;
      TextureFactory.roundRect(ctx, 1.5, 1.5, 93, 93, 10);
      ctx.stroke();
    });
    // 畫面邊緣提示箭頭：純白三角形，遊戲內用 setTint() 分別染成血包（紅）跟磁鐵（藍紫）的顏色
    mk('ui_arrow', 40, 40, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(36, 20);
      ctx.lineTo(6, 4);
      ctx.lineTo(14, 20);
      ctx.lineTo(6, 36);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,20,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }


  // 商店抽獎機用的「日式扭蛋機」圖示：紅色底座＋透明玻璃圓頂，裡面裝著幾顆彩色扭蛋，
  // 側邊一根轉柄，風格跟其他 UI/裝備圖示一樣走「粗描邊＋鮮豔色塊」的可愛路線。
  generateGachaMachine() {
    const w = 220, h = 260;
    const { tex, ctx } = this._canvas('gacha_machine', w, h);
    const cx = w / 2;

    // 底座
    ctx.fillStyle = '#e63950';
    TextureFactory.roundRect(ctx, cx - 70, 190, 140, 50, 10);
    ctx.fill();
    ctx.strokeStyle = '#a01f30';
    ctx.lineWidth = 3;
    TextureFactory.roundRect(ctx, cx - 70, 190, 140, 50, 10);
    ctx.stroke();
    // 投幣孔
    ctx.fillStyle = '#3a1015';
    TextureFactory.roundRect(ctx, cx - 10, 205, 20, 10, 3);
    ctx.fill();
    // 轉柄
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(cx + 78, 218, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a3780a';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 出球口
    ctx.fillStyle = '#3a1015';
    TextureFactory.roundRect(ctx, cx - 22, 168, 44, 22, 6);
    ctx.fill();

    // 玻璃圓頂
    ctx.fillStyle = 'rgba(191,230,255,0.35)';
    ctx.beginPath();
    ctx.arc(cx, 110, 88, Math.PI, 0, false);
    ctx.lineTo(cx + 88, 176);
    ctx.lineTo(cx - 88, 176);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6fd3ff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 圓頂裡的扭蛋（每顆兩色：上半亮、下半深，模擬扭蛋殼的分色）
    const capsules = [
      { x: cx - 40, y: 130, r: 17, c: '#ff6bd6' },
      { x: cx + 4, y: 150, r: 20, c: '#6fd3ff' },
      { x: cx + 46, y: 122, r: 16, c: '#ffe066' },
      { x: cx - 8, y: 100, r: 15, c: '#7dff8f' },
      { x: cx - 46, y: 90, r: 13, c: '#ff9d3d' },
      { x: cx + 34, y: 90, r: 13, c: '#c58fff' },
    ];
    capsules.forEach((b) => {
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, Math.PI, 0, false);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI, false);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 玻璃反光
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, 110, 78, Math.PI * 1.15, Math.PI * 1.5, false);
    ctx.stroke();

    this._finish(tex);
  }
}
