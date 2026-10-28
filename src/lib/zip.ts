import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Reads one text file inside a zip a line at a time. Streams through `unzip`,
 * so a 50 MB download never sits in memory. `member` is the file's path in the
 * zip, or a pattern such as `*.csv`.
 */
export async function* readZippedLines(zipPath: string, member: string): AsyncGenerator<string> {
	const unzip = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'pipe'] });
	const exited = new Promise<number | null>((resolve) => unzip.on('close', resolve));
	let complaint = '';

	unzip.stderr.on('data', (chunk: Buffer) => {
		complaint += chunk.toString();
	});

	for await (const line of createInterface({ input: unzip.stdout })) {
		yield line;
	}

	const code = await exited;

	if (code !== 0) {
		throw new Error(
			`unzip failed on ${zipPath} (exit code ${code}). Is the download complete?\n${complaint.trim()}`,
		);
	}
}
