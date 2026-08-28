import * as THREE from "three";
import { PLAYER_HEAD_RADIUS, PLAYER_HAND_RADIUS, PLAYER_SWAT_RADIUS } from "../utils/constants.js";

const DODGE_COLOR = 0x7cc4ff; // 原モード：頭・手とも「当たると被弾」＝寒色
const HEAD_COLOR = 0xff8a7c; // 殴り飛ばしモード：守るべき頭＝暖色
const SWAT_COLOR = 0x7cf0c4; // 殴り飛ばしモード：殴り飛ばす範囲＝アクション寄りの色
const OPACITY = 0.16;
const HAND_SWAT_RATIO = PLAYER_SWAT_RADIUS / PLAYER_HAND_RADIUS; // 手の球を殴り判定サイズへ拡大する倍率

function makeSphere(radius, color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      toneMapped: false
    })
  );
}

/**
 * 当たり判定範囲を控えめな半透明球で可視化する。PLAYING中のみ表示。
 * モード（ctx.swatMode。START画面の左トリガーで切替）に応じて色・大きさを毎フレーム更新する：
 * - 原モード（よける）：頭・両手とも被弾判定（寒色・headRadius/handRadius）
 * - 殴り飛ばしモード：頭＝被弾（暖色）／両手＝殴り飛ばす範囲（アクション色・swatRadius）
 */
export class ColliderIndicator {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.controllers = ctx.controllers ?? [];
    this._swat = null; // 直近に反映したモード（変化時だけ色・スケールを更新）

    this.headSphere = makeSphere(PLAYER_HEAD_RADIUS, DODGE_COLOR);
    this.headSphere.visible = false;
    this.camera.add(this.headSphere);

    // 手の球は handRadius のジオメトリで作り、殴りモードでは scale で拡大する。
    this.handSpheres = this.controllers.map((controller) => {
      const mesh = makeSphere(PLAYER_HAND_RADIUS, DODGE_COLOR);
      mesh.visible = false;
      controller.add(mesh);
      return mesh;
    });
  }

  _applyMode(swat) {
    this.headSphere.material.color.set(swat ? HEAD_COLOR : DODGE_COLOR);
    const s = swat ? HAND_SWAT_RATIO : 1;
    for (const mesh of this.handSpheres) {
      mesh.material.color.set(swat ? SWAT_COLOR : DODGE_COLOR);
      mesh.scale.setScalar(s);
    }
    this._swat = swat;
  }

  update(_dt, ctx) {
    const swat = !!ctx.swatMode;
    if (swat !== this._swat) this._applyMode(swat);

    const show = ctx.game?.state === "PLAYING";
    this.headSphere.visible = show;
    for (const mesh of this.handSpheres) mesh.visible = show;
  }

  dispose() {
    this.camera.remove(this.headSphere);
    this.headSphere.geometry.dispose();
    this.headSphere.material.dispose();
    this.handSpheres.forEach((mesh, i) => {
      this.controllers[i]?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  }
}
