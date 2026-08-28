import * as THREE from "three";
import { PLAYER_HEAD_RADIUS, PLAYER_SWAT_RADIUS } from "../utils/constants.js";

const HEAD_COLOR = 0xff8a7c; // 守るべき当たり判定＝暖色
const SWAT_COLOR = 0x7cf0c4; // 殴り飛ばす範囲＝アクション寄りの色
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
 * 頭＝被弾判定（守る）、両手＝雨を殴り飛ばす範囲、を控えめな半透明の球で可視化する。
 * PLAYING中のみ表示。半径は core（PlayerCollider.headRadius / swatRadius）と同じ定数。
 */
export class ColliderIndicator {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.controllers = ctx.controllers ?? [];

    this.headSphere = makeSphere(PLAYER_HEAD_RADIUS, HEAD_COLOR);
    this.headSphere.visible = false;
    this.camera.add(this.headSphere);

    this.handSpheres = this.controllers.map((controller) => {
      const mesh = makeSphere(PLAYER_SWAT_RADIUS, SWAT_COLOR);
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
