export const RAIN_SPEED_SLOW = 1.1;     // m/s（ゲーム中の見かけの雨速。実機フィードバックにより1.5→1.1へ減速）
export const RAIN_SPEED_REAL = 7.0;     // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 6.36倍
export const RAIN_COUNT = 60;           // 同時に存在する雨粒数（実機フィードバックにより150→60へ減量。難易度調整の主要パラメータ）

// 雨の出現範囲（プレイヤー = local-floor 原点 が中心）。
// core（RainPhysics）と presentation（RainRenderer の表示範囲・地面の水しぶき位置）が
// 同じ値を参照できるよう共有定数化。
export const RAIN_SPAWN_RADIUS = 1.5;   // m（xz平面の出現半径。1.2→1.5へ拡大し密度を下げた）
export const RAIN_SPAWN_HEIGHT = 2.2;   // m（雨の出現上限の高さ）
export const RAIN_GROUND_Y = 0;         // m（この高さまで落ちたら再出現）

export const PLAYER_HEAD_RADIUS = 0.15; // m
export const PLAYER_HAND_RADIUS = 0.15; // m（実機調整前提）
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
export const READY_DURATION = 3;        // 秒（START後の準備カウントダウン。この間は雨もタイマーも動かない）
