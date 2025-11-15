import { defineConfig } from 'tsup';

export default defineConfig({
  // エントリーポイント: CLIとワーカー
  entry: {
    'entry/eecho': 'src/entry/eecho.ts',
    'entry/translate-worker': 'src/entry/translate-worker.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  shims: true,
  external: [
    '@xenova/transformers',
    'clipboardy',
    /^node:/,
  ],
  sourcemap: false,
  splitting: false,
  dts: false,
  clean: true,
  platform: 'node',
  target: 'node18',
  esbuildOptions(options) {
    options.mainFields = ['module', 'main'];
  },
});

