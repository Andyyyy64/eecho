import type { WriteStream } from 'node:tty';

export interface UsageOptions {
    workerDir: string;
}

export function showUsage(output: WriteStream, options: UsageOptions): void {
    output.write(formatUsage(options) + '\n');
}

export function formatUsage(options: UsageOptions): string {
    return `
NAME
    eecho - Offline Japanese-to-English translation CLI tool

USAGE
    eecho [options] <text>
    <command> | eecho [options]

DESCRIPTION
    Translate Japanese text to English using a local transformer model.
    First run downloads ~300MB model automatically.

OPTIONS
    -h, --help              Display this help message
    -v, --version           Display version information
    --verbose               Show detailed logs (model download progress, warnings)
    --shutdown-worker       Shutdown background translation worker

EXAMPLES
    Basic translation:
        $ eecho こんにちは
        Hello

    Long text (use quotes):
        $ eecho "今日はいい天気ですね"
        It's nice weather today

    From pipe:
        $ echo "ありがとうございます" | eecho
        Thank you very much

    With detailed logs:
        $ eecho --verbose こんにちは

BACKGROUND WORKER
    eecho spawns a background Node.js process to keep the translation model
    loaded in memory, providing faster responses for subsequent translations.

    Worker directory: ${options.workerDir}

    To stop the worker:
        $ eecho --shutdown-worker

ENVIRONMENT VARIABLES
    EECHO_VERBOSE=1         Enable verbose logging
    EECHO_WORKER_DIR        Custom worker queue directory (default: /tmp/eecho-worker)
    EECHO_DEBUG=1           Enable worker debug output

NOTES
    - Model: Helsinki-NLP/opus-mt-ja-en (~300MB, downloaded once)
    - Cache: ~/.cache/huggingface/
    - Requires: Node.js >= 18.0.0
    - Internet connection needed only for first run

For more information, visit: https://github.com/Andyyyy64/eecho
`.trim();
}

