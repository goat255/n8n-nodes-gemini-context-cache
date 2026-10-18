import { createHash } from 'crypto';

/**
 * Gemini caches are immutable except for their expiry, so "the catalog changed" can only be
 * answered by comparing content. We fingerprint what goes into a cache and carry the fingerprint
 * in the displayName, which lets Get or Create find a matching cache with one list call and no
 * external store.
 */

export interface CacheSummary {
	name: string;
	model: string;
	displayName?: string;
	expireTime: string;
	createTime?: string;
	usageMetadata?: { totalTokenCount?: number };
}

export interface PolicyOptions {
	/** TTL to set when a cache is created or extended. */
	ttlSeconds: number;
	/** A cache with less life left than this should not be handed to a caller as-is. */
	minRemainingSeconds: number;
}

export type CacheDecision =
	| { action: 'reuse'; cache: CacheSummary }
	| { action: 'extend'; cache: CacheSummary }
	| { action: 'create' };

const DISPLAY_NAME_MAX = 128;
const FINGERPRINT_LENGTH = 16;
const FINGERPRINT_PATTERN = /\[([0-9a-f]{16})\]$/;

export function fingerprint(model: string, systemInstruction: unknown, contents: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify({ model: normaliseModel(model), systemInstruction, contents }))
		.digest('hex')
		.slice(0, FINGERPRINT_LENGTH);
}

export function buildDisplayName(label: string, fp: string): string {
	const suffix = ` [${fp}]`;
	return `${label.trim().slice(0, DISPLAY_NAME_MAX - suffix.length)}${suffix}`;
}

export function readFingerprint(displayName: string | undefined): string | undefined {
	return displayName?.match(FINGERPRINT_PATTERN)?.[1];
}

export function normaliseModel(model: string): string {
	return model.startsWith('models/') ? model : `models/${model}`;
}

export function remainingSeconds(cache: CacheSummary, nowMs: number): number {
	return Math.floor((Date.parse(cache.expireTime) - nowMs) / 1000);
}

/** Caches built from the same model and the same content as the one being requested. */
export function matchingCaches(caches: CacheSummary[], model: string, fp: string): CacheSummary[] {
	const wanted = normaliseModel(model);
	return caches.filter((c) => c.model === wanted && readFingerprint(c.displayName) === fp);
}

/**
 * Decide what Get or Create should do, given the caches that already match the requested
 * model and content. `candidates` may be empty, may hold several caches (two executions that
 * raced each other), and may include caches that are about to expire.
 *
 * Trade-off: Gemini bills cache storage per token-hour, so extending a cache costs money even
 * when nobody calls it, while re-creating one re-pays the full input cost of the catalog once.
 */
export function decideCacheAction(
	candidates: CacheSummary[],
	nowMs: number,
	options: PolicyOptions,
): CacheDecision {
	// Expired caches cannot be revived; among the live ones, the longest-lived wins a race.
	const live = candidates
		.map((cache) => ({ cache, left: remainingSeconds(cache, nowMs) }))
		.filter(({ left }) => left > 0)
		.sort((a, b) => b.left - a.left);

	if (live.length === 0) return { action: 'create' };

	const { cache, left } = live[0];
	// Extending costs one PATCH plus storage; re-creating re-pays the whole input once.
	return left >= options.minRemainingSeconds ? { action: 'reuse', cache } : { action: 'extend', cache };
}
