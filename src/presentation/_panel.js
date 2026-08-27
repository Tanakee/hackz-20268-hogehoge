import * as THREE from "three";

/**
 * 視界追従UI用の「CanvasテクスチャMesh」を作るヘルパー。
 * ヘッドセット内では dom-overlay が不安定なため、UI は 3D パネルで描く（DEVPLAN / GAMESPEC 7）。
 *
 * @param {object} opts
 * @param {number} opts.worldWidth   パネルの実寸・横（m）
 * @param {number} opts.worldHeight  パネルの実寸・縦（m）
 * @param {number} [opts.pxWidth=512]  Canvas解像度・横
 * @param {number} [opts.pxHeight=256] Canvas解像度・縦
 */
export function createPanel({ worldWidth, worldHeight, pxWidth = 512, pxHeight = 256 }) {
  const canvas = document.createElement("canvas");
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx2d = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // パススルーの現実世界に重ねるため、素の加算に近い見え方を避けて通常合成
    toneMapped: false
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
  mesh.renderOrder = 10000;
  mesh.frustumCulled = false;

  return {
    mesh,
    canvas,
    ctx: ctx2d,
    /** 描画関数を渡すと clear してから呼び、テクスチャ更新フラグを立てる */
    draw(render) {
      ctx2d.clearRect(0, 0, pxWidth, pxHeight);
      render(ctx2d, pxWidth, pxHeight);
      texture.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    }
  };
}

/** 角丸矩形パス */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
