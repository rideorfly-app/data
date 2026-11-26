import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const workflow = (name: string) => readFile(join(root, '.github', 'workflows', name), 'utf8');

describe('the workflows', () => {
	it('offer every job in the Run workflow dropdown, and no job that is not there', async () => {
		const options = (await workflow('job.yml')).match(/options:\n((?:\s+- .+\n)+)/)?.[1] ?? '';
		const listed = [...options.matchAll(/- (\S+)/g)].map((match) => match[1]);
		const jobs = (await readdir(join(root, 'src'), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && entry.name !== 'lib')
			.map((entry) => entry.name);

		expect(listed.sort()).toEqual(jobs.sort());
	});

	it('pin every action to a commit, so a changed tag can’t change what runs', async () => {
		for (const name of ['daily.yml', 'job.yml', 'release.yml', 'tests.yml']) {
			const uses = [...(await workflow(name)).matchAll(/uses: (\S+)/g)].map((match) => match[1]);

			for (const action of uses) {
				expect(action, `${name}: ${action}`).toMatch(
					/^(\.\/\.github\/workflows\/\S+|\S+@[0-9a-f]{40})$/,
				);
			}
		}
	});

	it('never paste an input into a script, where it could run as a command', async () => {
		for (const name of ['job.yml', 'release.yml']) {
			const scripts = [
				...(await workflow(name)).matchAll(/run: [|>]?[\s\S]*?(?=\n\s+- |\n\S|$)/g),
			].map((match) => match[0]);

			for (const script of scripts) {
				expect(script, `${name}: ${script}`).not.toMatch(/\$\{\{\s*(inputs|steps|github\.event)/);
			}
		}
	});
});
