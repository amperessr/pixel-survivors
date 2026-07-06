import TextureFactory from '../systems/TextureFactory.js';
import { textStyle } from '../utils/TextStyle.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

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
