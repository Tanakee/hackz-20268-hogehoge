# 開発計画書 - 雨避けVRゲーム

## プロダクト概要

PICO 4 Ultra上でWebXRを使った雨避けゲーム。
ゆっくり降る雨を避けてクリアすると、実際の雨速（約6〜9 m/s）に倍速した自分のリプレイ映像を見られる。

## 技術スタック

| 項目 | 採用技術 |
|------|---------|
| フレームワーク | Three.js + WebXR Device API |
| 雨描画 | Three.js InstancedMesh |
| トラッキング | WebXR（頭 + コントローラー2本） |
| デプロイ | Vercel または ngrok |
| 言語 | JavaScript (ES Modules) |

---

## 役割分担

| 役割 | 担当範囲 |
|------|---------|
| **ゲーム処理** | 物理・当たり判定・状態管理・録画・リプレイロジック・WebXRトラッキング |
| **演出** | 雨の見た目・空間・ライティング・UI/HUD・SE・エフェクト |

---

## ディレクトリ構成と担当

```
/
├── index.html                    # 共有
├── src/
│   ├── main.js                   # エントリポイント（共有）
│   │
│   ├── core/                     # [ゲーム処理担当]
│   │   ├── GameManager.js        # ゲーム状態管理（START/PLAYING/CLEAR/REPLAY）
│   │   ├── RainPhysics.js        # 雨粒の移動・当たり判定ロジック
│   │   ├── PlayerCollider.js     # 頭・コントローラーのコライダー
│   │   ├── Recorder.js           # フレームごとの位置記録
│   │   └── Replayer.js           # N倍速リプレイ再生
│   │
│   ├── presentation/             # [演出担当]
│   │   ├── RainRenderer.js       # 雨粒の描画（InstancedMesh・シェーダー）
│   │   ├── Environment.js        # 空間・ライティング・背景・霧
│   │   ├── HUD.js                # VR内UI（タイマー・ライフ）
│   │   ├── StartScreen.js        # スタート画面
│   │   ├── ReplayScreen.js       # リプレイ時の演出（速度表示など）
│   │   └── SoundManager.js       # SE・BGM
│   │
│   └── utils/
│       └── constants.js          # 共有（定数のみ）
│
├── assets/
│   └── sounds/                   # [演出担当]
└── package.json                  # 共有
```

**ゲーム処理担当：** `src/core/` 以下すべて
**演出担当：** `src/presentation/` 以下すべて

---

## Gitブランチ運用

```
main
├── dev          # 統合ブランチ（直接pushしない）
├── feature/A-*  # A担当の作業ブランチ
└── feature/B-*  # B担当の作業ブランチ
```

### ルール

- `main` への直接pushは禁止
- `dev` へのマージは必ずPRを立てる
- 1機能 = 1ブランチ
- マージ前に `git pull origin dev` でrebaseする
- コンフリクトが起きやすい `main.js` `constants.js` の変更は必ず一声かける

---

## 開発フェーズ

### Phase 1：環境構築（最初の30分）
- [ ] リポジトリ初期化・ディレクトリ構成作成
- [ ] Three.js + WebXR の Hello World をPICO 4で動作確認
- [ ] `constants.js` に共有定数を先に定義

### Phase 2：コア実装（並行開発）

**ゲーム処理担当**
- [ ] `RainPhysics.js` - 雨粒の位置データ更新・速度管理
- [ ] `PlayerCollider.js` - 頭・コントローラーの球コライダー
- [ ] 当たり判定ロジック（コライダー vs 雨粒位置データ）
- [ ] `GameManager.js` - START / PLAYING / CLEAR / REPLAY の状態遷移
- [ ] `Recorder.js` - 毎フレームの位置をバッファに積む

**演出担当**
- [ ] `Environment.js` - 空間・ライティング・背景セットアップ
- [ ] `RainRenderer.js` - InstancedMeshで雨粒を描画（位置はPhysicsから受け取る）
- [ ] `StartScreen.js` - VR内スタートUI
- [ ] `HUD.js` - タイマー・ライフ表示
- [ ] `SoundManager.js` - SE・BGMの基本実装

### Phase 3：統合（Phase 2完了後）
- [ ] `main.js` でcore/presentationを繋ぐ
  - GameManager → RainPhysics の位置データ → RainRenderer に渡す
  - GameManager のイベント → HUD・ReplayScreen に通知
- [ ] `Replayer.js` - 録画データをN倍速再生
- [ ] `ReplayScreen.js` - リプレイ演出の仕上げ
- [ ] クリア → リプレイ再生の一連フロー確認

### Phase 4：調整・仕上げ
- [ ] 雨速・雨粒数・判定サイズの調整
- [ ] 演出（SE・パーティクルエフェクト）
- [ ] PICO 4 Ultra実機での最終動作確認
- [ ] Vercelデプロイ

---

## コンフリクト回避ルール

1. **ディレクトリ単位で担当を固定する**（`core/` と `presentation/` は互いに触らない）
2. **共有ファイル（`main.js`, `constants.js`）を触る前に一声かける**
3. **`constants.js` の変更はPR必須**
4. **定期的に `dev` をpull**（最低1時間おき）
5. `import` のパスは相対パスで統一

### core / presentation の接続ルール

2つの担当が直接依存しないよう、**イベントとデータ構造だけで繋ぐ**。

```
core（ゲーム処理）        presentation（演出）
─────────────────────    ─────────────────────
RainPhysics.positions  → RainRenderer が読む（一方向）
GameManager.on('hit')  → SoundManager・HUD がリッスン
GameManager.on('clear')→ ReplayScreen が受け取る
```

- `core` 側は `presentation` を直接 import しない
- `presentation` 側は `core` のデータ/イベントを読むだけ
- `main.js` だけが両方を繋ぐ責任を持つ

---

## 共有定数（constants.js の初期値）

```js
export const RAIN_SPEED_SLOW = 1.5;    // m/s（ゲーム中）
export const RAIN_SPEED_REAL = 7.0;    // m/s（リプレイ）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW;
export const RAIN_COUNT = 150;
export const PLAYER_HEAD_RADIUS = 0.15; // m
export const GAME_DURATION = 30;        // 秒
```

---

## AI開発ツール分担

| ツール | 使いどころ |
|--------|----------|
| Claude Code | 設計・デバッグ・複雑なロジック（主にcore/） |
| OpenAI Codex | コンポーネントの量産・繰り返し実装（主にpresentation/） |

同じファイルを同時に両ツールに触らせない。

---

## デプロイ

```bash
# 開発サーバー（HTTPS必須：WebXRの要件）
npx vite --https

# PICO 4 Ultraからアクセス
# 同じWi-Fiに繋いでIPアドレスを入力
# または ngrok で外部公開
ngrok http 5173
```
