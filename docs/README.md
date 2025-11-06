# eecho 実装ドキュメント

このドキュメントでは、eechoの内部実装について詳しく説明します。

## アーキテクチャ概要

eechoは以下の設計原則に基づいて実装されています：

- **疎結合**: プロバイダパターンで翻訳エンジンを抽象化
- **拡張性**: 新しい翻訳エンジンを簡単に追加可能
- **型安全**: TypeScript strictモードで実装
- **ゼロセットアップ**: 追加の依存関係なしでnpm installだけで動作

## ディレクトリ構造

```
eecho/
├── src/
│   ├── entry/              # CLIエントリポイント
│   │   └── eecho.ts        # メインCLI（shebang付き、引数/stdin処理）
│   │
│   ├── core/               # コアロジック
│   │   └── translator.ts   # 翻訳パイプライン統括
│   │
│   ├── providers/          # 翻訳エンジンの抽象化
│   │   ├── provider.ts     # TranslateProviderインターフェース定義
│   │   ├── transformers.ts # Transformers.js実装（デフォルト）
│   │   └── ollama.ts       # Ollama実装（オプション）
│   │
│   ├── services/           # 周辺サービス
│   │   └── clipboard.ts    # クリップボード操作
│   │
│   └── utils/              # ユーティリティ
│       └── detectJapanese.ts # 日本語検出ロジック
│
├── package.json
├── tsconfig.json
└── README.md
```

## コンポーネント詳細

### 1. エントリポイント（src/entry/eecho.ts）

CLIのメインエントリポイント。以下の責務を持ちます：

- **引数処理**: コマンドライン引数とstdinの両方に対応
- **ヘルプ・バージョン表示**: --help、--versionオプション
- **エラーハンドリング**: 適切なエラーメッセージと終了コード
- **出力制御**: stdout（翻訳結果）とstderr（メッセージ）の分離

```typescript
// 主要な処理フロー
1. 引数またはstdinから入力を取得
2. Translatorインスタンスを作成
3. 翻訳を実行
4. 結果をstdoutへ出力
5. クリップボードへコピー
```

### 2. 翻訳パイプライン（src/core/translator.ts）

翻訳処理全体を統括するコアロジック。

**主要な機能**:

- 日本語検出（日本語以外はスキップ）
- プロバイダの初期化と可用性チェック
- 翻訳実行と結果の整形
- 処理時間の計測

**実装のポイント**:

```typescript
class Translator {
  private provider: TranslateProvider;

  constructor(provider?: TranslateProvider) {
    // デフォルトはTransformersProvider（追加セットアップ不要）
    this.provider = provider || new TransformersProvider();
  }

  async translate(text: string): Promise<TranslationOutput> {
    // 1. 日本語検出
    const wasJapanese = detectJapanese(text);
    if (!wasJapanese) return { ... };

    // 2. プロバイダの可用性チェック
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) throw new Error(...);

    // 3. 翻訳実行
    const result = await this.provider.translate(text);
    return { translatedText: result.text, ... };
  }
}
```

### 3. プロバイダパターン（src/providers/）

異なる翻訳エンジンを統一的に扱うための抽象化層。

#### 3.1 インターフェース（provider.ts）

すべての翻訳プロバイダが実装すべきインターフェース：

```typescript
interface TranslateProvider {
  readonly name: string;
  translate(text: string, options?: TranslateOptions): Promise<TranslateResult>;
  isAvailable(): Promise<boolean>;
}
```

#### 3.2 Transformers.js実装（transformers.ts）

**デフォルトプロバイダ**。追加セットアップ不要で動作します。

**使用技術**:
- `@xenova/transformers`: Transformers.jsライブラリ
- モデル: `Xenova/opus-mt-ja-en`（Helsinki-NLPのONNX最適化版）
- キャッシュ: `~/.cache/huggingface/`

**実装の特徴**:

```typescript
class TransformersProvider implements TranslateProvider {
  private translatorPipeline: any = null;
  private isInitializing = false;

  async translate(text: string): Promise<TranslateResult> {
    // 初回のみパイプライン初期化（モデルダウンロード含む）
    if (!this.translatorPipeline) {
      await this.initializePipeline();
    }

    // 翻訳実行
    const result = await this.translatorPipeline(text, {
      max_length: 512,
    });

    // 型安全な結果抽出
    return { text: this.extractTranslation(result, text), ... };
  }

  private async initializePipeline(): Promise<void> {
    this.translatorPipeline = await pipeline(
      'translation',
      'Xenova/opus-mt-ja-en',
      {
        // 進捗表示付きダウンロード
        progress_callback: (progress) => { ... }
      }
    );
  }

  // 型ガードを使った安全な結果抽出
  private extractTranslation(result: unknown, fallback: string): string {
    if (
      Array.isArray(result) &&
      result.length > 0 &&
      typeof result[0] === 'object' &&
      result[0] !== null &&
      'translation_text' in result[0]
    ) {
      const output = result[0] as TransformersTranslationOutput;
      return output.translation_text;
    }
    return fallback;
  }
}
```

**型安全性のポイント**:
- `any`型を避け、型ガードで安全に型チェック
- 配列、オブジェクト、プロパティの存在を順番に確認
- すべてクリアした場合のみ型アサーション

#### 3.3 Ollama実装（ollama.ts）

**オプションプロバイダ**。Mistral 7Bなどの大きなモデルを使用したい場合に利用。

**使用技術**:
- Ollama API（http://localhost:11434）
- モデル: mistral:instruct（デフォルト）

**実装の特徴**:

```typescript
class OllamaProvider implements TranslateProvider {
  async translate(text: string): Promise<TranslateResult> {
    // プロンプト構築
    const prompt = this.buildPrompt(text);

    // Ollama APIへPOSTリクエスト
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0.3 } // 翻訳は一貫性重視
      }),
      signal: controller.signal // タイムアウト対応
    });

    const data = await response.json();
    return { text: this.cleanupResponse(data.response), ... };
  }

  private buildPrompt(text: string): string {
    return `Translate the following Japanese text to English. Output only the translation, without any explanations, quotes, or additional text.

Japanese: ${text}

English:`;
  }

  // LLMの余計な出力を削除
  private cleanupResponse(response: string): string {
    let cleaned = response.trim();
    
    // 引用符を除去
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1);
    }
    
    // ラベルを除去
    cleaned = cleaned.replace(/^(Translation|English|Output):\s*/i, '');
    
    return cleaned.trim();
  }
}
```

### 4. 日本語検出（src/utils/detectJapanese.ts）

正規表現を使った日本語検出ロジック。

**実装**:

```typescript
// Unicode範囲を使用
const HIRAGANA_REGEX = /[\u3040-\u309F]/; // ひらがな
const KATAKANA_REGEX = /[\u30A0-\u30FF]/; // カタカナ
const KANJI_REGEX = /[\u4E00-\u9FFF]/;    // 漢字（CJK統合漢字）

export function detectJapanese(text: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  return (
    HIRAGANA_REGEX.test(text) ||
    KATAKANA_REGEX.test(text) ||
    KANJI_REGEX.test(text)
  );
}
```

**利点**:
- シンプルで高速
- 外部ライブラリ不要
- ひらがな・カタカナ・漢字のいずれか1文字でも含まれていれば検出

### 5. クリップボード統合（src/services/clipboard.ts）

`clipboardy`ライブラリを使ったクロスプラットフォーム対応。

**実装**:

```typescript
import clipboardy from 'clipboardy';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await clipboardy.write(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}
```

**対応プラットフォーム**:
- macOS: `pbcopy`
- Linux X11: `xclip`
- Linux Wayland: `wl-clipboard`
- Windows: `clip`

## データフロー

```
ユーザー入力
    ↓
eecho.ts（CLIエントリ）
    ↓
Translator.translate()
    ↓
detectJapanese()（日本語チェック）
    ↓
TransformersProvider.translate()
    ↓
Transformers.js（ローカルモデル）
    ↓
翻訳結果
    ↓
├→ stdout（翻訳テキスト）
└→ clipboardy（クリップボード）
```

## 技術的な選択理由

### なぜTransformers.jsをデフォルトにしたのか

1. **追加セットアップ不要**: Node.jsだけで完結
2. **npm install一発**: Python、Ollama等の外部ツール不要
3. **ONNX最適化**: CPUでも実用的な速度
4. **自動モデル管理**: 初回に自動ダウンロード、以降はキャッシュ利用
5. **商用利用可能**: MITライセンス

### なぜOllamaも実装したのか

1. **将来の拡張性**: より高品質な翻訳が必要な場合のオプション
2. **プロバイダパターンのデモ**: 複数エンジンの切り替え実装例
3. **柔軟性**: ユーザーが環境に応じて選択可能

### なぜopus-mt-ja-enモデルを選んだのか

1. **軽量**: 約300MB（大規模LLMの数十分の一）
2. **専用モデル**: 日本語→英語に特化
3. **ONNX最適化済み**: Xenovaが公式にONNX変換済み
4. **実績**: Helsinki-NLPの定番モデル
5. **商用利用可**: CC-BY 4.0ライセンス

## パフォーマンス最適化

### モデル読み込み

```typescript
// 初回のみ実行、以降は再利用
private translatorPipeline: any = null;

if (!this.translatorPipeline) {
  await this.initializePipeline(); // 重い処理
}
```

### キャッシュ戦略

1. **モデルキャッシュ**: `~/.cache/huggingface/`に永続化
2. **パイプライン再利用**: 一度初期化したら使い回し
3. **同期制御**: 複数翻訳リクエストでも初期化は1回のみ

```typescript
private isInitializing = false;

private async initializePipeline(): Promise<void> {
  if (this.isInitializing) {
    // 他のリクエストが初期化中なら待機
    while (this.isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  
  this.isInitializing = true;
  try {
    this.translatorPipeline = await pipeline(...);
  } finally {
    this.isInitializing = false;
  }
}
```

## エラーハンドリング

### タイムアウト制御

```typescript
private async withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Translation timeout')), timeoutMs)
    ),
  ]);
}
```

### プロバイダ可用性チェック

```typescript
const isAvailable = await this.provider.isAvailable();
if (!isAvailable) {
  throw new Error('Translation provider is not available...');
}
```

## TypeScript型安全性

### strictモード

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

### 型ガードの使用

```typescript
// any型を避けて型ガードで安全に
private extractTranslation(result: unknown, fallback: string): string {
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    typeof result[0] === 'object' &&
    result[0] !== null &&
    'translation_text' in result[0]
  ) {
    const output = result[0] as TransformersTranslationOutput;
    return output.translation_text;
  }
  return fallback;
}
```

## 今後の拡張計画

### 1. 設定ファイル対応

```typescript
// ~/.config/eecho/config.json
{
  "provider": "transformers", // or "ollama"
  "model": "Xenova/opus-mt-ja-en",
  "autoCopy": true,
  "timeout": 30000
}
```

### 2. M2M100プロバイダ

- より高品質な翻訳
- 100言語対応
- CTranslate2との統合

### 3. プリフィックスなしモード

```bash
# シェルフック統合
$ こんにちは
↳ Hello  # 自動翻訳表示
```

### 4. 翻訳キャッシュ

```typescript
// LRUキャッシュで頻出フレーズを高速化
private cache = new LRU<string, string>(100);
```

## 開発ガイドライン

### コメント規則

- 実装の意図を日本語で簡潔に記述
- 元々そのコードであったかのように自然に記載
- 「追加」「変更」などの履歴的コメントは避ける

### 型の扱い

- `any`型を避け、型ガードや適切な型定義を使用
- 型アサーションは最小限に（型ガードでチェック後のみ）
- 外部ライブラリの型が不明な場合は`unknown`を使用

### エラー処理

- ユーザーに分かりやすいエラーメッセージ
- 適切な終了コード
- stderr/stdoutの使い分け

## ビルドとデプロイ

### ビルド

```bash
npm run build
# tsc -p tsconfig.json
# → dist/にJavaScript出力
```

### npm公開

```bash
npm publish
# package.jsonの"bin"設定で eecho コマンドが登録される
```

### ユーザー環境での動作

```bash
npm install -g eecho
# → /usr/local/bin/eecho にシンボリックリンク作成
# → dist/entry/eecho.js が実行される（shebang: #!/usr/bin/env node）
```

## まとめ

eechoは以下の設計思想で実装されています：

1. **ユーザー体験優先**: npm install一発で動く
2. **疎結合アーキテクチャ**: プロバイダパターンで拡張性確保
3. **型安全**: TypeScript strictモードで堅牢性確保
4. **オフライン優先**: ローカルモデルで完結
5. **プライバシー重視**: データが外部に送信されない

この設計により、「誰でも簡単に使えて、拡張もしやすい」翻訳CLIツールを実現しています。

