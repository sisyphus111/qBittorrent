import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createHash } from 'node:crypto';

export default defineConfig({
    plugins: [vue(), {
        name: 'version-embedded-assets',
        transformIndexHtml: {
            order: 'post',
            handler(html, context) {
                // Resource aliases stay stable for Qt; URLs change when their content does.
                for (const output of Object.values(context.bundle || {})) {
                    if (!/\.(js|css)$/.test(output.fileName)) continue;
                    const content = output.type === 'chunk' ? output.code : output.source;
                    const version = createHash('sha256').update(content).digest('hex').slice(0, 12);
                    html = html.replaceAll(`"./${output.fileName}"`, `"./${output.fileName}?v=${version}"`);
                }
                return html;
            },
        },
    }],
    base: './',
    build: {
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: 'modern/assets/app.js',
                assetFileNames: 'modern/assets/app.[ext]',
                inlineDynamicImports: true,
            },
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        proxy: {
            '/images': { target: 'http://127.0.0.1:8080', changeOrigin: true },
            '/api': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
                configure(proxy) {
                    proxy.on('proxyReq', (request) => {
                        request.setHeader('Origin', 'http://127.0.0.1:8080');
                        request.setHeader('Referer', 'http://127.0.0.1:8080/');
                    });
                },
            },
        },
    },
});
