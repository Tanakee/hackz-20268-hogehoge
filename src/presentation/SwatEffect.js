import * as THREE from "three";

/**
 * 雨を殴り飛ばした瞬間の小さな飛沫バースト。`game.on("swat", {x,y,z})` を受けて、
 * 着弾位置に加算ブレンドの小球をいくつか弾けさせる（scale 拡大＋減光）。
 * core には触らず、payload の座標を読むだけ。PLAYING 中に発生する。
 *
 * 調整は下の CFG。
 */

const CFG = {
  POOL: 30, // 同時に見えるスパーク数の上限
  PER_SWAT: 4, // 1回の swat で出すスパーク数
  LIFE: 0.24, // 1スパークの寿命（秒）
  FROM: 0.015, // 生成時の半径（m）
  TO: 0.14, // 消滅時の半径（m）
  SPREAD: 0.06, // 着弾点からのばらつき（m）
  COLOR: new THREE.Color(0xbdfff0)
};

export class SwatEffect {
  constructor(scene, ctx) {
    this.scene = scene;

    this._mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      CFG.POOL
    );
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 3;
    this._mesh.visible = false;
    scene.add(this._mesh);

    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    // 各スロット: { t, x, y, z, active }
    this._slots = Array.from({ length: CFG.POOL }, () => ({ t: 0, x: 0, y: 0, z: 0, active: false }));
    this._next = 0;

    this._lastReplaySwatGameTime = null;
    this._off = ctx.game.on("swat", (p) => this._burst(p));
  }

  _burst(p) {
    if (!p) return;
    for (let i = 0; i < CFG.PER_SWAT; i++) {
      const s = this._slots[this._next];
      this._next = (this._next + 1) % CFG.POOL;
      s.t = 0;
      s.active = true;
      s.x = p.x + (Math.random() - 0.5) * CFG.SPREAD;
      s.y = p.y + (Math.random() - 0.5) * CFG.SPREAD;
      s.z = p.z + (Math.random() - 0.5) * CFG.SPREAD;
    }
  }

  update(dt, ctx) {
    // リプレイ中は記録された swat のタイミング・位置でもバーストを出す
    if (ctx?.game?.state === "REPLAY") {
      const frame = ctx.replayer?.frame;
      if (frame?.swats?.length && frame.gameTime !== this._lastReplaySwatGameTime) {
        this._lastReplaySwatGameTime = frame.gameTime;
        for (const s of frame.swats) this._burst(s);
      }
    } else {
      this._lastReplaySwatGameTime = null;
    }

    let anyActive = false;
    for (let i = 0; i < CFG.POOL; i++) {
      const s = this._slots[i];
      if (!s.active) {
        this._dummy.scale.setScalar(0);
        this._dummy.updateMatrix();
        this._mesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      s.t += dt;
      const k = s.t / CFG.LIFE;
      if (k >= 1) {
        s.active = false;
        this._dummy.scale.setScalar(0);
        this._dummy.updateMatrix();
        this._mesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      anyActive = true;
      const r = CFG.FROM + (CFG.TO - CFG.FROM) * k;
      this._dummy.position.set(s.x, s.y, s.z);
      this._dummy.scale.setScalar(r);
      this._dummy.updateMatrix();
      this._mesh.setMatrixAt(i, this._dummy.matrix);
      this._col.copy(CFG.COLOR).multiplyScalar(1 - k);
      this._mesh.setColorAt(i, this._col);
    }
    this._mesh.visible = anyActive;
    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this._off?.();
    this.scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
  }
}
