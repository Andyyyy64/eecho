/**
 * Transformers.js プロバイダ実装
 * @xenova/transformersを使ってNode.jsのみで完結する翻訳
 * 初回起動時に自動でモデルをダウンロード（~/.cache/huggingface/）
 */

import type {
  TranslateProvider,
  TranslateOptions,
  TranslateResult,
} from './provider.js';

type TransformersModule = typeof import('@xenova/transformers');

const ORT_LOG_LEVEL_MAP: Record<
  NonNullable<TransformersConfig['logLevel']>,
  string
> = {
  verbose: '0',
  info: '1',
  warning: '2',
  error: '3',
  fatal: '4',
};

let transformersModulePromise: Promise<TransformersModule> | null = null;

async function loadTransformersModule(
  desiredLogLevel?: TransformersConfig['logLevel']
): Promise<TransformersModule> {
  if (!transformersModulePromise) {
    if (desiredLogLevel) {
      applyOrtLogLevel(desiredLogLevel);
    }

    transformersModulePromise = import('@xenova/transformers').then((mod) => {
      mod.env.allowLocalModels = true;
      mod.env.allowRemoteModels = true;
      return mod;
    });
  }

  return transformersModulePromise;
}

function applyOrtLogLevel(level: TransformersConfig['logLevel']): void {
  if (!level) {
    return;
  }

  const mapped = ORT_LOG_LEVEL_MAP[level];
  if (mapped) {
    process.env.ORT_LOG_SEVERITY_LEVEL = mapped;
  }
}

/**
 * Transformers.jsの翻訳結果の型定義
 */
interface TransformersTranslationOutput {
  translation_text: string;
}

/**
 * Transformers.jsプロバイダの設定
 */
export interface TransformersConfig {
  /** 使用するモデル名（デフォルト: Xenova/opus-mt-ja-en） */
  model?: string;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
  /** ONNX Runtimeのログレベル */
  logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
  /** 進捗ログなどを表示しない */
  quiet?: boolean;
}

/**
 * Transformers.jsプロバイダ
 * Helsinki-NLP/opus-mt-ja-en をONNX化したモデルを使用
 */
export class TransformersProvider implements TranslateProvider {
  readonly name = 'transformers';
  private model: string;
  private timeout: number;
  private translatorPipeline: any = null;
  private isInitializing = false;
  private quiet: boolean;
  private logLevel: TransformersConfig['logLevel'];
  private transformersModule: TransformersModule | null = null;
  private restoreStderrWrite?: () => void;

  constructor(config?: TransformersConfig) {
    this.model = config?.model || 'Xenova/opus-mt-ja-en';
    this.timeout = config?.timeout || 30000; // 30秒
    this.quiet = config?.quiet ?? false;
    this.logLevel = config?.logLevel ?? 'warning';

    if (this.quiet) {
      this.suppressOnnxRuntimeWarnings();
    }
  }

  /**
   * テキストを翻訳
   */
  async translate(
    text: string,
    options?: TranslateOptions
  ): Promise<TranslateResult> {
    const startTime = Date.now();

    try {
      // パイプラインの初期化（初回のみ）
      if (!this.translatorPipeline) {
        await this.initializePipeline();
      }

      // タイムアウト設定
      const timeoutMs = options?.timeout || this.timeout;
      const translationPromise = this.translatorPipeline(text, {
        max_length: 512,
      });

      const result = await this.withTimeout(translationPromise, timeoutMs);
      const responseTime = Date.now() - startTime;

      // Transformers.jsの出力形式: [{ translation_text: "..." }]
      const translatedText = this.extractTranslation(result, text);

      return {
        text: translatedText,
        model: this.model,
        responseTime,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error('Translation timeout');
        }
        throw new Error(`Translation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * プロバイダが利用可能かチェック
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Transformers.jsは常に利用可能（モデルがなければ自動ダウンロード）
      return true;
    } catch {
      return false;
    }
  }

  /**
   * パイプラインを初期化（初回のみ実行）
   */
  private async initializePipeline(): Promise<void> {
    // 既に初期化中の場合は待機
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    this.isInitializing = true;

    try {
      // 初回はモデルダウンロードのため時間がかかる（約300MB）
      // 2回目以降はキャッシュから読み込むため高速
      const restoreWarn = this.quiet ? this.suppressTokenizerWarning() : null;

      try {
        const { pipeline } = await this.ensureTransformersModule();

        this.translatorPipeline = await pipeline(
          'translation',
          this.model,
          {
            // 進捗表示を有効化（初回ダウンロード時）
            progress_callback: (progress: any) => {
              if (this.quiet) {
                return;
              }

              if (progress.status === 'downloading') {
                const percent = progress.progress
                  ? Math.round(progress.progress)
                  : 0;
                process.stderr.write(
                  `\rDownloading model... ${percent}% (${progress.file})`
                );
              } else if (progress.status === 'done') {
                process.stderr.write('\rModel ready!                    \n');
              }
            },
          }
        );
      } finally {
        if (restoreWarn) {
          restoreWarn();
        }
      }
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Promiseにタイムアウトを設定
   */
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

  /**
   * Transformers.jsの出力から翻訳結果を抽出
   */
  private extractTranslation(result: unknown, fallback: string): string {
    // 型ガードで安全に配列とオブジェクトをチェック
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

  /**
   * ONNX Runtimeのログレベルを設定
   */
  private configureOnnxLogLevel(module: TransformersModule): void {
    if (!this.logLevel) {
      return;
    }

    const onnxEnv = (module.env as any)?.backends?.onnx;
    if (!onnxEnv) {
      return;
    }

    try {
      if (typeof onnxEnv.logLevel !== 'undefined') {
        onnxEnv.logLevel = this.logLevel;
      }
    } catch {
      // ログレベル設定に失敗しても致命的ではないので無視
    }
  }

  private async ensureTransformersModule(): Promise<TransformersModule> {
    if (this.transformersModule) {
      return this.transformersModule;
    }

    const module = await loadTransformersModule(this.logLevel);
    this.configureOnnxLogLevel(module);
    this.transformersModule = module;
    return module;
  }

  /**
   * 特定のTokenizer警告を抑制
   */
  private suppressTokenizerWarning(): (() => void) {
    const originalWarn = console.warn;
    const pattern = /`MarianTokenizer` is not yet supported/;

    console.warn = (...args: Parameters<typeof console.warn>) => {
      if (args.length > 0 && typeof args[0] === 'string' && pattern.test(args[0])) {
        return;
      }
      originalWarn(...args);
    };

    return () => {
      console.warn = originalWarn;
    };
  }

  /**
   * onnxruntimeからの警告ログを抑制（静音モード時）
   */
  private suppressOnnxRuntimeWarnings(): void {
    if (this.restoreStderrWrite) {
      return;
    }

    const originalWrite = process.stderr.write.bind(process.stderr);
    const pattern = /\[W:onnxruntime:/;

    const quietWrite: typeof process.stderr.write = (chunk: any, encoding?: any, callback?: any) => {
      const message = this.normalizeChunk(chunk, encoding);
      if (message && pattern.test(message)) {
        if (typeof callback === 'function') {
          callback();
        }
        return true;
      }

      return originalWrite(chunk, encoding as any, callback);
    };

    process.stderr.write = quietWrite;
    this.restoreStderrWrite = () => {
      process.stderr.write = originalWrite;
    };
  }

  private normalizeChunk(chunk: any, encoding?: BufferEncoding): string {
    if (typeof chunk === 'string') {
      return chunk;
    }
    if (Buffer.isBuffer(chunk)) {
      return chunk.toString(encoding ?? 'utf8');
    }
    return '';
  }
}
