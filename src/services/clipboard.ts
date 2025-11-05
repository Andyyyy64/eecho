/**
 * クリップボード操作サービス
 * clipboardyを使用してクロスプラットフォーム対応
 */

import clipboardy from 'clipboardy';

/**
 * テキストをクリップボードにコピー
 * @param text コピーするテキスト
 * @returns 成功したらtrue、失敗したらfalse
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await clipboardy.write(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * クリップボードからテキストを読み取り
 * @returns クリップボードのテキスト
 */
export async function readFromClipboard(): Promise<string> {
  try {
    return await clipboardy.read();
  } catch (error) {
    console.error('Failed to read from clipboard:', error);
    return '';
  }
}

/**
 * クリップボードが利用可能かチェック
 * @returns 利用可能ならtrue
 */
export async function isClipboardAvailable(): Promise<boolean> {
  try {
    // 空文字を書き込んでテスト
    await clipboardy.write('');
    return true;
  } catch {
    return false;
  }
}

