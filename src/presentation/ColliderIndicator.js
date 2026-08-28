import * as THREE from "three";
import { PLAYER_HEAD_RADIUS, PLAYER_HAND_RADIUS, PLAYER_SWAT_RADIUS } from "../utils/constants.js";

const DODGE_COLOR = 0x7cc4ff; // 原モード：頭・手とも「当たると被弾」＝寒色
const HEAD_COLOR = 0xff8a7c; // 殴り飛ばしモード：守るべき頭＝暖色
const SWAT_COLOR = 0x7cf0c4; // 殴り飛ばしモード：殴り飛ばす範囲＝アクション寄りの色
const OPACITY = 0.16;

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
 * - 原モード（よける）：頭・両手とも被弾判定（寒色・PlayerCollider.headRadius/handRadius）
 * - 殴り飛ばしモード（?mode=swat）：頭＝被弾（暖色）／両手＝殴り飛ばす範囲（アクション色・swatRadius）
 * 半径は core と同じ定数を参照する。
 */
export class ColliderIndicator {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.controllers = ctx.controllers ?? [];
    const swat = !!ctx.swatMode;

    this.headSphere = makeSphere(PLAYER_HEAD_RADIUS, swat ? HEAD_COLOR : DODGE_COLOR);
    this.headSphere.visible = false;
    this.camera.add(this.headSphere);

    const handRadius = swat ? PLAYER_SWAT_RADIUS : PLAYER_HAND_RADIUS;
    const handColor = swat ? SWAT_COLOR : DODGE_COLOR;
    this.handSpheres = this.controllers.map((controller) => {
      const mesh = makeSphere(handRadius, handColor);
      mesh.visible = false;
      controller.add(mesh);
      return mesh;
    });
  }

  update(_dt, ctx) {
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
