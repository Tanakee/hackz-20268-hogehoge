import * as THREE from "three";
import { PLAYER_HEAD_RADIUS, PLAYER_HAND_RADIUS } from "../utils/constants.js";

const COLOR = 0x7cc4ff;
const OPACITY = 0.16;

function makeSphere(radius) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      toneMapped: false
    })
  );
}

/**
 * 頭・両手の当たり判定範囲を、控えめな半透明の球で可視化する。PLAYING中のみ表示。
 * 半径はcore（PlayerCollider.headRadius / handRadius）と同じ定数を使うため、
 * 「実際にどこまでよければ避けられるか」がそのままプレイヤーに見える。
 */
export class ColliderIndicator {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.controllers = ctx.controllers ?? [];

    this.headSphere = makeSphere(PLAYER_HEAD_RADIUS);
    this.headSphere.visible = false;
    this.camera.add(this.headSphere);

    this.handSpheres = this.controllers.map((controller) => {
      const mesh = makeSphere(PLAYER_HAND_RADIUS);
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
