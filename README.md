# eecho

ターミナル上で日本語を入力すると、即座に英語へ翻訳してクリップボードにコピーするCLIツールです。


## 特徴

- **ゼロセットアップ**: `npm install -g eecho` だけで即利用可能
- **完全オフライン動作**: 初回実行後はインターネット不要
- **自動クリップボードコピー**: 翻訳結果を自動でクリップボードへ
- **プライバシー重視**: すべての処理がローカルマシン上で完結
- **クロスプラットフォーム**: macOS、Linux、Windowsで動作
- **高速**: ONNX最適化モデルで素早い翻訳

## インストール

```bash
npm install -g eecho
```

これだけです。Ollama、Python、その他の依存関係は一切不要です。

## 使い方

### 初回実行

初回実行時のみ、翻訳モデル（約300MB）を自動ダウンロードします：

```bash
eecho こんにちは
# Downloading model... 100%
# Model ready!
# Hello
# Copied to clipboard
```

### 2回目以降

2回目以降は即座に翻訳されます：

```bash
eecho こんにちは
# Hello
# Copied to clipboard
```

### 使用例

```bash
# 基本的な翻訳
eecho こんにちは
# 出力: Hello

# 長文の翻訳
eecho "今日はいい天気ですね"
# 出力: It's nice weather today

# パイプから入力
echo "ありがとうございます" | eecho
# 出力: Thank you very much

# 複数の単語
eecho お疲れ様でした
# 出力: Good work
```

### オプション

```bash
eecho --help     # ヘルプを表示
eecho --version  # バージョンを表示
```

## 動作原理

1. **初回実行**: Helsinki-NLPのopus-mt-ja-enモデル（ONNX最適化版、約300MB）をダウンロード
2. **日本語検出**: ひらがな・カタカナ・漢字を含むテキストを検出
3. **翻訳実行**: ローカルのtransformerモデルで翻訳（初回以降はインターネット不要）
4. **クリップボードコピー**: 翻訳結果を自動でクリップボードへコピー
5. **結果表示**: ターミナルに翻訳結果を表示

## 必要環境

- Node.js >= 18.0.0
- ディスク容量 約500MB（モデルキャッシュ用）
- インターネット接続（初回実行時のみ）

## 開発

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/yourusername/eecho.git
cd eecho

# 依存関係をインストール
npm install

# TypeScriptをビルド
npm run build

# ローカルでテスト用にリンク
npm link

# テスト
eecho テスト
```

### 開発モードで実行

```bash
npm run dev -- こんにちは
```

### プロジェクト構造

```
eecho/
├── src/
│   ├── entry/          # CLIエントリポイント
│   ├── core/           # 翻訳パイプライン
│   ├── providers/      # 翻訳エンジン（transformers、ollama）
│   ├── services/       # クリップボード、設定など
│   └── utils/          # ヘルパー（日本語検出など）
├── package.json
└── tsconfig.json
```

## 高度な使用方法

### Ollamaを使用（オプション）

より大きなモデル（Mistral 7Bなど）を使いたい場合はOllamaを利用できます：

```bash
# Ollamaをインストール
brew install ollama  # macOS
# または
curl -fsSL https://ollama.com/install.sh | sh  # Linux

# Ollamaを起動
ollama serve

# Mistralモデルをダウンロード
ollama pull mistral:instruct

# Ollamaプロバイダを使用（今後実装予定）
# eecho --provider ollama こんにちは
```

## パフォーマンス

- **初回実行**: 約10〜30秒（モデルダウンロード + 初期化）
- **2回目以降**: 1文あたり約1〜3秒
- **モデルサイズ**: 約300MB（`~/.cache/huggingface/`にキャッシュ）
- **メモリ使用量**: 翻訳中約200〜400MB

## トラブルシューティング

### モデルのダウンロードに失敗する

```bash
# インターネット接続を確認
ping huggingface.co

# キャッシュをクリアして再試行
rm -rf ~/.cache/huggingface/
eecho こんにちは
```

### 翻訳が遅い

起動後の最初の翻訳はモデル読み込みのため遅くなります。2回目以降は高速化します。

### クリップボードが動作しない

Linuxの場合、クリップボードツールのインストールが必要な場合があります：

```bash
# X11
sudo apt-get install xclip

# Wayland
sudo apt-get install wl-clipboard
```

## ライセンス

MIT

## ロードマップ

- [x] 日本語→英語翻訳
- [x] オフライン優先で自動モデルダウンロード
- [x] クリップボード統合
- [ ] 設定ファイル対応（~/.config/eecho/config.json）
- [ ] 複数バックエンド対応（Ollama、M2M100など）
- [ ] 双方向翻訳（英語→日本語）
- [ ] よく使うフレーズのキャッシュ
- [ ] シェル統合（プリフィックスなしモード）
- [ ] カスタムモデル対応
- [ ] バッチ翻訳モード

## なぜeechoを使うのか

- **APIキー不要**: クラウド翻訳サービスと違い、サインアップやAPIキー不要
- **プライバシー**: テキストがマシンの外に出ることはありません
- **高速**: ONNXで最適化されたローカルモデルで高速動作
- **無料**: 使用制限なし、コストなし
- **オフライン**: 飛行機の中でも、電車の中でも、どこでも使えます

## こんな用途に最適

- 日本語のエラーメッセージを翻訳
- 日本語ドキュメントを読む
- 開発中の素早い翻訳
- プライバシーが重要な翻訳タスク

## 技術詳細

実装の詳細については [docs/README.md](./docs/README.md) を参照してください。
