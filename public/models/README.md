# public/models

`PlayerAvatar.js` が読み込むリプレイ用アバター。Vite は `public/` 配下をそのまま配信する。

| ファイル | 用途 |
|---|---|
| `avatar.glb` | リプレイ中に表示する「過去の自分」のアバター（頭・手は記録データに追従、体・脚は待機アニメ、身長は自動スケール） |

- ファイルが無くてもゲームは動く（コンソールに警告が出るだけ / アバターが出ないだけ）。
- 調整値は `src/presentation/_avatarConfig.js`。`ENABLED = false` でこの機能ごと無効化できる。

## 素材元とライセンス

| ファイル | 素材 | 作者 | ライセンス | 取得元 |
|---|---|---|---|---|
| `avatar.glb` | 「Man」（Animated Men Pack） | Quaternius | **CC0 / Public Domain**（表示義務なし） | https://poly.pizza/m/HMnuH5geEG |

- 取得日: 2026-08-27。poly.pizza の配信 GLB をそのまま配置（`static.poly.pizza/3746be88-...glb`）。無加工。
- FBX2glTF v0.9.7 出力。単一スキンメッシュ `BaseHuman`、スケルトンのボーン名は
  `Head` / `Neck` / `Torso` / `Hips` / `Shoulder.L|R` / `UpperArm.L|R` / `LowerArm.L|R` / `Palm.L|R` /
  `UpperLeg.L|R` / `LowerLeg.L|R` / `Foot.L|R` など（`_avatarConfig.js` の `BONES` と対応）。
- 同梱アニメーション: `Man_Idle`（待機ポーズに使用）ほか Walk/Run/Jump/Punch など計11本。
  リプレイでは Idle のみ使用し、頭と腕はコード側で上書きする。

## 差し替える場合

別の CC0 リグ付き人体に差し替えるときは、`avatar.glb` を置き換えたうえで
`_avatarConfig.js` の `BONES` / `IDLE_CLIP` / `MODEL_FACE_YAW_OFFSET` をそのモデルに合わせる。
目線高・腕の長さ・レスト軸は読み込み時に自動計測するので数値の手直しは不要。
