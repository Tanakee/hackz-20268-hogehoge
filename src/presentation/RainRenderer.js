import * as THREE from "three";
import { RAIN_COUNT, REPLAY_MULTIPLIER } from "../utils/constants.js";

// 雨粒1本の見た目（細い縦ストリーク）。y方向にスケールを掛けて速さを表現する。
const STREAK_LENGTH = 0.09; // m（体感速度のときの尾の長さ）
const STREAK_RADIUS = 0.0045; // m
const REPLAY_STREAK_SCALE = Math.min(REPLAY_MULTIPLIER, 3.5); // リプレイ時は尾を伸ばして「速い雨」に見せる

/**
 * 雨粒を InstancedMesh で描画する。
 * 位置は core から一方向で受け取るだけ：
 *   - PLAYING : ctx.rainPhysics.positions（Float32Array, 3要素/粒, local-floor座標）
 *   - REPLAY  : ctx.replayer.frame.rainPositions（記録データ）
 */
export class RainRenderer {
  constructor(scene, ctx) {
    this.scene = scene;
    this.count = RAIN_COUNT;

    const geometry = new THREE.CylinderGeometry(
      STREAK_RADIUS,
      STREAK_RADIUS,
      STREAK_LENGTH,
      5,
      1,
      true
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0xbcd6ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      toneMapped: false
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    this._dummy = new THREE.Object3D();
  }

  /** その時点で読むべき雨の位置配列を返す（無ければ null） */
  _pickSource(ctx) {
    if (ctx.game?.state === "REPLAY") {
      return ctx.replayer?.frame?.rainPositions ?? null;
    }
    return ctx.rainPhysics?.positions ?? null;
  }

  update(_dt, ctx) {
    const positions = this._pickSource(ctx);
    if (!positions) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const yScale = ctx.game?.state === "REPLAY" ? REPLAY_STREAK_SCALE : 1;
    const available = Math.min(this.count, Math.floor(positions.length / 3));

    for (let i = 0; i < this.count; i++) {
      if (i < available) {
        const o = i * 3;
        this._dummy.position.set(positions[o], positions[o + 1], positions[o + 2]);
        this._dummy.scale.set(1, yScale, 1);
      } else {
        // 記録フレーム側の粒数が少ない場合は畳んで隠す
        this._dummy.scale.set(0, 0, 0);
      }
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
