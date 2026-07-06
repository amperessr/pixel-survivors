import TextureFactory from '../systems/TextureFactory.js';
import { textStyle } from '../utils/TextStyle.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    // 目前唯一的外部圖片素材：龍之翼遺物特效，直接用玩家提供的美術圖，
    // 不再用 Canvas 畫近似的形狀（畫出來的版本跟參考圖差太多，玩家反應過）。
    // 其餘所有材質都還是 TextureFactory 用程式產生，這張是特例。
    this.load.image('fx_dragon_wing_pair', 'assets/dragon_wing.png');
  }

  create() {
    const w = this.scale.width, h = this.scale.height;
    const label = this.add.text(w / 2, h / 2, '生成像素素材中...', textStyle({
      fontSize: '32px', color: '#6fd3ff',
    })).setOrigin(0.5);

    const factory = new TextureFactory(this);
    factory.generateAll();

    label.destroy();
    this.scene.start('MainMenuScene');
  }
}
