import { defineConfig } from 'tsup';

export default defineConfig({
  // エントリーポイント: CLIとワーカー
  entry: {
    'entry/eecho': 'src/entry/eecho.ts',
    'entry/translate-worker': 'src/entry/translate-worker.ts',
  },
  // ESM形式で出力
  format: ['esm'],
  // 出力ディレクトリ
  outDir: 'dist',
  // shebangを保持（CLI実行用）
  shims: true,
  // 外部依存をバンドルしない（node_modulesから読み込む）
  external: [
    '@xenova/transformers',
    'clipboardy',
    /^node:/,
  ],
  // ソースマップ生成
  sourcemap: false,
  // コード分割を無効化（単一ファイル出力）
  splitting: false,
  // 型定義ファイルは生成しない
  dts: false,
  // クリーンビルド
  clean: true,
  // Node.js環境向け
  platform: 'node',
  // ターゲットバージョン
  target: 'node18',
  // esbuildオプション
  esbuildOptions(options) {
    options.mainFields = ['module', 'main'];
  },
});

