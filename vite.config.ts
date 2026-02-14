import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

// Figma plugins need EVERYTHING inlined into a single HTML file.
// The 'code.js' (sandbox) is built separately.
export default defineConfig({
    plugins: [react(), viteSingleFile()],
    root: path.resolve(__dirname, 'src/ui'),
    build: {
        target: 'esnext',
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: 'ui.js',
            },
        },
    },
});
