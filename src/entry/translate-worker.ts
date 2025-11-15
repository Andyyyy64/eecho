import { stdout, stderr } from 'node:process';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import { watch } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Translator } from '../core/translator';
import { TransformersProvider } from '../providers/transformers';

interface WorkerRequest {
    text?: string;
    quiet?: boolean;
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
    command?: 'shutdown';
    id?: string;
}

interface WorkerResponse {
    ok: boolean;
    result?: Awaited<ReturnType<Translator['translate']>>;
    error?: string;
}

// CLI本体とは別プロセスで、リクエスト/レスポンスファイルを監視し続ける。
const workerDebug = process.env.EECHO_WORKER_DEBUG === '1';
const DEFAULT_QUEUE_DIR = path.join(tmpdir(), 'eecho-worker');
const REQUEST_PREFIX = 'req-';
const RESPONSE_PREFIX = 'res-';
const FILE_EXT = '.json';
const PID_FILE = 'worker.pid';

let sharedTranslator: Translator | null = null;

async function getTranslator(): Promise<Translator> {
    if (!sharedTranslator) {
        sharedTranslator = new Translator(
            new TransformersProvider({ quiet: true, logLevel: 'fatal' })
        );
    }
    return sharedTranslator;
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
    if (request.command === 'shutdown') {
        setImmediate(() => {
            if (workerDebug) {
                stderr.write('Worker shutting down\n');
            }
            process.exit(0);
        });
        return { ok: true };
    }

    const text = request.text?.trim();
    if (!text) {
        return { ok: false, error: 'No input text provided' };
    }

    const translator = await getTranslator();
    const result = await translator.translate(text);
    return { ok: true, result };
}

async function writeResponse(
    queueDir: string,
    requestId: string,
    response: WorkerResponse
): Promise<void> {
    const responsePath = path.join(
        queueDir,
        `${RESPONSE_PREFIX}${requestId}${FILE_EXT}`
    );
    await fs.writeFile(responsePath, JSON.stringify(response), 'utf8');
}

async function processRequestFile(queueDir: string, file: string): Promise<void> {
    const requestPath = path.join(queueDir, file);
    try {
        const raw = await fs.readFile(requestPath, 'utf8');
        await fs.unlink(requestPath).catch(() => undefined);
        const request = JSON.parse(raw) as WorkerRequest;
        if (!request.id) {
            throw new Error('Missing request id');
        }
        const response = await handleRequest(request);
        await writeResponse(queueDir, request.id, response);
        if (request.command === 'shutdown') {
            await fs.unlink(path.join(queueDir, PID_FILE)).catch(() => undefined);
            setImmediate(() => process.exit(0));
        }
    } catch (error) {
        if (workerDebug) {
            stderr.write(`Failed processing ${file}: ${error}\n`);
        }
    }
}

async function startQueueWorker(queueDir: string): Promise<void> {
    // ファイルシステムの監視 + 定期スキャンで、複数CLIからのリクエストを
    // 1プロセスで逐次処理する。PIDファイルは生存確認に使われる。
    await fs.mkdir(queueDir, { recursive: true });
    await fs.writeFile(
        path.join(queueDir, PID_FILE),
        String(process.pid),
        'utf8'
    );

    const processing = new Set<string>();

    const scanQueue = async () => {
        const entries = await fs.readdir(queueDir);
        for (const entry of entries) {
            if (!entry.startsWith(REQUEST_PREFIX) || !entry.endsWith(FILE_EXT)) {
                continue;
            }
            if (processing.has(entry)) {
                continue;
            }
            processing.add(entry);
            processRequestFile(queueDir, entry)
                .catch((error) => {
                    if (workerDebug) {
                        stderr.write(`Queue error: ${error}\n`);
                    }
                })
                .finally(() => processing.delete(entry));
        }
    };

    await scanQueue();
    watch(queueDir, () => {
        scanQueue().catch((error) => {
            if (workerDebug) {
                stderr.write(`Watch error: ${error}\n`);
            }
        });
    });
    setInterval(() => {
        scanQueue().catch((error) => {
            if (workerDebug) {
                stderr.write(`Interval scan error: ${error}\n`);
            }
        });
    }, 500).unref();
}

async function runSingleRequest(): Promise<void> {
    const encoded = process.argv[2];
    if (!encoded) {
        throw new Error('Missing worker payload');
    }
    const outputPath = process.argv[3];

    // 単発実行モード（従来CLIとの互換用）。Base64ではなく素のJSONを受け取る。
    const payload = Buffer.from(encoded, 'utf8').toString('utf8');
    const request = JSON.parse(payload) as WorkerRequest;
    const response = await handleRequest(request);

    if (outputPath) {
        await fs.writeFile(outputPath, JSON.stringify(response), 'utf8');
    } else {
        stdout.write(`${JSON.stringify(response)}\n`);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args[0] === '--queue') {
        const dir = args[1] || DEFAULT_QUEUE_DIR;
        await startQueueWorker(dir);
        return;
    }

    await runSingleRequest();
}

main().catch((error) => {
    const message =
        error instanceof Error && error.message
            ? error.message
            : 'Unknown fatal error';
    stderr.write(`Fatal error: ${message}\n`);
    process.exit(1);
});
