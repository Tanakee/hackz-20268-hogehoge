# 開発計画書 - 雨避けVRゲーム

> ゲーム内容の詳細は `GAMESPEC.md` を参照。本書は**技術スタック・役割分担・開発進行**を定義する。

---

## プロダクト概要

PICO 4 Ultra上で動作するWebXR製の雨避けMRゲーム。
プレイヤーはパススルーで見える現実世界の中でゆっくり降る雨を避ける。
クリア後、実際の雨速（約6〜9 m/s）に倍速したリプレイ映像を三人称で見て「本物の雨をリアルタイムで避けていた」驚きを体験する。

---

## 技術スタック

| 項目 | 採用技術 |
|------|---------|
| フレームワーク | Three.js + WebXR Device API |
| 雨描画 | Three.js InstancedMesh |
| XRセッション | `immersive-ar`（MRパススルー） |
| トラッキング | WebXR（頭 + コントローラー2本） |
| ビルド | Vite（HTTPS必須） |
| デプロイ | Vercel または ngrok |
| 言語 | JavaScript (ES Modules) |

---

## 役割分担

| 役割 | 担当範囲 |
|------|---------|
| **ゲーム処理** | 物理・当たり判定・状態管理・録画・リプレイロジック・WebXRトラッキング・フリーカメラ制御 |
| **演出** | 雨の見た目・アバター・UI/HUD・SE・リプレイ画面演出 |

---

## ディレクトリ構成と担当

```
/
├── index.html                    # 共有
├── src/
│   ├── main.js                   # エントリポイント・core/presentation接続（共有）
│   │
│   ├── core/                     # [ゲーム処理担当]
│   │   ├── GameManager.js        # 状態管理（START/PLAYING/CLEAR/GAMEOVER/REPLAY）
│   │   ├── RainPhysics.js        # 雨粒の位置更新・速度管理
│   │   ├── PlayerCollider.js     # 頭・コントローラーの球コライダー・当たり判定
│   │   ├── Recorder.js           # 毎フレームの頭・手・雨粒位置と被弾イベントを記録
│   │   └── Replayer.js           # 記録データをREPLAY_MULTIPLIER倍速で再生
│   │
│   ├── presentation/             # [演出担当]
│   │   ├── RainRenderer.js       # 雨粒の描画（InstancedMesh・水滴シェーダー）
│   │   ├── PlayerAvatar.js       # リプレイ時の棒人間アバター（記録データに追従）
│   │   ├── HitEffect.js          # 被弾演出（画面フラッシュ・コントローラー振動）
│   │   ├── HUD.js                # VR内UI（タイマー・ハートアイコン）・視界追従
│   │   ├── StartScreen.js        # スタート画面（トリガーボタンで開始）
│   │   ├── ReplayScreen.js       # リプレイ開始/終了フェード演出
│   │   └── SoundManager.js       # SE（被弾音・クリア音・雨音ループ）・フリー素材
│   │
│   └── utils/
│       └── constants.js          # 共有定数のみ
│
├── assets/
│   └── sounds/                   # [演出担当]
└── package.json                  # 共有
```

**ゲーム処理担当：** `src/core/` 以下すべて
**演出担当：** `src/presentation/` 以下すべて

---

## core / presentation の接続ルール

2つの担当が直接依存しないよう、**イベントとデータの一方向受け渡しで繋ぐ**。
`main.js` だけが両方を import して繋ぐ責任を持つ。

```
core（ゲーム処理）                    presentation（演出）
────────────────────────────────     ──────────────────────────────
RainPhysics.positions（Float32Array）→ RainRenderer が毎フレーム読む
Replayer.frame（記録データ）          → RainRenderer・PlayerAvatar が読む
Replayer.cameraTransform             → ReplayCamera が読む
GameManager.on('hit', payload)       → SoundManager・HUD がリッスン
GameManager.on('clear')              → ReplayScreen・SoundManager がリッスン
GameManager.on('gameover')           → ReplayScreen・SoundManager がリッスン
GameManager.on('stateChange', state) → HUD・StartScreen・ReplayScreen がリッスン
```

- `core` 側は `presentation` を直接 import しない
- `presentation` 側は `core` のデータ/イベントを読むだけ（書き込まない）

---

## Gitブランチ運用

```
main
├── dev                # 統合ブランチ（直接pushしない）
├── feature/core-*     # ゲーム処理担当の作業ブランチ
└── feature/pres-*     # 演出担当の作業ブランチ
```

### ルール

- `main` への直接pushは禁止
- `dev` へのマージは必ずPRを立てる
- 1機能 = 1ブランチ
- マージ前に `git pull origin dev --rebase`
- `main.js` と `constants.js` の変更は必ず一声かけてからPR

---

## 開発フェーズ

### Phase 1：環境構築・検証（最初の30〜45分）

> **両担当同席で進める**。ここで詰まると全体が止まる。

- [ ] リポジトリ初期化・ディレクトリ構成作成・package.json
- [ ] Vite + Three.js セットアップ、HTTPS開発サーバー起動確認
- [ ] **[最重要]** PICO 4 UltraブラウザでWebXR `immersive-ar` セッション（MRパススルー）が動くか実機確認
- [ ] 頭・コントローラーのトラッキング取得確認
- [ ] `constants.js` を先に定義（両担当が参照するため最初に確定）

### Phase 2：MVP実装（並行開発）

**ゲーム処理担当**
- [ ] `RainPhysics.js` - 雨粒の位置配列を毎フレーム更新（`positions: Float32Array`）
- [ ] `PlayerCollider.js` - 頭・手の球コライダー（各0.15m）、雨粒との距離判定
- [ ] `GameManager.js` - 状態遷移・ライフ管理（3回被弾でGAMEOVER）・タイマー（30秒）・REPLAY終了後の自動START遷移
- [ ] `Recorder.js` - フレームごとに頭・手・雨粒位置・被弾イベントをバッファに記録
- [ ] `Replayer.js` - 記録データを `REPLAY_MULTIPLIER` 倍速で再生するイテレーター

**演出担当**
- [ ] `RainRenderer.js` - InstancedMeshで雨粒を描画（位置はPhysicsから受け取るだけ）
- [ ] `HitEffect.js` - 被弾演出（画面フラッシュ赤点灯 + コントローラー振動）
- [ ] `HUD.js` - 視界追従UI（ハートアイコン3つ・タイマー）
- [ ] `StartScreen.js` - VR内スタート画面（トリガーボタンで開始）
- [ ] `SoundManager.js` - 被弾音・クリア音・雨音ループ（フリー素材）

### Phase 3：統合（Phase 2完了後）

- [ ] `main.js` でcore/presentationを接続（イベント・データの配線）
- [ ] PLAYING → CLEAR/GAMEOVER → REPLAY → START（自動）の一連フロー動作確認
- [ ] `PlayerAvatar.js` - 棒人間アバター実装（頭・手を球、胴体を棒で接続）
- [ ] `ReplayScreen.js` - リプレイ開始/終了のフェード演出

### Phase 4：調整・仕上げ

- [ ] 実機で難易度調整（`RAIN_COUNT`・`RAIN_SPEED_SLOW`・`GAME_DURATION`）
- [ ] パフォーマンス確認（雨粒150本で90fps維持できるか）
- [ ] リプレイ体験の確認（「本物の雨を避けていた」驚きが伝わるか）
- [ ] Vercelデプロイ・発表用URL確定

---

## 未決事項（Phase 1で技術確認が必要なもの）

| # | 内容 | 担当 |
|---|------|------|
| 1 | WebXR `immersive-ar` でPICO 4 Ultraのパススルーが使えるか → Phase 1で実機確認。動かない場合は `immersive-vr` + 宇宙空間背景に切り替え | 共有 |
| 2 | パススルー時のパフォーマンス（雨粒150個のInstancedMesh描画と両立できるか） | ゲーム処理 |

---

## 共有定数（constants.js）

```js
export const RAIN_SPEED_SLOW = 1.5;     // m/s（ゲーム中の見かけの雨速）
export const RAIN_SPEED_REAL = 7.0;     // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 4.67倍
export const RAIN_COUNT = 150;          // 同時に存在する雨粒数（難易度調整の主要パラメータ）
export const PLAYER_HEAD_RADIUS = 0.15; // m
export const PLAYER_HAND_RADIUS = 0.15; // m（実機調整前提）
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
```

---

## AI開発ツール分担

| ツール | 主な用途 |
|--------|---------|
| Claude Code | 設計・デバッグ・複雑なロジック（core/ 中心） |
| OpenAI Codex | コンポーネント量産・繰り返し実装（presentation/ 中心） |

同じファイルを同時に両ツールに触らせない。

---

## デプロイ・動作確認

```bash
# 開発サーバー（WebXRはHTTPS必須）
npx vite --https

# PICO 4 Ultraから接続
# 同じWi-FiでIPアドレスを直接入力
# または外部公開
ngrok http 5173
```
