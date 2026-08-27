import { RainRenderer } from "./RainRenderer.js";
import { HitEffect } from "./HitEffect.js";
import { HUD } from "./HUD.js";
import { StartScreen } from "./StartScreen.js";
import { SoundManager } from "./SoundManager.js";

/**
 * presentation 一式をまとめて生成する。Phase 3 の main.js から1回だけ呼ぶ想定。
 *
 * @param {THREE.Scene} scene
 * @param {object} ctx - { renderer, camera, game, rainPhysics, replayer, controllers }
 * @returns {{ update(dt:number):void, dispose():void }}
 *
 * ※ PlayerAvatar / ReplayScreen は Phase 3 で追加してここに足す。
 */
export function createPresentation(scene, ctx) {
  const modules = [
    new RainRenderer(scene, ctx),
    new HitEffect(scene, ctx),
    new HUD(scene, ctx),
    new StartScreen(scene, ctx),
    new SoundManager(scene, ctx)
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
