// Phase 1: 環境構築・検証用の最小スケルトン。
// immersive-ar セッションが開始できるか、頭・コントローラーのトラッキングが
// 取得できるかを実機（PICO 4 Ultra）で確認するためのものです。
// Phase 2 以降、core/presentation の実装が main.js を置き換えます。

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

const container = document.getElementById("app");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  20
);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// パススルーが効いているか目視確認するための目印キューブ
const marker = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.1, 0.1),
  new THREE.MeshNormalMaterial()
);
marker.position.set(0, 1.4, -0.5);
scene.add(marker);

document.body.appendChild(
  ARButton.createButton(renderer, {
    optionalFeatures: ["local-floor", "hand-tracking"]
  })
);

// 頭・コントローラーのトラッキング確認用表示（Phase 1のみ・後で削除）
// dom-overlay がヘッドセット内で効かない機種があるため、視界に追従する
// 3Dパネル（Canvasテクスチャ）に直接テキストを描画する。
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0, controller1);

const hudCanvas = document.createElement("canvas");
hudCanvas.width = 512;
hudCanvas.height = 256;
const hudCtx = hudCanvas.getContext("2d");
const hudTexture = new THREE.CanvasTexture(hudCanvas);
const hudPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.15),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false })
);
hudPanel.position.set(-0.12, 0.08, -0.4); // 視界左上あたりに固定
hudPanel.renderOrder = 999;
camera.add(hudPanel);
scene.add(camera);

function fmt(v) {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}

function updateHud(text) {
  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  hudCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  hudCtx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  hudCtx.fillStyle = "#00ff88";
  hudCtx.font = "26px monospace";
  text.split("\n").forEach((line, i) => hudCtx.fillText(line, 12, 36 + i * 32));
  hudTexture.needsUpdate = true;
}

renderer.setAnimationLoop((time, frame) => {
  marker.rotation.y += 0.01;

  if (frame) {
    updateHud(
      `head        ${fmt(camera.position)}\n` +
        `controller0 ${fmt(controller0.position)}\n` +
        `controller1 ${fmt(controller1.position)}`
    );
  }

  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
