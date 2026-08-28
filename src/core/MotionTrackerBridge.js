import { MOTION_TRACKER_WS_URL } from "../utils/constants.js";

/**
 * PICO Motion Tracker（足首2個）のデータを、同一端末上で動くネイティブ補助アプリ
 * （Unity + PICO Integration SDK等、別プロジェクト）からローカルWebSocket経由で
 * 受け取るブリッジ。ネイティブアプリが未起動・未接続でもゲームは通常通り動く
 * （PlayerAvatarの脚はバインドポーズのまま。GAMESPEC 6.2）。
 *
 * 受信するJSONメッセージの想定フォーマット（ネイティブ側の実装に依存）：
 * {
 *   "left":  { "ankle": {x,y,z}, "knee": {x,y,z} },  // kneeは省略可（無ければ膝の曲げ方向は近似）
 *   "right": { "ankle": {x,y,z}, "knee": {x,y,z} }
 * }
 * x, y, z は「腰(Hips)からの相対オフセット」（メートル単位）を、頭のヨー（体の正面）
 * 基準のローカル座標で表したもの：x=右方向 / y=上方向 / z=後方向（-zが前方。
 * WebXRの頭・コントローラーの姿勢と同じ「-Zが前方」規約に合わせてある）。
 * 絶対的なワールド座標（Unity側のセッションとWebXR側のセッションで原点が一致する
 * 保証がない）には依存しない設計にしている。
 */
export class MotionTrackerBridge {
  constructor(url = MOTION_TRACKER_WS_URL) {
    this.url = url;
    this._latest = null;
    this._ws = null;
    this._retryTimer = null;
    this._disposed = false;
    this._connect();
  }

  _connect() {
    if (this._disposed || typeof WebSocket === "undefined") return;
    try {
      this._ws = new WebSocket(this.url);
    } catch {
      this._scheduleRetry();
      return;
    }
    this._ws.addEventListener("message", (event) => {
      try {
        this._latest = JSON.parse(event.data);
      } catch {
        // 壊れたメッセージは無視し、最後に有効だった値を保持する
      }
    });
    this._ws.addEventListener("close", () => this._scheduleRetry());
    this._ws.addEventListener("error", () => this._ws?.close());
  }

  _scheduleRetry() {
    if (this._disposed || this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._connect();
    }, 2000);
  }

  /** 最新の脚データ（{ left, right }）。未接続・未受信ならnull。 */
  getLatest() {
    return this._latest;
  }

  dispose() {
    this._disposed = true;
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._ws?.close();
  }
}
