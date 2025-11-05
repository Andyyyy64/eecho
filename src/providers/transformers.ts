/**
 * Transformers.js プロバイダ実装
 * @xenova/transformersを使ってNode.jsのみで完結する翻訳
 * 初回起動時に自動でモデルをダウンロード（~/.cache/huggingface/）
 */

import { pipeline, env } from '@xenova/transformers';
import type {
  TranslateProvider,
  TranslateOptions,
  TranslateResult,
} from './provider.js';

// Transformers.jsのキャッシュ設定
env.allowLocalModels = true;
env.allowRemoteModels = true;

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

  constructor(config?: TransformersConfig) {
    this.model = config?.model || 'Xenova/opus-mt-ja-en';
    this.timeout = config?.timeout || 30000; // 30秒
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
      this.translatorPipeline = await pipeline(
        'translation',
        this.model,
        {
          // 進捗表示を有効化（初回ダウンロード時）
          progress_callback: (progress: any) => {
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
}

