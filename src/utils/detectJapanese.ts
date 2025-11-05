/**
 * 日本語を検出するユーティリティ
 * ひらがな、カタカナ、漢字のいずれかが含まれていればtrueを返す
 */

// ひらがな: U+3040 - U+309F
const HIRAGANA_REGEX = /[\u3040-\u309F]/;

// カタカナ: U+30A0 - U+30FF
const KATAKANA_REGEX = /[\u30A0-\u30FF]/;

// 漢字（CJK統合漢字）: U+4E00 - U+9FFF
const KANJI_REGEX = /[\u4E00-\u9FFF]/;

/**
 * テキストに日本語が含まれているかチェック
 * @param text チェック対象のテキスト
 * @returns 日本語が含まれていればtrue
 */
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

/**
 * テキストに含まれる日本語文字の割合を計算
 * @param text チェック対象のテキスト
 * @returns 0.0〜1.0の割合
 */
export function getJapaneseRatio(text: string): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  const chars = Array.from(text);
  const japaneseChars = chars.filter(
    (char) =>
      HIRAGANA_REGEX.test(char) ||
      KATAKANA_REGEX.test(char) ||
      KANJI_REGEX.test(char)
  );

  return japaneseChars.length / chars.length;
}

