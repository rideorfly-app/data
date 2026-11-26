import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],

		// A report, not a pass mark: no thresholds, so it never fails a build.
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			reporter: ['text', ['text', { file: 'coverage.txt' }]],
		},
	},
});
