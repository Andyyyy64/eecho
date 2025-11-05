#!/usr/bin/env node

/**
 * eecho CLI エントリポイント
 */

import { readFileSync } from 'node:fs';
import { stdin, stdout, stderr } from 'node:process';
import { Translator } from '../core/translator.js';
import { copyToClipboard } from '../services/clipboard.js';

/**
 * stdinからテキストを読み取る
 */
async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';

        stdin.setEncoding('utf-8');

        stdin.on('data', (chunk: string) => {
            data += chunk;
        });

        stdin.on('end', () => {
            resolve(data);
        });

        stdin.on('error', (error: Error) => {
            reject(error);
        });
    });
}

/**
 * エラーメッセージを出力して終了
 */
function exitWithError(message: string, code = 1): void {
    stderr.write(`Error: ${message}\n`);
    process.exit(code);
}

/**
 * 使用方法を表示
 */
function showUsage(): void {
    const usage = ``;

    stdout.write(usage);
}

/**
 * バージョンを表示
 */
function showVersion(): void {
    try {
        // package.jsonからバージョンを読み取る
        const packageJsonPath = new URL('../../package.json', import.meta.url);
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        stdout.write(`eecho v${packageJson.version}\n`);
    } catch {
        stdout.write('eecho (version unknown)\n');
    }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // ヘルプ表示
    if (args.includes('-h') || args.includes('--help')) {
        showUsage();
        process.exit(0);
    }

    // バージョン表示
    if (args.includes('-v') || args.includes('--version')) {
        showVersion();
        process.exit(0);
    }

    let inputText = '';

    // stdinから入力があるかチェック
    if (!stdin.isTTY) {
        // パイプやリダイレクトから入力
        inputText = await readStdin();
    } else if (args.length > 0) {
        // コマンドライン引数から入力
        inputText = args.join(' ');
    } else {
        // 入力なし
        showUsage();
        process.exit(1);
    }

    inputText = inputText.trim();

    if (inputText.length === 0) {
        exitWithError('No input text provided');
    }

    try {
        // 翻訳を実行
        const translator = new Translator();
        const result = await translator.translate(inputText);

        if (!result.wasJapanese) {
            stderr.write('Warning: Input text does not contain Japanese\n');
        }

        // 翻訳結果を出力
        stdout.write(`${result.translatedText}\n`);

        // クリップボードにコピー
        const copied = await copyToClipboard(result.translatedText);
        if (copied) {
            stderr.write('✓ Copied to clipboard\n');
        } else {
            stderr.write('Warning: Failed to copy to clipboard\n');
        }
    } catch (error) {
        if (error instanceof Error) {
            exitWithError(error.message);
        } else {
            exitWithError('Unknown error occurred');
        }
    }
}

// エラーハンドリング
process.on('unhandledRejection', (error: unknown) => {
    stderr.write(`Unhandled error: ${error}\n`);
    process.exit(1);
});

process.on('SIGINT', () => {
    stderr.write('\nInterrupted\n');
    process.exit(130);
});

// 実行
main().catch((error) => {
    stderr.write(`Fatal error: ${error}\n`);
    process.exit(1);
});

