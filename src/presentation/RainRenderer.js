import * as THREE from "three";
import { RAIN_COUNT, REPLAY_MULTIPLIER, RAIN_DROP_RADIUS } from "../utils/constants.js";

// 雨粒1本の見た目（細い縦ストリーク）。y方向にスケールを掛けて速さを表現する。
// 半径はcore（PlayerCollider）の当たり判定半径と共有し、見た目と判定を一致させる。
const STREAK_LENGTH = 0.09; // m（体感速度のときの尾の長さ）
const STREAK_RADIUS = RAIN_DROP_RADIUS; // m
const REPLAY_STREAK_SCALE = Math.min(REPLAY_MULTIPLIER, 3.5); // リプレイ時は尾を伸ばして「速い雨」に見せる

const UP_VECTOR = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUAT = new THREE.Quaternion();

/**
 * 雨粒を InstancedMesh で描画する。
 * 位置は core から一方向で受け取るだけ：
 *   - PLAYING / CLEAR / GAMEOVER : ctx.rainPhysics.positions（Float32Array, 3要素/粒, local-floor座標）
 *   - REPLAY                     : ctx.replayer.frame.rainPositions（記録データ）
 *   - START / RESULT             : 非表示（プレイ開始前・結果画面中に雨は降らない）
 * PLAYING/CLEAR/GAMEOVER中、rainPhysics.windX/windZ が非ゼロならストリークの
 * 向きもその方向へ傾ける（tiltedフラグではなく実際の風速を見る。風速はcore側で
 * なめらかに遷移するため、傾きもそれに追従して滑らかに変化する）。
 * リプレイ中の傾き再現は今回のスコープ外（常に垂直で表示する）。
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
    this._tiltDir = new THREE.Vector3();
    this._tiltQuat = new THREE.Quaternion();
  }

  /** その時点で読むべき雨の位置配列を返す（無ければ null） */
  _pickSource(ctx) {
    const state = ctx.game?.state;
    if (state === "REPLAY") {
      return ctx.replayer?.frame?.rainPositions ?? null;
    }
    if (state === "PLAYING" || state === "CLEAR" || state === "GAMEOVER") {
      return ctx.rainPhysics?.positions ?? null;
    }
    return null; // START / RESULT
  }

  update(_dt, ctx) {
    const positions = this._pickSource(ctx);
    if (!positions) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const state = ctx.game?.state;
    const yScale = state === "REPLAY" ? REPLAY_STREAK_SCALE : 1;
    const available = Math.min(this.count, Math.floor(positions.length / 3));

    const rain = ctx.rainPhysics;
    const windX = rain?.windX ?? 0;
    const windZ = rain?.windZ ?? 0;
    const isTilted = state !== "REPLAY" && (windX * windX + windZ * windZ) > 1e-6;
    if (isTilted) {
      this._tiltDir.set(windX, -rain.speed, windZ).normalize();
      this._tiltQuat.setFromUnitVectors(UP_VECTOR, this._tiltDir);
    }

    for (let i = 0; i < this.count; i++) {
      if (i < available) {
        const o = i * 3;
        this._dummy.position.set(positions[o], positions[o + 1], positions[o + 2]);
        this._dummy.scale.set(1, yScale, 1);
        this._dummy.quaternion.copy(isTilted ? this._tiltQuat : IDENTITY_QUAT);
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
