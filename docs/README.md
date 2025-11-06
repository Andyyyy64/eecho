# eecho 実装メモ

## 全体像
- eecho は「CLI本体」と「バックグラウンド翻訳ワーカー」の2プロセス構成。
- 翻訳エンジンは `@xenova/transformers` の `Xenova/opus-mt-ja-en` モデルを使用。プロバイダ抽象 (`TranslateProvider`) は今後の拡張のために残している。
- 主要ディレクトリ:
  - `src/entry/eecho.ts`: CLI。引数処理、ワーカー管理、フォールバック翻訳、出力を担当。
  - `src/entry/translate-worker.ts`: キュー監視型の翻訳ワーカー。`Translator` を常駐させて繰り返し利用。
  - `src/core/translator.ts`: 入力検証→日本語検出→プロバイダ呼び出し→結果整形の共通ロジック。
  - `src/providers/transformers.ts`: `TranslateProvider` 実装。Transformers.js のパイプライン初期化や quiet モード制御を行う。
  - `src/utils/detectJapanese.ts`: 正規表現で日本語を検出。
  - `src/services/clipboard.ts`: 参照は残るが現在は使用していない（将来復活させる場合に備えて保持）。

## 翻訳フロー
1. ユーザーが `eecho こんにちは` のように実行すると、CLI は `parseCliArgs` で `--verbose` や `--shutdown-worker` を解釈し、標準入力または引数から文字列を取得する。
2. 通常モードでは、CLI が `/tmp/eecho-worker`（環境変数 `EECHO_WORKER_DIR` で変更可）に `req-<id>.json` を書き込み、バックグラウンドワーカーが結果を `res-<id>.json` として返す。ワーカーが存在しない／死んでいる場合は自動で spawn → PID ファイルを監視して起動確認する。
3. `--verbose` 時やワーカーが使えない場合は `Translator` を直接生成し、TransformersProvider で翻訳する。
4. `Translator.translate()` は入力を正規化した後、`detectJapanese()` で日本語チェック。日本語以外なら原文をそのまま返す。日本語ならプロバイダに委譲し、処理時間や使用プロバイダ名をまとめて返す。
5. `TransformersProvider` は初回のみ `pipeline('translation', 'Xenova/opus-mt-ja-en')` を初期化。quiet モード時は `process.stderr.write` を差し替えて ONNX Runtime の `[W:onnxruntime:` ログを抑制し、`progress_callback` も握りつぶす。
6. 結果は CLI が stdout に出力するだけで、その他の副作用は無い。

## モジュール詳細
### CLI (`src/entry/eecho.ts`)
- `suppressOnnxWarnings()` で quiet 出力時の stderr をラップ。
- バックグラウンドワーカーの PID を `worker.pid` で管理し、`process.kill(pid, 0)` で生存確認。
- リクエスト/レスポンスはシンプルな JSON ファイル。ワーカー起動待ち（タイムアウト10s）とレスポンス待ち（タイムアウト60s）を行い、失敗時はローカル翻訳にフォールバック。
- `--shutdown-worker` で `command: 'shutdown'` を送信し、PIDファイルも削除する。

### 翻訳ワーカー (`src/entry/translate-worker.ts`)
- 起動時に `/tmp/eecho-worker` を監視し、`req-*.json` を順番に処理。複数 CLI からの同時リクエストでも自然にシリアライズされる。
- `sharedTranslator` に TransformersProvider を1回だけ初期化し、以降は同じパイプラインを再利用するため二度目以降が高速。
- シャットダウン命令を受けたらレスポンスを書き戻し、PIDファイルを消して終了。

### Translator (`src/core/translator.ts`)
- 日本語判定、プロバイダ可用性チェック、翻訳、処理時間計測、結果整形を一手に担当。
- `TranslationOutput` には `translatedText` / `originalText` / `wasJapanese` / `provider` / `duration` を格納。

### プロバイダ抽象 (`src/providers/provider.ts`)
- 将来的に他の翻訳エンジンを差し替えられるように `TranslateProvider` interface を維持。
- 現状は TransformersProvider だけが実装だが、`setProvider()` 等の API はそのまま。

### TransformersProvider (`src/providers/transformers.ts`)
- quiet モードで `console.warn` の特定メッセージをフィルタし、ONNX Runtime のログレベルも `fatal` に設定。
- パイプライン初期化時の進捗表示やダウンロードメッセージを `quiet` が `true` のとき抑制。`translation_text` を安全に抽出するための型ガードも実装。

### detectJapanese (`src/utils/detectJapanese.ts`)
- ひらがな・カタカナ・漢字のユニコード範囲をチェックするだけの軽量実装。日本語以外のテキストは翻訳をスキップできる。

### services/clipboard.ts
- 現在はCLIから呼び出していないが、将来的に「翻訳結果を自動コピー」機能を戻す際のために保持している。

## 環境変数
- `EECHO_VERBOSE=1`: `--verbose` と同じ挙動。
- `EECHO_WORKER_DIR=/path/to/dir`: ワーカーのキュー/ PID ディレクトリを変更。
- `EECHO_DEBUG=1`: CLI/ワーカー双方でデバッグメッセージを stderr に出す。
- `ORT_LOG_SEVERITY_LEVEL`: `config/onnxEnv.ts` で既定値 4（fatal）に設定。必要なら上書き可能。

## 今後の拡張アイデア
- Provider 実装の追加（例: `M2M100` や外部API）
- 英→日など双方向翻訳
- 設定ファイルによるワーカー/翻訳オプションの調整
