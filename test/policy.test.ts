import { describe, expect, it } from 'vitest';

import {
	buildDisplayName,
	type CacheSummary,
	decideCacheAction,
	fingerprint,
	matchingCaches,
	readFingerprint,
} from '../nodes/GeminiContextCache/policy';

const NOW = Date.parse('2026-10-18T10:00:00Z');
const OPTS = { ttlSeconds: 3600, minRemainingSeconds: 300 };

function cache(name: string, secondsLeft: number): CacheSummary {
	return {
		name: `cachedContents/${name}`,
		model: 'models/gemini-2.5-flash',
		displayName: 'catalog [0123456789abcdef]',
		expireTime: new Date(NOW + secondsLeft * 1000).toISOString(),
	};
}

describe('fingerprint', () => {
	const contents = [{ role: 'user', parts: [{ text: 'catalog v1' }] }];

	it('is stable and ignores the models/ prefix', () => {
		expect(fingerprint('gemini-2.5-flash', undefined, contents)).toBe(
			fingerprint('models/gemini-2.5-flash', undefined, contents),
		);
	});

	it('changes when the content changes', () => {
		const changed = [{ role: 'user', parts: [{ text: 'catalog v2' }] }];
		expect(fingerprint('gemini-2.5-flash', undefined, contents)).not.toBe(
			fingerprint('gemini-2.5-flash', undefined, changed),
		);
	});
});

describe('displayName', () => {
	it('round-trips the fingerprint and stays within 128 characters', () => {
		const name = buildDisplayName('x'.repeat(300), '0123456789abcdef');
		expect(name.length).toBeLessThanOrEqual(128);
		expect(readFingerprint(name)).toBe('0123456789abcdef');
	});

	it('only matches caches with the same model and fingerprint', () => {
		const other = { ...cache('b', 900), model: 'models/gemini-2.5-pro' };
		expect(matchingCaches([cache('a', 900), other], 'gemini-2.5-flash', '0123456789abcdef')).toHaveLength(1);
	});
});

describe('decideCacheAction', () => {
	it('creates when nothing matches', () => {
		expect(decideCacheAction([], NOW, OPTS)).toEqual({ action: 'create' });
	});

	it('reuses a cache with comfortable life left', () => {
		const c = cache('a', 1800);
		expect(decideCacheAction([c], NOW, OPTS)).toEqual({ action: 'reuse', cache: c });
	});

	it('extends a live cache that is about to expire instead of paying to rebuild it', () => {
		const c = cache('a', 60);
		expect(decideCacheAction([c], NOW, OPTS)).toEqual({ action: 'extend', cache: c });
	});

	it('creates when every match has already expired', () => {
		expect(decideCacheAction([cache('a', -5)], NOW, OPTS)).toEqual({ action: 'create' });
	});

	it('picks the longest-lived cache when two executions raced', () => {
		const short = cache('short', 400);
		const long = cache('long', 3000);
		expect(decideCacheAction([short, long], NOW, OPTS)).toEqual({ action: 'reuse', cache: long });
	});
});
