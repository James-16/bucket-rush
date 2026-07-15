import Phaser from "phaser";
import { MainScene } from "./game/MainScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#07070f",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
});

// debug/playtest hook — lets automated tests read live game state
(window as unknown as { bucketRush: Phaser.Game }).bucketRush = game;
