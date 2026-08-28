// Phase 3: core と presentation を配線する本体。
// DEVPLAN.md「Phase 2 実装の前提」の接続仕様に沿う：
//   ctx = { renderer, camera, game, rainPhysics, replayer, controllers }
//   毎フレームの呼び出し順: core.update() → presentation.update() → renderer.render()

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

import { GameManager } from "./core/GameManager.js";
import { RainPhysics } from "./core/RainPhysics.js";
import { PlayerCollider } from "./core/PlayerCollider.js";
import { Recorder } from "./core/Recorder.js";
import { Replayer } from "./core/Replayer.js";
import { MotionTrackerBridge } from "./core/MotionTrackerBridge.js";
import { createPresentation } from "./presentation/index.js";

// ゲームモード。既定は原モード（よける：頭・手とも被弾）。
// ?mode=swat のときだけ「殴り飛ばしモード」：手は被弾せず雨を弾き飛ばす（頭のみ被弾）。
const SWAT_MODE = new URLSearchParams(window.location.search).get("mode") === "swat";

const container = document.getElementById("app");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  20
);
// StartScreen/HUD/HitEffect等はcameraの子として3Dパネルを追加する実装のため、
// cameraをsceneに登録しておかないとそれらが描画対象に含まれず表示されない。
scene.add(camera);

// リプレイのPlayerAvatar（GLTFモデル、pbrMetallicRoughnessマテリアル）は
// 光源がないと真っ黒で見えなくなる。他の演出はすべてMeshBasicMaterial
// （光源不要）のため、これまで光源が一つも存在しなかった。
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(0.5, 1, 0.3);
scene.add(dirLight);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// three.jsのreferenceSpaceTypeはデフォルトで既に'local-floor'だが、意図を明確にするため明示しておく。
// ただし実機では、この"床"がデバイス側の床キャリブレーションに依存しており、必ずしも
// 本当の床（y=0）を正確に指すとは限らないと判明した（RAIN_GROUND_Y側の対策を参照）。
renderer.xr.setReferenceSpaceType("local-floor");
container.appendChild(renderer.domElement);

document.body.appendChild(
  ARButton.createButton(renderer, {
    // local-floorはゲーム全体の座標系（雨の地面判定・リプレイの座標再利用）の前提なので必須にする。
    // 対応していない環境では、原点がずれたまま気付かずに動くよりエラーで気付けた方が良い。
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking"]
  })
);

// --- コントローラー（左右判定つき） ---
function setupController(index) {
  const controller = renderer.xr.getController(index);
  controller.userData.connected = false;
  controller.userData.handedness = null;
  controller.addEventListener("connected", (event) => {
    controller.userData.connected = true;
    controller.userData.handedness = event.data?.handedness ?? null;
  });
  controller.addEventListener("disconnected", () => {
    controller.userData.connected = false;
    controller.userData.handedness = null;
  });
  scene.add(controller);
  return controller;
}

const controllers = [setupController(0), setupController(1)];

function controllerByHandedness(hand) {
  return controllers.find((c) => c.userData.handedness === hand) ?? null;
}

function poseFromController(controller) {
  if (!controller?.userData.connected) return null;
  return poseFromObject3D(controller);
}

function poseFromObject3D(obj) {
  return {
    x: obj.position.x,
    y: obj.position.y,
    z: obj.position.z,
    qx: obj.quaternion.x,
    qy: obj.quaternion.y,
    qz: obj.quaternion.z,
    qw: obj.quaternion.w
  };
}

// --- core ---
const game = new GameManager();
const rainPhysics = new RainPhysics();
const playerCollider = new PlayerCollider();
const recorder = new Recorder();
// PICO Motion Tracker連携（未起動・未接続でもゲームは通常通り動く。MotionTrackerBridge.js参照）
const motionTracker = new MotionTrackerBridge();

const ctx = {
  renderer,
  camera,
  game,
  rainPhysics,
  replayer: null,
  controllers,
  swatMode: SWAT_MODE
};

game.on("stateChange", (state) => {
  if (state === "PLAYING") {
    rainPhysics.reset();
    recorder.start();
  } else if (state === "CLEAR" || state === "GAMEOVER") {
    recorder.stop();
  } else if (state === "REPLAY") {
    ctx.replayer = new Replayer(recorder.getFrames(), game);
  }
});

// --- presentation ---
const presentation = createPresentation(scene, ctx);

// --- メインループ ---
let lastTime = null;

renderer.setAnimationLoop((time) => {
  const now = time / 1000; // ms -> s
  const dt = lastTime === null ? 0 : Math.min(0.1, now - lastTime);
  lastTime = now;

  if (game.state === "READY") {
    game.update(dt); // カウントダウンのみ進める。雨・当たり判定・記録はまだ行わない
  } else if (game.state === "PLAYING") {
    rainPhysics.update(dt);
    game.update(dt);

    if (game.state === "PLAYING") {
      const head = poseFromObject3D(camera);
      const handLeft = poseFromController(controllerByHandedness("left"));
      const handRight = poseFromController(controllerByHandedness("right"));

      // 原モード：頭・手とも被弾。殴り飛ばしモード：手は被弾させず（null 渡し）、頭のみ。
      const hits = SWAT_MODE
        ? playerCollider.findHits(head, null, null, rainPhysics.positions)
        : playerCollider.findHits(head, handLeft, handRight, rainPhysics.positions);
      for (const hit of hits) game.registerHit(hit);

      // 殴り飛ばしモードのみ：手が捉えた雨粒を弾き飛ばし、swat イベントで演出/音/振動へ。
      const swats = SWAT_MODE
        ? playerCollider.findSwats(handLeft, handRight, rainPhysics.positions)
        : [];
      const swatEvents = swats.map((s) => ({
        rainIndex: s.rainIndex,
        part: s.part,
        x: s.pos.x,
        y: s.pos.y,
        z: s.pos.z
      }));
      for (const e of swatEvents) game.emit("swat", e);

      recorder.record(
        dt,
        head,
        handLeft,
        handRight,
        rainPhysics.positions,
        hits,
        game.lives,
        { x: rainPhysics.windX, z: rainPhysics.windZ },
        motionTracker.getLatest(),
        swatEvents
      );

      // 被弾/殴り飛ばした雨粒はその場に留めず即座に再出現させる。放置すると同じ粒に
      // 何フレームも重なり続けて多段ヒット（1回のニアミスでライフ全損）してしまう。
      for (const hit of hits) rainPhysics.respawn(hit.rainIndex);
      for (const s of swats) rainPhysics.respawn(s.rainIndex);
    }
  } else if (game.state === "REPLAY") {
    ctx.replayer?.update(dt);
  }

  presentation.update(dt);
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
