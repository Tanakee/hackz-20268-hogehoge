// Phase 3: core（ゲーム処理）と presentation（演出）を配線するエントリポイント。
//
// - core / presentation は互いを import しない。main.js だけが両方を知る。
// - 毎フレーム core.update → presentation.update → renderer.render の順で回す。
// - presentation へは ctx = { renderer, camera, game, rainPhysics, replayer, controllers }
//   を渡す。replayer はリプレイ毎に作り直すので ctx を書き換えて共有する。

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

import { GameManager, GameState } from "./core/GameManager.js";
import { RainPhysics } from "./core/RainPhysics.js";
import { PlayerCollider } from "./core/PlayerCollider.js";
import { Recorder } from "./core/Recorder.js";
import { Replayer } from "./core/Replayer.js";
import { createPresentation } from "./presentation/index.js";

// ---- three.js 基盤 --------------------------------------------------------
const container = document.getElementById("app");

const scene = new THREE.Scene();
scene.background = null; // パススルーを透過させるので背景は張らない

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  30
);
scene.add(camera); // カメラ子オブジェクト（HUD等の視界追従パネル）を描画するため

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // クリアを透明に＝現実（パススルー）が見える
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor"); // 原点＝足元の床。core はこの座標系前提
container.appendChild(renderer.domElement);

document.body.appendChild(
  ARButton.createButton(renderer, {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking"]
  })
);

// ---- コントローラー（接続状態と左右を追跡） -----------------------------
const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
for (const c of controllers) {
  scene.add(c);
  c.userData.connected = false;
  c.addEventListener("connected", (e) => {
    c.userData.connected = true;
    c.userData.handedness = e.data && e.data.handedness;
  });
  c.addEventListener("disconnected", () => {
    c.userData.connected = false;
  });
}

// ---- core インスタンス --------------------------------------------------
const game = new GameManager();
const rainPhysics = new RainPhysics();
const collider = new PlayerCollider();
const recorder = new Recorder();

// ---- presentation -----------------------------------------------------
// ctx は「生きた参照」。replayer を差し替えるときは ctx.replayer を書き換える。
const ctx = { renderer, camera, game, rainPhysics, replayer: null, controllers };
const presentation = createPresentation(scene, ctx);

// ---- 状態遷移に対する core 側の配線 -----------------------------------
game.on("stateChange", (state) => {
  switch (state) {
    case GameState.PLAYING:
      rainPhysics.reset();
      recorder.start();
      break;
    case GameState.CLEAR:
    case GameState.GAMEOVER:
      recorder.stop();
      break;
    case GameState.REPLAY:
      // Replayer は再生完了時に自分で game.finishReplay() を呼ぶ
      ctx.replayer = new Replayer(recorder.getFrames(), game);
      break;
    case GameState.START:
      ctx.replayer = null;
      break;
    default:
      break;
  }
});

// ---- 毎フレームのポーズ取得ヘルパー ----------------------------------
// camera / controller の matrixWorld は three が前フレームの render 末尾に更新するため、
// ここで読むポーズは実質1フレーム遅れ（頭も手も同じだけ遅れるので当たり判定の相対精度は保たれる）。
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
function poseOf(object3d) {
  object3d.getWorldPosition(_pos);
  object3d.getWorldQuaternion(_quat);
  return {
    x: _pos.x, y: _pos.y, z: _pos.z,
    qx: _quat.x, qy: _quat.y, qz: _quat.z, qw: _quat.w
  };
}
const xyz = (pose) => (pose ? { x: pose.x, y: pose.y, z: pose.z } : null);

function handPoses() {
  let left = null;
  let right = null;
  for (const c of controllers) {
    if (!c.userData.connected) continue;
    const pose = poseOf(c);
    if (c.userData.handedness === "left") left = pose;
    else if (c.userData.handedness === "right") right = pose;
    else if (!left) left = pose; // handedness不明時は取得順で埋める
    else right = pose;
  }
  return { left, right };
}

// ---- メインループ ----------------------------------------------------
let lastTime = null;
renderer.setAnimationLoop((time) => {
  const dt = lastTime == null ? 0 : Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  rainPhysics.update(dt); // START/RESULT中も降らせて背景の雨にする

  if (game.state === GameState.PLAYING) {
    game.update(dt); // 時間切れで CLEAR へ遷移することがある
    if (game.state === GameState.PLAYING) {
      const head = poseOf(camera);
      const { left, right } = handPoses();
      const hits = collider.findHits(
        xyz(head),
        xyz(left),
        xyz(right),
        rainPhysics.positions
      );
      for (const hit of hits) game.registerHit(hit); // 3回で GAMEOVER へ
      recorder.record(dt, head, left, right, rainPhysics.positions, hits, game.lives);
    }
  } else if (game.state === GameState.REPLAY) {
    ctx.replayer?.update(dt); // 完了時に自分で finishReplay() → RESULT
  }

  presentation.update(dt);
  renderer.render(scene, camera);
});

// ---- 非XR時のリサイズ（XR中は無視される） --------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
