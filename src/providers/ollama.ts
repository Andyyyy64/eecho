/**
 * Ollama プロバイダ実装
 * ローカルで動作するOllama APIを使ってMistral 7B Instructで翻訳を行う
 */

import type {
  TranslateProvider,
  TranslateOptions,
  TranslateResult,
} from './provider.js';

/**
 * Ollama API のリクエスト形式
 */
interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  options?: {
    temperature?: number;
  };
}

/**
 * Ollama API のレスポンス形式
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Ollamaプロバイダの設定
 */
export interface OllamaConfig {
  /** Ollama APIのベースURL */
  baseUrl?: string;
  /** 使用するモデル名 */
  model?: string;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
}

/**
 * Ollamaプロバイダ
 */
export class OllamaProvider implements TranslateProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;
  private timeout: number;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl || 'http://localhost:11434';
    this.model = config?.model || 'mistral:instruct';
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

    // 翻訳プロンプトを構築
    const prompt = this.buildPrompt(text, options);

    try {
      const requestBody: OllamaGenerateRequest = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3, // 翻訳は一貫性重視で低めに設定
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        options?.timeout || this.timeout
      );

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const responseTime = Date.now() - startTime;

      // レスポンスから翻訳結果を抽出してクリーンアップ
      const translatedText = this.cleanupResponse(data.response);

      return {
        text: translatedText,
        model: this.model,
        responseTime,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Translation timeout');
        }
        throw new Error(`Translation failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Ollamaが利用可能かチェック
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 翻訳プロンプトを構築
   */
  private buildPrompt(text: string, options?: TranslateOptions): string {
    const targetLang = options?.targetLang || 'English';

    return `Translate the following Japanese text to ${targetLang}. Output only the translation, without any explanations, quotes, or additional text.

Japanese: ${text}

${targetLang}:`;
  }

  /**
   * APIレスポンスをクリーンアップ
   * 余計な説明や引用符を削除して純粋な翻訳結果のみを返す
   */
  private cleanupResponse(response: string): string {
    let cleaned = response.trim();

    // 引用符で囲まれている場合は除去
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1);
    }

    // 先頭の「Translation:」「English:」などのラベルを除去
    cleaned = cleaned.replace(/^(Translation|English|Output):\s*/i, '');

    return cleaned.trim();
  }
}

