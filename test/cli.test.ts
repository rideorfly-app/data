import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');
const run = (...args: string[]) => promisify(execFile)('node', [cli, ...args]);

describe('the command line', () => {
	it('lists every job as JSON, for the workflows to run one by one', async () => {
		const { stdout } = await run('--list');

		expect(JSON.parse(stdout)).toEqual([
			'accuracy',
			'airports',
			'flight-history',
			'gas-prices',
			'hand-kept',
			'per-diem',
			'places',
			'road-safety',
		]);
	});

	it('stops with the list of jobs when asked for one that is not there', async () => {
		await expect(run('nope', '--check')).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('Jobs: accuracy, airports'),
		});
	});

	it('says which update to make when none is named', async () => {
		await expect(run('gas-prices')).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('Say which update'),
		});
	});
});
