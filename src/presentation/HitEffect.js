import * as THREE from "three";

const FLASH_DURATION = 0.35; // 秒
const MAX_OPACITY = 0.34;
const HAPTIC_INTENSITY = 0.8;
const HAPTIC_MS = 120;
const SWAT_HAPTIC_INTENSITY = 0.5;
const SWAT_HAPTIC_MS = 45;

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 被弾演出：視界全体の赤フラッシュ ＋ 左右両方のコントローラー振動。
 * `hit` イベント（PLAYING中）に加えて、REPLAY中は Replayer.frame.hits を見て
 * 記録された被弾のタイミングでも同じ演出を再生する（GAMEOVERの原因をリプレイで
 * 振り返れるようにするため）。当たった位置は使わない（GAMESPEC 5）。
 */
export class HitEffect {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this._flash = 0;
    this._lastReplayHitGameTime = null;

    const material = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
    this.mesh.position.set(0, 0, -0.2);
    this.mesh.renderOrder = 100000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.camera.add(this.mesh);

    this._offs = [
      ctx.game.on("hit", () => {
        this._flash = 1;
        this._pulse();
      }),
      // 雨を殴り飛ばしたとき：赤フラッシュは出さず、短く軽い振動だけ返す（当てた手応え）
      ctx.game.on("swat", () => this._pulse(SWAT_HAPTIC_INTENSITY, SWAT_HAPTIC_MS)),
      ctx.game.on("stateChange", (state) => {
        if (state === "REPLAY") this._lastReplayHitGameTime = null;
      })
    ];
  }

  _pulse(intensity = HAPTIC_INTENSITY, ms = HAPTIC_MS) {
    const session = this.renderer?.xr?.getSession?.();
    if (!session) return;
    for (const source of session.inputSources) {
      const actuator =
        source.gamepad?.hapticActuators && source.gamepad.hapticActuators[0];
      try {
        actuator?.pulse?.(intensity, ms);
      } catch (_) {
        /* ハプティクス非対応環境では無視 */
      }
    }
  }

  update(dt, ctx) {
    if (ctx?.game?.state === "REPLAY") {
      const frame = ctx.replayer?.frame;
      if (frame?.hits?.length && frame.gameTime !== this._lastReplayHitGameTime) {
        this._lastReplayHitGameTime = frame.gameTime;
        this._flash = 1;
        this._pulse();
      }
    }

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt / FLASH_DURATION);
    }
    const peak = REDUCED_MOTION ? MAX_OPACITY * 0.5 : MAX_OPACITY;
    this.mesh.material.opacity = this._flash * peak;
    this.mesh.visible = this._flash > 0;
  }

  dispose() {
    this._offs.forEach((off) => off && off());
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
