import Phaser from "phaser";
import { conversionGuide } from "../model/breakpoints";
import { simulate } from "../model/simulate";
import type { BucketKey, SimResult } from "../model/types";
import { moneyShort } from "../util/money";
import { BUCKET_STYLE, NEON } from "./palette";
import { LiveSim, type PourPlan } from "./liveSim";
import { demoProfile } from "./sim";
import { SFX, unlockAudio } from "./zzfx";

const W = 1280;
const H = 720;
const TANK_TOP = 150;
const TANK_H = 300;
const GAP = 28;
const TANK_W = (W - 48 - GAP * (BUCKET_STYLE.length - 1)) / BUCKET_STYLE.length;
const STRIP_Y = 610;
const STRIP_H = 80;
const FIRE_X = 400;
const FIRE_Y = 548;

type Phase = "burning" | "interlude" | "gameover";

export class MainScene extends Phaser.Scene {
  private live!: LiveSim;
  private forecast!: SimResult;
  private forecastStartAge = 0;
  private phase: Phase = "interlude";
  private fireSize0 = 1;
  private gfx!: Phaser.GameObjects.Graphics;
  private strip!: Phaser.GameObjects.Graphics;
  private stripDirty = true;
  private hudAge!: Phaser.GameObjects.Text;
  private hudWealth!: Phaser.GameObjects.Text;
  private hudTax!: Phaser.GameObjects.Text;
  private fireLabel!: Phaser.GameObjects.Text;
  private pourButtons: { plan: PourPlan; text: Phaser.GameObjects.Text }[] = [];
  private vaultButton?: Phaser.GameObjects.Text;
  private sam!: Phaser.GameObjects.Container;
  private samSpeech!: Phaser.GameObjects.Text;
  private samShare = 0.22;
  private tankMax: Record<string, number> = {};
  private textCache: Record<string, Phaser.GameObjects.Text> = {};

  constructor() {
    super("main");
  }

  create() {
    this.cameras.main.setBackgroundColor(NEON.bg);
    this.buildBackdrop();
    this.gfx = this.add.graphics();
    this.strip = this.add.graphics();
    this.buildHud();
    this.buildSam();
    this.buildTankZones();
    this.startRun();
    this.input.once("pointerdown", () => unlockAudio());
  }

  private interludeUntil = 0;

  private startRun() {
    this.live = new LiveSim(demoProfile());
    this.live.pourPlan = "off";
    this.refreshForecast();
    this.stylePourButtons();
    this.setInterlude(400);
  }

  /** Wall-clock interludes: robust even when the tab's animation frames are throttled. */
  private setInterlude(ms: number) {
    this.phase = "interlude";
    this.interludeUntil = performance.now() + ms;
  }

  private refreshForecast() {
    const profile = {
      ...this.live.profile,
      planStartAge: Math.floor(this.live.age),
      balances: { ...this.live.balances },
      conversion:
        this.live.pourPlan === "off"
          ? { ...this.live.profile.conversion, mode: "none" as const }
          : {
              mode: "bracketFill" as const,
              fixedAmount: 0,
              bracketCeiling: this.live.pourPlan === "fill12" ? 0.12 : 0.22,
              startAge: Math.floor(this.live.age),
              endAge: 74,
              taxSource: this.live.profile.conversion.taxSource,
            },
    };
    this.forecast = simulate(profile);
    this.forecastStartAge = profile.planStartAge;
    for (const style of BUCKET_STYLE) {
      const key = style.key as BucketKey;
      this.tankMax[key] = Math.max(
        this.live.balances[key],
        ...this.forecast.rows.map((row) => row.balances[key]),
        1,
      );
    }
    this.samShare = Math.min(0.4, conversionGuide(profile).tLaterEffective);
    this.stripDirty = true;
  }

  private nextYear() {
    if (this.live.gameOver) return this.endRun();
    const start = this.live.beginYear();
    this.fireSize0 = Math.max(1, start.fireSize);
    if (start.rainDoused > 500) {
      this.floater(FIRE_X, FIRE_Y - 60, `☂ rain doused ${moneyShort(start.rainDoused)}`, "#4aa8ff");
    }
    if (start.rmdForced && start.rmdForced.gross > 500) {
      SFX.alarm();
      this.samSay("Alarm clock! I pour for you now.");
      this.floater(FIRE_X, FIRE_Y - 84, `⏰ forced ${moneyShort(start.rmdForced.gross)} from IOU`, "#ff9e5e");
    }
    if (this.live.fireRemaining <= 1) {
      this.finishYear();
    } else {
      this.phase = "burning";
      SFX.boom();
    }
  }

  private finishYear() {
    const end = this.live.endYear();
    if (end.poured > 500) {
      SFX.pour();
      SFX.coin();
      this.samSay(
        end.tollFromVault > 500
          ? end.tollFromVault >= end.pourToll - 1
            ? `poured ${moneyShort(end.poured)} → Freedom. Vault paid my ${moneyShort(end.pourToll)} toll.`
            : `poured ${moneyShort(end.poured)} → Freedom. Vault chipped in ${moneyShort(end.tollFromVault)}; I skimmed the rest.`
          : `poured ${moneyShort(end.poured)} → Freedom. Toll ${moneyShort(end.pourToll)}.`,
      );
    }
    if (this.live.gameOver) return this.endRun();
    this.refreshForecast();
    this.setInterlude(650);
    if (this.live.age > this.live.profile.horizonAge - 1) {
      this.phase = "gameover";
      this.victory();
    }
  }

  private endRun() {
    this.phase = "gameover";
    SFX.boom();
    this.bigBanner(`THE WELL RAN DRY AT AGE ${Math.round(this.live.age)}`, "#ff5470");
  }

  private victory() {
    SFX.cornerShot();
    this.bigBanner(
      `MADE IT TO ${this.live.profile.horizonAge}!  KEPT ${moneyShort(this.live.householdTotal())} · PAID SAM ${moneyShort(this.live.totalTax)}`,
      "#2bff9e",
    );
  }

  private bigBanner(message: string, color: string) {
    const banner = this.add
      .text(W / 2, 330, `${message}\nTAP TO PLAY AGAIN`, {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "34px",
        fontStyle: "900",
        color,
        align: "center",
        backgroundColor: "#0d0e1acc",
        padding: { x: 30, y: 20 },
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setInteractive({ useHandCursor: true });
    banner.once("pointerdown", () => {
      banner.destroy();
      this.startRun();
    });
  }

  /* ---------------- input ---------------- */

  private buildTankZones() {
    BUCKET_STYLE.forEach((style, index) => {
      const key = style.key as BucketKey;
      if (key === "kids" || key === "trump") return; // rain, not hoses
      const x = 24 + index * (TANK_W + GAP);
      const zone = this.add.zone(x, TANK_TOP, TANK_W, TANK_H).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => this.tapTank(key, x));
    });
  }

  private tapTank(key: BucketKey, x: number) {
    unlockAudio();
    if (this.phase !== "burning") return;
    const chunk = Math.max(10_000, Math.ceil(this.fireSize0 / 5 / 1000) * 1000);
    const result = this.live.squirt(key, Math.min(chunk, this.live.available(key)));
    if (result.gross <= 0) {
      SFX.tick();
      this.floater(x + TANK_W / 2, TANK_TOP + 40, "empty!", "#5a6b8c");
      return;
    }
    SFX.pour();
    this.floater(x + TANK_W / 2, TANK_TOP + 30, `-${moneyShort(result.gross)}`, "#e8f6ff");
    this.floater(FIRE_X, FIRE_Y - 60, `💧 doused ${moneyShort(result.doused)}`, "#4aa8ff");
    if (result.samTook > 200) {
      SFX.coin();
      this.floater(200, 500, `Sam +${moneyShort(result.samTook)}`, "#ff9e5e");
      this.samSay("Much obliged!");
    }
    if (result.bouncerTook > 200) {
      SFX.alarm();
      this.floater(x + TANK_W / 2, TANK_TOP + 70, `🚪 bouncer +${moneyShort(result.bouncerTook)} (under 59½)`, "#ff5470");
    }
    if (key === "roth") this.samSay("Spending the Freedom Tank?! Bold.");
    if (this.live.fireRemaining <= 1) {
      SFX.chime();
      this.floater(FIRE_X, FIRE_Y - 40, "🔥 OUT!", "#2bff9e");
      this.finishYear();
    } else if (this.live.everythingEmpty()) {
      this.live.gameOver = true;
      this.endRun();
    }
  }

  private floater(x: number, y: number, message: string, color: string) {
    const text = this.add
      .text(x, y, message, {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "16px",
        fontStyle: "800",
        color,
      })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({
      targets: text,
      y: y - 46,
      alpha: 0,
      duration: 1100,
      ease: "Cubic.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /* ---------------- chrome ---------------- */

  private buildBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, NEON.grid, 0.6);
    for (let x = 0; x <= W; x += 64) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 64) grid.lineBetween(0, y, W, y);
    this.add
      .text(24, 18, "BUCKET RUSH", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "30px", fontStyle: "900", color: "#e8f6ff" })
      .setShadow(0, 0, "#4aa8ff", 18, true, true);
    this.add.text(26, 52, "a fire of bills ignites every year — choose which tank puts it out", {
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: "13px",
      color: "#5a6b8c",
    });
  }

  private buildHud() {
    this.hudAge = this.add
      .text(W / 2, 26, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "26px", fontStyle: "800", color: "#e8f6ff" })
      .setOrigin(0.5, 0);
    this.hudWealth = this.add
      .text(W - 24, 22, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "19px", fontStyle: "700", color: "#2bff9e" })
      .setOrigin(1, 0);
    this.hudTax = this.add
      .text(W - 24, 48, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "14px", fontStyle: "700", color: "#ff9e5e" })
      .setOrigin(1, 0);
    this.fireLabel = this.add
      .text(FIRE_X, FIRE_Y + 22, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "17px", fontStyle: "900", color: "#ff5470" })
      .setOrigin(0.5, 0);

    this.add.text(560, 508, "SAM'S TOLL BRIDGE — year-end pour IOU → FREEDOM at:", {
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: "12px",
      fontStyle: "700",
      color: "#5a6b8c",
    });
    ([
      ["off", "NO POURS"],
      ["fill12", "FILL 12¢ BIN"],
      ["fill22", "FILL 22¢ BIN"],
    ] as [PourPlan, string][]).forEach(([plan, label], index) => {
      const text = this.add
        .text(620 + index * 160, 548, label, {
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: "14px",
          fontStyle: "800",
          color: "#e8f6ff",
          backgroundColor: "#0d0e1a",
          padding: { x: 12, y: 7 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      text.on("pointerdown", () => {
        unlockAudio();
        this.live.pourPlan = plan;
        this.refreshForecast();
        this.stylePourButtons();
        if (plan !== "off") SFX.pour();
        this.samSay(plan === "off" ? "Take your time!" : "Pleasure doing business!");
      });
      this.pourButtons.push({ plan, text });
    });
    this.stylePourButtons();

    // vault-pays-toll toggle: Offshore Vault covers Sam's toll (above its
    // floor) so the whole pour reaches Freedom instead of Sam skimming it
    this.vaultButton = this.add
      .text(1120, 548, "VAULT PAYS TOLL", {
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "14px",
        fontStyle: "800",
        color: "#e8f6ff",
        backgroundColor: "#0d0e1a",
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.vaultButton.on("pointerdown", () => {
      unlockAudio();
      const on = this.live.profile.conversion.taxSource !== "taxableThenSpouse";
      this.live.profile = {
        ...this.live.profile,
        conversion: { ...this.live.profile.conversion, taxSource: on ? "taxableThenSpouse" : "taxable" },
      };
      this.refreshForecast();
      this.stylePourButtons();
      this.samSay(on ? "The Vault pays my toll? Full pours it is." : "Back to skimming your pours!");
    });
  }

  private stylePourButtons() {
    for (const { plan, text } of this.pourButtons) {
      const active = this.live?.pourPlan === plan;
      text.setColor(active ? "#07070f" : "#e8f6ff");
      text.setBackgroundColor(active ? "#2bff9e" : "#0d0e1a");
    }
    if (this.vaultButton) {
      const on = this.live?.profile.conversion.taxSource === "taxableThenSpouse";
      this.vaultButton.setColor(on ? "#07070f" : "#e8f6ff");
      this.vaultButton.setBackgroundColor(on ? "#2bff9e" : "#0d0e1a");
    }
  }

  private buildSam() {
    const g = this.add.graphics();
    g.lineStyle(2.5, NEON.sam, 1);
    g.strokeCircle(0, 0, 18);
    g.strokeRect(-14, -34, 28, 10);
    g.strokeRect(-9, -46, 18, 12);
    g.lineBetween(0, 18, 0, 52);
    g.lineBetween(0, 30, -18, 44);
    g.lineBetween(0, 30, 20, 40);
    g.lineBetween(0, 52, -12, 78);
    g.lineBetween(0, 52, 12, 78);
    g.strokeRect(14, 36, 22, 16);
    const smile = this.add.graphics();
    smile.lineStyle(2, NEON.sam, 1);
    smile.beginPath();
    smile.arc(0, 4, 8, 0.2, Math.PI - 0.2);
    smile.strokePath();
    this.samSpeech = this.add
      .text(45, -35, "", { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "15px", fontStyle: "700", color: "#ff9e5e" })
      .setOrigin(0, 1);
    this.sam = this.add.container(110, 540, [g, smile, this.samSpeech]).setScale(0.85);
  }

  private samSay(line: string) {
    this.samSpeech.setText(line);
    this.tweens.add({ targets: this.sam, y: 532, yoyo: true, duration: 120, repeat: 1 });
    this.time.delayedCall(1700, () => this.samSpeech.setText(""));
  }

  /* ---------------- render ---------------- */

  update() {
    if (this.phase === "interlude" && performance.now() >= this.interludeUntil) {
      this.nextYear();
    }
    this.drawTanksAndFire();
    if (this.stripDirty) this.drawStrip();
    this.hudAge.setText(`AGE ${Math.floor(this.live.age)}   ·   ${this.live.calendarYear}`);
    this.hudWealth.setText(`HOUSEHOLD ${moneyShort(this.live.householdTotal())}`);
    this.hudTax.setText(`paid Sam so far: ${moneyShort(this.live.totalTax)}`);
    this.fireLabel.setText(
      this.phase === "burning" ? `EXPENSE FIRE  ${moneyShort(this.live.fireRemaining)} — tap a tank!` : "",
    );
  }

  private drawTanksAndFire() {
    const g = this.gfx;
    g.clear();

    BUCKET_STYLE.forEach((style, index) => {
      const x = 24 + index * (TANK_W + GAP);
      const key = style.key as BucketKey;
      const level = this.live.balances[key];
      const fraction = Math.max(0, Math.min(1, level / this.tankMax[key]));
      const waterH = fraction * (TANK_H - 8);
      const waterY = TANK_TOP + TANK_H - 4 - waterH;

      g.fillStyle(style.color, 0.32);
      g.fillRoundedRect(x + 4, waterY, TANK_W - 8, waterH, 6);
      g.fillStyle(style.color, 0.9);
      g.fillRect(x + 4, waterY, TANK_W - 8, Math.min(3, waterH));
      if (key === "traditional" && waterH > 4) {
        g.fillStyle(0x000000, 0.45);
        g.fillRoundedRect(x + 4, waterY, TANK_W - 8, waterH * this.samShare, 6);
      }
      const tappable = this.phase === "burning" && this.live.available(key) > 0 && key !== "kids" && key !== "trump";
      const pulse = tappable ? 0.75 + 0.25 * Math.sin(this.time.now / 180) : 0.95;
      g.lineStyle(tappable ? 3 : 2, style.color, pulse);
      g.strokeRoundedRect(x, TANK_TOP, TANK_W, TANK_H, 10);

      this.labelOnce(`label-${key}`, x + TANK_W / 2, TANK_TOP - 34, style.label, style.color);
      this.labelOnce(`note-${key}`, x + TANK_W / 2, TANK_TOP - 16, style.note, 0x5a6b8c, "11px");
      this.valueLabel(`value-${key}`, x + TANK_W / 2, TANK_TOP + TANK_H + 8, moneyShort(level));
    });

    // the fire
    if (this.phase === "burning") {
      const intensity = Math.max(0.15, this.live.fireRemaining / this.fireSize0);
      const flames = 5;
      for (let i = 0; i < flames; i += 1) {
        const fx = FIRE_X - 44 + i * 22;
        const wobble = Math.sin(this.time.now / 90 + i * 1.7) * 6;
        const height = (26 + 34 * intensity) * (0.7 + 0.3 * Math.sin(this.time.now / 140 + i));
        g.fillStyle(i % 2 ? NEON.tax : 0xffa245, 0.85);
        g.fillTriangle(fx - 9, FIRE_Y + 14, fx + 9, FIRE_Y + 14, fx + wobble, FIRE_Y + 14 - height);
      }
      g.lineStyle(2, NEON.tax, 0.9);
      g.strokeRoundedRect(FIRE_X - 62, FIRE_Y + 12, 124, 8, 3);
    }
  }

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
        .text(x, y, value, { fontFamily: "Helvetica, Arial, sans-serif", fontSize: "18px", fontStyle: "700", color: "#e8f6ff" })
        .setOrigin(0.5, 0);
    }
    this.textCache[id].setText(value);
  }

  private drawStrip() {
    this.stripDirty = false;
    const g = this.strip;
    g.clear();
    g.fillStyle(NEON.panel, 1);
    g.fillRoundedRect(24, STRIP_Y - 12, W - 48, STRIP_H + 24, 10);
    this.labelOnce(
      "strip-title",
      W / 2,
      STRIP_Y - 32,
      "THE TIME RIVER — autopilot forecast from today, re-drawn when you change the pour plan",
      0x5a6b8c,
      "12px",
    );
    const rows = this.forecast.rows;
    const maxTotal = Math.max(...rows.map((row) => Object.values(row.balances).reduce((sum, v) => sum + v, 0)), 1);
    const barW = (W - 64) / Math.max(rows.length, 1);
    rows.forEach((row, index) => {
      const total = Object.values(row.balances).reduce((sum, v) => sum + v, 0);
      const height = Math.max(2, (total / maxTotal) * STRIP_H);
      const dead = row.shortfall > 1;
      g.fillStyle(dead ? NEON.tax : NEON.traditional, dead ? 0.9 : 0.55);
      g.fillRect(32 + index * barW, STRIP_Y + STRIP_H - height, Math.max(1.5, barW - 1.5), height);
      if (row.conversion > 500) {
        g.fillStyle(NEON.roth, 0.9);
        g.fillRect(32 + index * barW, STRIP_Y + STRIP_H + 3, Math.max(1.5, barW - 1.5), 4);
      }
    });
    this.labelOnce("strip-age0", 32, STRIP_Y + STRIP_H + 9, "", 0x5a6b8c, "10px");
    this.textCache["strip-age0"].setText(`age ${this.forecastStartAge}`);
  }
}
