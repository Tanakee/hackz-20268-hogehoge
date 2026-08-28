import { RainRenderer } from "./RainRenderer.js";
import { PlayerAvatar } from "./PlayerAvatar.js";
import { HitEffect } from "./HitEffect.js";
import { SwatEffect } from "./SwatEffect.js";
import { HUD } from "./HUD.js";
import { TitleScreen } from "./TitleScreen.js";
import { StartScreen } from "./StartScreen.js";
import { ScorePanel } from "./ScorePanel.js";
import { WeatherWind } from "./WeatherWind.js";
import { ReplayScreen } from "./ReplayScreen.js";
import { ReplayFX } from "./ReplayFX.js";
import { SoundManager } from "./SoundManager.js";
import { ColliderIndicator } from "./ColliderIndicator.js";

/**
 * presentation 一式をまとめて生成する。Phase 3 の main.js から1回だけ呼ぶ想定。
 *
 * @param {THREE.Scene} scene
 * @param {object} ctx - { renderer, camera, game, rainPhysics, replayer, controllers }
 * @returns {{ update(dt:number):void, dispose():void }}
 */
export function createPresentation(scene, ctx) {
  const modules = [
    new RainRenderer(scene, ctx),
    new PlayerAvatar(scene, ctx),
    new HitEffect(scene, ctx),
    new SwatEffect(scene, ctx),
    new HUD(scene, ctx),
    new TitleScreen(scene, ctx),
    new StartScreen(scene, ctx),
    new ScorePanel(scene, ctx),
    new WeatherWind(scene, ctx),
    new ReplayScreen(scene, ctx),
    new ReplayFX(scene, ctx),
    new SoundManager(scene, ctx),
    new ColliderIndicator(scene, ctx)
  ];

  return {
    update(dt) {
      for (const m of modules) m.update?.(dt, ctx);
    },
    dispose() {
      for (const m of modules) m.dispose?.();
    }
  };
}
