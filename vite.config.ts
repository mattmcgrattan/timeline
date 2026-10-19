import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';

  return {
    base: './',
    plugins: [react()],
    server: {
      port: 8003,
    },
    build: isLib
      ? {
          outDir: 'dist',
          lib: {
            entry: resolve(__dirname, 'src/lib.ts'),
            name: 'WellcomeTimeline',
            fileName: 'wellcome-timeline',
            formats: ['es', 'umd'],
          },
          rollupOptions: {
            external: ['react', 'react-dom'],
            output: {
              globals: {
                react: 'React',
                'react-dom': 'ReactDOM',
              },
            },
          },
        }
      : {
          outDir: 'docs',
          emptyOutDir: true,
        },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
