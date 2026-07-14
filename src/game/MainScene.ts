import Phaser from "phaser";
import { conversionGuide } from "../model/breakpoints";
import type { BucketKey } from "../model/types";
import { moneyShort } from "../util/money";
import { BUCKET_STYLE, NEON } from "./palette";
import { GameSim, type PourPlan } from "./sim";
import { SFX, unlockAudio } from "./zzfx";

const W = 1280;
const H = 720;
const TANK_TOP = 150;
const TANK_H = 320;
const STRIP_Y = 600;
const STRIP_H = 90;

export class MainScene extends Phaser.Scene {
  private sim = new GameSim();
  private tanks!: Phaser.GameObjects.Graphics;
  private strip!: Phaser.GameObjects.Graphics;
  private stripDirty = true;
  private hudAge!: Phaser.GameObjects.Text;
  private hudWealth!: Phaser.GameObjects.Text;
  private playButton!: Phaser.GameObjects.Text;
  private pourButtons: { plan: PourPlan; text: Phaser.GameObjects.Text }[] = [];
  private sam!: Phaser.GameObjects.Container;
  private samSpeech!: Phaser.GameObjects.Text;
  private tankMax: Record<string, number> = {};
  private samShare = 0.22;
  private lastCoinAt = 0;

  constructor() {
    super("main");
  }

  create() {
    this.cameras.main.setBackgroundColor(NEON.bg);
    this.buildBackdrop();
    this.tanks = this.add.graphics();
    this.strip = this.add.graphics();
    this.buildHud();
    this.buildSam();
    this.refreshDerived();

    this.input.once("pointerdown", () => unlockAudio());
    this.input.keyboard?.on("keydown-SPACE", () => this.togglePlay());
  }

  private buildBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, NEON.grid, 0.6);
    for (let x = 0; x <= W; x += 64) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 64) grid.lineBetween(0, y, W, y);

    this.add
      .text(24, 18, "BUCKET RUSH", {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "30px",
        fontStyle: "900",
        color: "#e8f6ff",
      })
      .setShadow(0, 0, "#4aa8ff", 18, true, true);
    this.add.text(26, 52, "outsmart the taxman · every drop is honest math", {
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: "13px",
      color: "#5a6b8c",
    });
  }

  private buildHud() {
    this.hudAge = this.add
      .text(W / 2, 30, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "26px", fontStyle: "800", color: "#e8f6ff" })
      .setOrigin(0.5, 0);
    this.hudWealth = this.add
      .text(W - 24, 24, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "20px", fontStyle: "700", color: "#2bff9e" })
      .setOrigin(1, 0);

    this.playButton = this.makeButton(W / 2, 78, "▶ PLAY  (space)", () => this.togglePlay());

    // Sam's Toll Bridge controls live between the tanks and the Time River,
    // right next to Sam himself.
    this.add.text(200, 522, "SAM'S TOLL BRIDGE — pour IOU → FREEDOM at:", {
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: "13px",
      fontStyle: "700",
      color: "#5a6b8c",
    });
    (
      [
        ["off", "NO POURS"],
        ["fill12", "FILL 12¢ BIN"],
        ["fill22", "FILL 22¢ BIN"],
      ] as [PourPlan, string][]
    ).forEach(([plan, label], index) => {
      const text = this.makeButton(620 + index * 160, 530, label, () => this.setPour(plan), "14px");
      this.pourButtons.push({ plan, text });
    });
    this.stylePourButtons();
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void, size = "18px") {
    const text = this.add
      .text(x, y, label, {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: size,
        fontStyle: "800",
        color: "#e8f6ff",
        backgroundColor: "#0d0e1a",
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    text.on("pointerdown", () => {
      unlockAudio();
      onClick();
    });
    text.on("pointerover", () => text.setColor("#2bff9e"));
    text.on("pointerout", () => this.stylePourButtons());
    return text;
  }

  private buildSam() {
    const g = this.add.graphics();
    g.lineStyle(2.5, NEON.sam, 1);
    g.strokeCircle(0, 0, 18); // head
    g.strokeRect(-14, -34, 28, 10); // hat brim? flat bureaucrat hat
    g.strokeRect(-9, -46, 18, 12);
    g.lineBetween(0, 18, 0, 52); // body
    g.lineBetween(0, 30, -18, 44);
    g.lineBetween(0, 30, 20, 40); // waving arm
    g.lineBetween(0, 52, -12, 78);
    g.lineBetween(0, 52, 12, 78);
    g.strokeRect(14, 36, 22, 16); // briefcase
    const smile = this.add.graphics();
    smile.lineStyle(2, NEON.sam, 1);
    smile.beginPath();
    smile.arc(0, 4, 8, 0.2, Math.PI - 0.2);
    smile.strokePath();

    this.samSpeech = this.add
      .text(45, -35, "", {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "15px",
        fontStyle: "700",
        color: "#ff9e5e",
      })
      .setOrigin(0, 1);

    this.sam = this.add.container(110, 540, [g, smile, this.samSpeech]).setScale(0.85);
  }

  private togglePlay() {
    if (this.sim.clock >= this.sim.rows.length - 1e-3) this.sim.restart();
    this.sim.playing = !this.sim.playing;
    this.playButton.setText(this.sim.playing ? "❚❚ PAUSE  (space)" : "▶ PLAY  (space)");
    if (this.sim.playing) SFX.chime();
  }

  private setPour(plan: PourPlan) {
    this.sim.setPourPlan(plan);
    this.refreshDerived();
    this.stripDirty = true;
    this.stylePourButtons();
    if (plan !== "off") SFX.pour();
    this.samSay(plan === "off" ? "Take your time!" : "Pleasure doing business!");
  }

  private stylePourButtons() {
    for (const { plan, text } of this.pourButtons) {
      const active = this.sim.pourPlan === plan;
      text.setColor(active ? "#07070f" : "#e8f6ff");
      text.setBackgroundColor(active ? "#2bff9e" : "#0d0e1a");
    }
  }

  private refreshDerived() {
    // per-tank scale = its own max across the whole run, so motion is visible
    for (const style of BUCKET_STYLE) {
      const key = style.key as BucketKey;
      this.tankMax[key] = Math.max(
        this.sim.profile.balances[key],
        ...this.sim.rows.map((row) => row.balances[key]),
        1,
      );
    }
    this.samShare = Math.min(0.4, conversionGuide(this.sim.profile).tLaterEffective);
  }

  private samSay(line: string) {
    this.samSpeech.setText(line);
    this.tweens.add({ targets: this.sam, y: 532, yoyo: true, duration: 120, repeat: 1 });
    this.time.delayedCall(1600, () => this.samSpeech.setText(""));
  }

  update(_time: number, deltaMs: number) {
    const { crossedYear } = this.sim.tick(deltaMs / 1000);
    if (crossedYear) {
      SFX.tick();
      const row = this.sim.currentRow;
      if (row.conversion > 500 && _time - this.lastCoinAt > 220) {
        SFX.coin();
        this.lastCoinAt = _time;
        this.samSay(`toll ${moneyShort(row.tax)} — enjoy the Freedom Tank!`);
      } else if (row.rmd > 500) {
        SFX.alarm();
        this.samSay("Alarm clock! I pour for you now.");
      }
      if (row.shortfall > 1) {
        SFX.boom();
        this.samSay("…the well is dry, friend.");
      }
    }

    this.drawTanks();
    if (this.stripDirty || this.sim.playing) this.drawStrip();

    this.hudAge.setText(
      `AGE ${this.sim.currentAge.toFixed(1)}   ·   ${this.sim.currentRow.calendarYear}`,
    );
    this.hudWealth.setText(`HOUSEHOLD ${moneyShort(this.sim.householdTotal())}`);
  }

  private drawTanks() {
    const g = this.tanks;
    g.clear();
    const gap = 28;
    const tankW = (W - 48 - gap * (BUCKET_STYLE.length - 1)) / BUCKET_STYLE.length;

    BUCKET_STYLE.forEach((style, index) => {
      const x = 24 + index * (tankW + gap);
      const key = style.key as BucketKey;
      const level = this.sim.levelOf(key);
      const fraction = Math.max(0, Math.min(1, level / this.tankMax[key]));
      const waterH = fraction * (TANK_H - 8);
      const waterY = TANK_TOP + TANK_H - 4 - waterH;

      // water
      g.fillStyle(style.color, 0.32);
      g.fillRoundedRect(x + 4, waterY, tankW - 8, waterH, 6);
      g.fillStyle(style.color, 0.9);
      g.fillRect(x + 4, waterY, tankW - 8, Math.min(3, waterH));

      // Sam's shadow slice inside the IOU tank — his share of every drop
      if (key === "traditional" && waterH > 4) {
        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(x + 4, waterY, tankW - 8, waterH * this.samShare, 6);
      }

      // shell
      g.lineStyle(2, style.color, 0.95);
      g.strokeRoundedRect(x, TANK_TOP, tankW, TANK_H, 10);

      this.labelOnce(`label-${key}`, x + tankW / 2, TANK_TOP - 34, style.label, style.color);
      this.valueLabel(`value-${key}`, x + tankW / 2, TANK_TOP + TANK_H + 10, moneyShort(level));
      this.labelOnce(`note-${key}`, x + tankW / 2, TANK_TOP - 16, style.note, 0x5a6b8c, "11px");
    });

    // pour stream: IOU → Freedom while conversions run
    if (this.sim.playing && this.sim.currentRow.conversion > 500) {
      const from = 24 + 0 * (tankW + gap) + tankW;
      const to = 24 + 1 * (tankW + gap);
      const y = TANK_TOP + 40;
      g.lineStyle(3, NEON.roth, 0.8);
      for (let i = 0; i < 5; i += 1) {
        const t = ((this.time.now / 120 + i * 20) % 100) / 100;
        const px = from + (to - from) * t;
        g.fillStyle(NEON.roth, 1 - t * 0.5);
        g.fillCircle(px, y + Math.sin(t * Math.PI) * -18, 4);
      }
    }
  }

  private textCache: Record<string, Phaser.GameObjects.Text> = {};

  private labelOnce(id: string, x: number, y: number, label: string, color: number, size = "14px") {
    if (!this.textCache[id]) {
      this.textCache[id] = this.add
        .text(x, y, label, {
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: size,
          fontStyle: "800",
          color: `#${color.toString(16).padStart(6, "0")}`,
        })
        .setOrigin(0.5, 0);
    }
  }

  private valueLabel(id: string, x: number, y: number, value: string) {
    if (!this.textCache[id]) {
      this.textCache[id] = this.add
        .text(x, y, value, {
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: "18px",
          fontStyle: "700",
          color: "#e8f6ff",
        })
        .setOrigin(0.5, 0);
    }
    this.textCache[id].setText(value);
  }

  /** Prototype Time River: one bar per future year, honest and live. */
  private drawStrip() {
    this.stripDirty = false;
    const g = this.strip;
    g.clear();
    g.fillStyle(NEON.panel, 1);
    g.fillRoundedRect(24, STRIP_Y - 14, W - 48, STRIP_H + 28, 10);
    this.labelOnce("strip-title", W / 2, STRIP_Y - 36, "THE TIME RIVER — your future, re-drawn every time you change your mind", 0x5a6b8c, "12px");

    const rows = this.sim.rows;
    const maxTotal = Math.max(
      ...rows.map((row) => Object.values(row.balances).reduce((sum, value) => sum + value, 0)),
      1,
    );
    const barW = (W - 64) / rows.length;

    rows.forEach((row, index) => {
      const total = Object.values(row.balances).reduce((sum, value) => sum + value, 0);
      const height = Math.max(2, (total / maxTotal) * STRIP_H);
      const dead = row.shortfall > 1;
      g.fillStyle(dead ? NEON.tax : NEON.traditional, dead ? 0.9 : 0.55);
      g.fillRect(32 + index * barW, STRIP_Y + STRIP_H - height, Math.max(1.5, barW - 1.5), height);
      if (row.conversion > 500) {
        g.fillStyle(NEON.roth, 0.9);
        g.fillRect(32 + index * barW, STRIP_Y + STRIP_H + 4, Math.max(1.5, barW - 1.5), 4);
      }
    });

    // now-marker
    const nowX = 32 + (this.sim.clock / rows.length) * (W - 64);
    g.lineStyle(2, NEON.ink, 0.9);
    g.lineBetween(nowX, STRIP_Y - 6, nowX, STRIP_Y + STRIP_H + 10);
  }
}
