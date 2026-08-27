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
import { createPresentation } from "./presentation/index.js";

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

document.body.appendChild(
  ARButton.createButton(renderer, {
    optionalFeatures: ["local-floor", "hand-tracking"]
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

const ctx = {
  renderer,
  camera,
  game,
  rainPhysics,
  replayer: null,
  controllers
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

  if (game.state === "PLAYING") {
    rainPhysics.update(dt);
    game.update(dt);

    if (game.state === "PLAYING") {
      const head = poseFromObject3D(camera);
      const handLeft = poseFromController(controllerByHandedness("left"));
      const handRight = poseFromController(controllerByHandedness("right"));

      const hits = playerCollider.findHits(head, handLeft, handRight, rainPhysics.positions);
      for (const hit of hits) game.registerHit(hit);

      recorder.record(dt, head, handLeft, handRight, rainPhysics.positions, hits, game.lives);
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
