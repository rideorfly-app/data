import { describe, expect, it } from 'vitest';
import { checkedEngine, installedEngine, pinnedEngine } from '../../src/accuracy/engine.ts';

const commit = '020adef5351edb33e361503c4ef07d65edb1a3e8';
const pin = `github:rideorfly-app/engine#${commit}`;

// What npm records for an engine installed from GitHub, from a local folder,
// and (later) from npm.
const fromGitHub = {
	version: '0.1.0',
	resolved: `git+ssh://git@github.com/rideorfly-app/engine.git#${commit}`,
};
const linked = { resolved: '../engine', link: true };
const fromNpm = {
	version: '1.2.0',
	resolved: 'https://registry.npmjs.org/@rideorfly/engine/-/engine-1.2.0.tgz',
};

describe('pinnedEngine', () => {
	it('names a pinned commit by its first seven characters, and a version as it is', () => {
		expect(pinnedEngine(pin)).toBe('020adef');
		expect(pinnedEngine('1.2.0')).toBe('1.2.0');
	});
});

describe('installedEngine', () => {
	it('reads the commit npm installed, or the version from npm', () => {
		expect(installedEngine(fromGitHub)).toBe('020adef');
		expect(installedEngine(fromNpm)).toBe('1.2.0');
	});

	it('has no answer for a linked folder or a missing record', () => {
		expect(installedEngine(linked)).toBeNull();
		expect(installedEngine(undefined)).toBeNull();
	});
});

describe('checkedEngine', () => {
	it('names the engine when the installed one is the pinned one', () => {
		expect(checkedEngine(pin, fromGitHub)).toBe('020adef');
		expect(checkedEngine('1.2.0', fromNpm)).toBe('1.2.0');
	});

	it('refuses when a different commit is installed', () => {
		const older = {
			...fromGitHub,
			resolved: 'git+ssh://git@github.com/rideorfly-app/engine.git#957239b8acace9a6',
		};

		expect(() => checkedEngine(pin, older)).toThrow(
			/would name engine 020adef, but node_modules holds 957239b/,
		);
	});

	it('refuses a local copy linked in for testing, the case that mislabeled reports', () => {
		expect(() => checkedEngine(pin, linked)).toThrow(/local link/);
	});

	it('refuses when npm has no record of the engine', () => {
		expect(() => checkedEngine(pin, undefined)).toThrow(/Run npm install/);
	});

	it('refuses when the version from npm is not the one pinned', () => {
		expect(() => checkedEngine('1.3.0', fromNpm)).toThrow(
			/engine 1\.3\.0, but node_modules holds 1\.2\.0/,
		);
	});
});
