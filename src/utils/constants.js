export const RAIN_SPEED_SLOW = 1.5;     // m/s（ゲーム中の見かけの雨速）
export const RAIN_SPEED_REAL = 7.0;     // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 4.67倍
export const RAIN_COUNT = 150;          // 同時に存在する雨粒数（難易度調整の主要パラメータ）
export const PLAYER_HEAD_RADIUS = 0.15; // m
export const PLAYER_HAND_RADIUS = 0.15; // m（実機調整前提）
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
