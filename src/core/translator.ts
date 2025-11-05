/**
 * 翻訳パイプライン統括
 * 入力→検出→翻訳→出力の流れを管理
 */

import { detectJapanese } from '../utils/detectJapanese.js';
import { TransformersProvider } from '../providers/transformers.js';
import type { TranslateProvider } from '../providers/provider.js';

/**
 * 翻訳結果
 */
export interface TranslationOutput {
  /** 翻訳されたテキスト */
  translatedText: string;
  /** 元のテキスト */
  originalText: string;
  /** 日本語が検出されたか */
  wasJapanese: boolean;
  /** 使用されたプロバイダ名 */
  provider: string;
  /** 処理時間（ミリ秒） */
  duration: number;
}

/**
 * Translatorクラス
 * 翻訳の全体フローを管理する
 */
export class Translator {
  private provider: TranslateProvider;

  constructor(provider?: TranslateProvider) {
    // デフォルトはTransformersプロバイダを使用（追加セットアップ不要）
    this.provider = provider || new TransformersProvider();
  }

  /**
   * テキストを翻訳
   * 日本語を検出し、翻訳を実行
   */
  async translate(text: string): Promise<TranslationOutput> {
    const startTime = Date.now();

    // 空文字チェック
    if (!text || text.trim().length === 0) {
      throw new Error('Translation input cannot be empty');
    }

    const originalText = text.trim();

    // 日本語を検出
    const wasJapanese = detectJapanese(originalText);

    if (!wasJapanese) {
      // 日本語でない場合はそのまま返す
      return {
        translatedText: originalText,
        originalText,
        wasJapanese: false,
        provider: this.provider.name,
        duration: Date.now() - startTime,
      };
    }

    // プロバイダが利用可能かチェック
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      throw new Error(
        `Translation provider "${this.provider.name}" is not available. ` +
        'Please check your internet connection for the first run (model download required).'
      );
    }

    // 翻訳を実行
    const result = await this.provider.translate(originalText);

    return {
      translatedText: result.text,
      originalText,
      wasJapanese: true,
      provider: this.provider.name,
      duration: Date.now() - startTime,
    };
  }

  /**
   * プロバイダを変更
   */
  setProvider(provider: TranslateProvider): void {
    this.provider = provider;
  }

  /**
   * 現在のプロバイダを取得
   */
  getProvider(): TranslateProvider {
    return this.provider;
  }
}

