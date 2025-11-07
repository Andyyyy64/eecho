#!/usr/bin/env node

import '../config/onnxEnv.js';

import { stdin, stdout, stderr } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { Translator } from '../core/translator.js';
import { TransformersProvider } from '../providers/transformers.js';
import type { TranslationOutput } from '../core/translator.js';
import { showUsage, showVersion } from '../utils/cli/index.js';

interface CliOptions {
    verbose: boolean;
    shutdownWorker?: boolean;
}

interface WorkerRequestPayload {
    id?: string;
    text?: string;
    command?: 'shutdown';
}

interface WorkerResponse {
    ok: boolean;
    result?: TranslationOutput;
    error?: string;
}

interface TranslatorCacheEntry {
    translator: Translator;
    quiet: boolean;
}

// バックグラウンド翻訳ワーカーのスクリプトパス
const workerScriptPath = fileURLToPath(new URL('./translate-worker.js', import.meta.url));
const workerDir = process.env.EECHO_WORKER_DIR || path.join(tmpdir(), 'eecho-worker');
const pidPath = path.join(workerDir, 'worker.pid');
const REQUEST_PREFIX = 'req-';
const RESPONSE_PREFIX = 'res-';
const FILE_EXT = '.json';
const workerDebugEnabled = process.env.EECHO_DEBUG === '1';
// quiet / verbose 切替でTranslatorを使い分けるための簡易キャッシュ
const translatorCache: TranslatorCacheEntry[] = [];
const onnxWarningPattern = /\[W:onnxruntime:/;

async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        stdin.setEncoding('utf-8');
        stdin.on('data', (chunk: string) => {
            data += chunk;
        });
        stdin.on('end', () => resolve(data));
        stdin.on('error', (error: Error) => reject(error));
    });
}

function exitWithError(message: string, code = 1): void {
    stderr.write(`Error: ${message}\n`);
    process.exit(code);
}

function parseCliArgs(rawArgs: string[]): { args: string[]; options: CliOptions } {
    let verbose = false;
    let shutdownWorker = false;

    const envVerbose = process.env.EECHO_VERBOSE;
    if (
        typeof envVerbose === 'string' &&
        ['1', 'true', 'on'].includes(envVerbose.toLowerCase())
    ) {
        verbose = true;
    }

    const args: string[] = [];
    for (const arg of rawArgs) {
        if (arg === '--verbose') {
            verbose = true;
            continue;
        }
        if (arg === '--shutdown-worker') {
            shutdownWorker = true;
            continue;
        }
        args.push(arg);
    }

    return { args, options: { verbose, shutdownWorker } };
}

function suppressOnnxWarnings(): () => void {
    const originalWrite = process.stderr.write.bind(process.stderr);

    const quietWrite: typeof process.stderr.write = (chunk: any, encoding?: any, callback?: any) => {
        const message = normalizeChunk(chunk, encoding);
        if (message && onnxWarningPattern.test(message)) {
            if (typeof callback === 'function') {
                callback();
            }
            return true;
        }
        return originalWrite(chunk, encoding as any, callback);
    };

    process.stderr.write = quietWrite;
    return () => {
        process.stderr.write = originalWrite;
    };
}

function normalizeChunk(chunk: any, encoding?: BufferEncoding): string {
    if (typeof chunk === 'string') {
        return chunk;
    }
    if (Buffer.isBuffer(chunk)) {
        return chunk.toString(encoding ?? 'utf8');
    }
    return '';
}

function getTranslator(quiet: boolean): Translator {
    const cached = translatorCache.find((entry) => entry.quiet === quiet);
    if (cached) {
        return cached.translator;
    }

    const translator = new Translator(
        new TransformersProvider({ quiet, logLevel: quiet ? 'fatal' : 'warning' })
    );
    translatorCache.push({ translator, quiet });
    return translator;
}

async function translateLocally(
    text: string,
    options: CliOptions
): Promise<TranslationOutput> {
    const quiet = !options.verbose;
    const translator = getTranslator(quiet);
    return translator.translate(text.trim());
}

function randomRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function ensureWorkerDir(): Promise<void> {
    await mkdir(workerDir, { recursive: true });
}

async function readPid(): Promise<number | null> {
    try {
        const pidRaw = await readFile(pidPath, 'utf8');
        const pid = Number(pidRaw.trim());
        if (Number.isFinite(pid)) {
            return pid;
        }
        return null;
    } catch {
        return null;
    }
}

async function isWorkerAlive(): Promise<boolean> {
    const pid = await readPid();
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        await unlink(pidPath).catch(() => undefined);
        return false;
    }
}

async function spawnWorker(): Promise<void> {
    await ensureWorkerDir();
    const child = spawn(process.execPath, [workerScriptPath, '--queue', workerDir], {
        detached: true,
        stdio: workerDebugEnabled ? 'inherit' : 'ignore',
    });
    child.unref();
}

async function waitForWorkerReady(timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isWorkerAlive()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Worker failed to start');
}

async function ensureWorkerRunning(): Promise<void> {
    // 既存ワーカーが死んでいたら再起動する。起動完了まで待ってから戻す。
    if (await isWorkerAlive()) {
        return;
    }
    await spawnWorker();
    await waitForWorkerReady();
}

async function waitForResponseFile(
    responsePath: string,
    timeoutMs = 60000
): Promise<WorkerResponse> {
    // 応答ファイルが生成されるまでポーリングする。ENOENT以外のエラーは即時伝播。
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const raw = await readFile(responsePath, 'utf8');
            await unlink(responsePath).catch(() => undefined);
            return JSON.parse(raw) as WorkerResponse;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error('Worker response timeout');
}

async function queueWorkerRequest(payload: WorkerRequestPayload): Promise<WorkerResponse> {
    await ensureWorkerDir();
    const id = randomRequestId();
    const requestPath = path.join(workerDir, `${REQUEST_PREFIX}${id}${FILE_EXT}`);
    const responsePath = path.join(workerDir, `${RESPONSE_PREFIX}${id}${FILE_EXT}`);
    await writeFile(requestPath, JSON.stringify({ ...payload, id }), 'utf8');
    await ensureWorkerRunning();
    return waitForResponseFile(responsePath);
}

async function requestTranslationThroughWorker(
    text: string
): Promise<TranslationOutput> {
    // 1回目で失敗したら即座に例外を投げ、呼び出し側でローカル実行に切り替える。
    const response = await queueWorkerRequest({ text });
    if (!response.ok || !response.result) {
        throw new Error(response.error || 'Translation failed');
    }
    return response.result;
}

async function shutdownWorkerProcess(): Promise<void> {
    const alive = await isWorkerAlive();
    if (!alive) {
        throw new Error('Worker is not running');
    }
    const response = await queueWorkerRequest({ command: 'shutdown' });
    if (!response.ok) {
        throw new Error(response.error || 'Failed to shutdown worker');
    }
}

async function runTranslation(
    text: string,
    options: CliOptions
): Promise<TranslationOutput> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        throw new Error('Translation input cannot be empty');
    }

    if (options.verbose) {
        // verbose = true の場合は、ユーザーが意図的に詳細ログを見たいので
        // 既存のローカルTranslatorを使ってそのままstderrに流す。
        return translateLocally(trimmed, options);
    }

    try {
        return await requestTranslationThroughWorker(trimmed);
    } catch (error) {
        if (workerDebugEnabled) {
            stderr.write(`Worker error (${error}). Falling back to local translation.\n`);
        }
        // ワーカーが忙しい/死んでいるなどで失敗したら、ユーザー体験を優先して
        // 同期的にローカル翻訳する。
        return translateLocally(trimmed, { ...options, verbose: false });
    }
}

async function main(): Promise<void> {
    const rawArgs = process.argv.slice(2);
    const { args, options } = parseCliArgs(rawArgs);

    if (options.shutdownWorker) {
        try {
            await shutdownWorkerProcess();
            stdout.write('Worker shutdown complete.\n');
        } catch (error) {
            if (error instanceof Error) {
                exitWithError(error.message, 1);
            } else {
                exitWithError('Failed to shutdown worker', 1);
            }
        }
        return;
    }

    if (args.includes('-h') || args.includes('--help')) {
        showUsage(stdout, { workerDir });
        process.exit(0);
    }

    if (args.includes('-v') || args.includes('--version')) {
        const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
        showVersion(stdout, { packageJsonPath });
        process.exit(0);
    }

    let restoreLogger: (() => void) | null = null;
    if (!options.verbose) {
        restoreLogger = suppressOnnxWarnings();
    }

    let inputText = '';
    if (!stdin.isTTY) {
        inputText = await readStdin();
    } else if (args.length > 0) {
        inputText = args.join(' ');
    } else {
        showUsage(stdout, { workerDir });
        process.exit(1);
    }

    try {
        const result = await runTranslation(inputText, options);
        if (!result.wasJapanese && options.verbose) {
            stderr.write('Warning: Input text does not contain Japanese\n');
        }
        stdout.write(`${result.translatedText}\n`);
    } catch (error) {
        if (restoreLogger) {
            restoreLogger();
        }
        if (error instanceof Error) {
            exitWithError(error.message);
        } else {
            exitWithError('Unknown error occurred');
        }
    }
}

main().catch((error) => {
    stderr.write(`Fatal error: ${error}\n`);
    process.exit(1);
});
