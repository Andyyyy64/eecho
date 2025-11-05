/**
 * 翻訳プロバイダの共通インターフェース
 * 異なる翻訳エンジン（Ollama、M2M100など）を統一的に扱うための抽象化
 */

/**
 * 翻訳リクエストのオプション
 */
export interface TranslateOptions {
  /** ソース言語（省略可、自動検出） */
  sourceLang?: string;
  /** ターゲット言語（省略可、デフォルトは英語） */
  targetLang?: string;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
  /** ストリーミング出力を有効にするか */
  stream?: boolean;
}

/**
 * 翻訳結果
 */
export interface TranslateResult {
  /** 翻訳されたテキスト */
  text: string;
  /** 検出されたソース言語 */
  detectedLang?: string;
  /** 使用されたモデル名 */
  model?: string;
  /** レスポンス時間（ミリ秒） */
  responseTime?: number;
}

/**
 * 翻訳プロバイダのインターフェース
 */
export interface TranslateProvider {
  /** プロバイダ名 */
  readonly name: string;

  /**
   * テキストを翻訳する
   * @param text 翻訳対象のテキスト
   * @param options 翻訳オプション
   * @returns 翻訳結果
   */
  translate(text: string, options?: TranslateOptions): Promise<TranslateResult>;

  /**
   * プロバイダが利用可能かチェック
   * @returns 利用可能であればtrue
   */
  isAvailable(): Promise<boolean>;
}

