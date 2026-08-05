import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['tests/**/*.test.{js,jsx}'],
        setupFiles: ['tests/setup.js'],
    },
});
