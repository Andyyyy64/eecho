import { readFileSync } from 'node:fs';
import type { WriteStream } from 'node:tty';

export interface VersionOptions {
    packageJsonPath: string;
}

export function showVersion(output: WriteStream, options: VersionOptions): void {
    output.write(formatVersion(options) + '\n');
}

export function formatVersion(options: VersionOptions): string {
    try {
        const packageJson = JSON.parse(readFileSync(options.packageJsonPath, 'utf-8'));
        return `eecho v${packageJson.version}`;
    } catch {
        return 'eecho (version unknown)';
    }
}

