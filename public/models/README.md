# public/models

`PlayerAvatar.js` が読み込むリプレイ用アバター。Vite は `public/` 配下をそのまま配信する。

- `avatar.glb` — リプレイ中に表示する人型アバター。頭は記録データの頭姿勢をそのまま反映し、
  体幹はヨー（左右の向き）だけに追従、両腕はTwo-Bone IKで手の位置・向きに合わせる。
  脚は、PICO Motion Tracker連携（`MotionTrackerBridge.js`、拡張機能）があればTwo-Bone IKで
  動かす。連携がなければ従来通りバインドポーズ固定（GAMESPEC 6.2）。
  身長はモデルの実寸から自動スケール（`TARGET_HEIGHT = 1.7m`）。
- ファイルが無くてもゲームは動く（コンソールに警告が出るだけ / アバターが出ないだけ）。

## 素材元とライセンス

`avatar.glb`：「Man」（Animated Men Pack）、作者 Quaternius、**CC0 / Public Domain**（表示義務なし）。
取得元：https://poly.pizza/m/HMnuH5geEG

- 取得日: 2026-08-27。poly.pizza の配信 GLB をそのまま配置。無加工。
- FBX2glTF v0.9.7 出力。単一スキンメッシュ `BaseHuman`、スケルトンのボーン名は
  `Head` / `Neck` / `Torso` / `Hips` / `ShoulderL|R` / `UpperArmL|R` / `LowerArmL|R` / `PalmL|R` /
  `UpperLegL|R` / `LowerLegL|R` / `FootL|R` など（glTFファイル上は `Shoulder.L` のようにドット区切り
  だが、GLTFLoaderの読み込み時にドットがサニタイズされ `ShoulderL` になる）。
- 同梱アニメーション: Idle/Walk/Run/Jump/Punch など計11本。リプレイでは使用せず、
  頭・体幹・腕はすべてコード側（`PlayerAvatar.js`）で毎フレーム計算して上書きする。
