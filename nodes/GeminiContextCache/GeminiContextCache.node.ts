import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildDisplayName,
	type CacheSummary,
	decideCacheAction,
	fingerprint,
	matchingCaches,
	normaliseModel,
	remainingSeconds,
} from './policy';
import { CREDENTIAL, geminiRequest, listAll } from './transport';

const modelField = {
	displayName: 'Model Name or ID',
	name: 'model',
	type: 'options' as const,
	typeOptions: { loadOptionsMethod: 'getCacheableModels' },
	required: true,
	default: '',
	description:
		'Only models that support explicit caching are listed. A cache can only be used with the model it was created for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const cacheNameField = {
	displayName: 'Cache Name',
	name: 'cacheName',
	type: 'string' as const,
	required: true,
	default: '',
	placeholder: 'cachedContents/abc123',
	description: 'The cache resource name returned by Create or Get or Create',
};

export class GeminiContextCache implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Gemini Context Cache',
		name: 'geminiContextCache',
		icon: { light: 'file:geminiContextCache.svg', dark: 'file:geminiContextCache.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Cache large prompts in Gemini once and query them cheaply',
		defaults: { name: 'Gemini Context Cache' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: CREDENTIAL, required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Cache', value: 'cache' },
					{ name: 'Content', value: 'content' },
				],
				default: 'cache',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['cache'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a cache',
						description: 'Always create a new cache',
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a cache',
					},
					{
						name: 'Extend',
						value: 'extend',
						action: 'Extend a cache',
						description: 'Set a new TTL on an existing cache (expiry is the only mutable field)',
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a cache',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many caches',
					},
					{
						name: 'Get or Create',
						value: 'getOrCreate',
						action: 'Get or create a cache',
						description:
							'Reuse a live cache built from identical content, extend it, or create a new one when the content changed',
					},
				],
				default: 'getOrCreate',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['content'] } },
				options: [
					{
						name: 'Generate',
						value: 'generate',
						action: 'Generate content from a cache',
						description: 'Ask a question against cached content',
					},
				],
				default: 'generate',
			},

			// Create, Get or Create
			{
				...modelField,
				displayOptions: { show: { resource: ['cache'], operation: ['create', 'getOrCreate'] } },
			},
			{
				displayName: 'Label',
				name: 'label',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'insurance-catalog',
				description:
					'Human-readable name. A content fingerprint is appended so changed content never reuses a stale cache.',
				displayOptions: { show: { resource: ['cache'], operation: ['create', 'getOrCreate'] } },
			},
			{
				displayName: 'System Instruction',
				name: 'systemInstruction',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Cached together with the content. Text only.',
				displayOptions: { show: { resource: ['cache'], operation: ['create', 'getOrCreate'] } },
			},
			{
				displayName: 'Content Format',
				name: 'contentFormat',
				type: 'options',
				options: [
					{ name: 'Text', value: 'text', description: 'One block of text, for example a document catalog' },
					{
						name: 'Contents JSON',
						value: 'json',
						description: 'A raw Gemini contents array, for file URIs or multi-turn context',
					},
				],
				default: 'text',
				displayOptions: { show: { resource: ['cache'], operation: ['create', 'getOrCreate'] } },
			},
			{
				displayName: 'Content',
				name: 'contentText',
				type: 'string',
				typeOptions: { rows: 8 },
				required: true,
				default: '',
				displayOptions: {
					show: { resource: ['cache'], operation: ['create', 'getOrCreate'], contentFormat: ['text'] },
				},
			},
			{
				displayName: 'Contents',
				name: 'contentJson',
				type: 'json',
				required: true,
				default: '[{"role":"user","parts":[{"text":""}]}]',
				displayOptions: {
					show: { resource: ['cache'], operation: ['create', 'getOrCreate'], contentFormat: ['json'] },
				},
			},
			{
				displayName: 'TTL (Seconds)',
				name: 'ttlSeconds',
				type: 'number',
				typeOptions: { minValue: 60 },
				default: 3600,
				description: 'How long the cache lives after it is created or extended. Storage is billed per hour.',
				displayOptions: { show: { resource: ['cache'], operation: ['create', 'getOrCreate', 'extend'] } },
			},
			{
				displayName: 'Minimum Remaining (Seconds)',
				name: 'minRemainingSeconds',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 300,
				description:
					'A matching cache with less life left than this is extended rather than returned, so a long agent run does not lose its cache halfway',
				displayOptions: { show: { resource: ['cache'], operation: ['getOrCreate'] } },
			},

			// Get, Extend, Delete
			{
				...cacheNameField,
				displayOptions: { show: { resource: ['cache'], operation: ['get', 'extend', 'delete'] } },
			},

			// Get Many
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['cache'], operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['cache'], operation: ['getAll'], returnAll: [false] } },
			},

			// Content: Generate
			{
				...cacheNameField,
				displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
				options: [
					{
						displayName: 'Max Output Tokens',
						name: 'maxOutputTokens',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 2048,
					},
					{
						displayName: 'Simplify Output',
						name: 'simplify',
						type: 'boolean',
						default: true,
						description: 'Whether to return only the answer text and token usage instead of the raw response',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
						default: 0.2,
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getCacheableModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const models = await listAll.call(this, 'models', 'models');
				return models
					.filter((m) =>
						((m.supportedGenerationMethods as string[] | undefined) ?? []).includes('createCachedContent'),
					)
					.map((m) => ({
						name: (m.displayName as string) ?? (m.name as string),
						value: m.name as string,
						description: m.name as string,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results =
					resource === 'content'
						? [await generate.call(this, i)]
						: await runCacheOperation.call(this, operation, i);
				for (const json of results) out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// NodeOperationError copies the description of a wrapped NodeApiError, so the
				// billing / minimum-size hint from transport.ts still reaches the user.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}

async function runCacheOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getOrCreate':
			return [await getOrCreate.call(this, i)];
		case 'create': {
			const spec = readCacheSpec.call(this, i);
			return [await createCache.call(this, spec)];
		}
		case 'get':
			return [await geminiRequest.call(this, 'GET', cacheName.call(this, i))];
		case 'getAll': {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
			return await listAll.call(this, 'cachedContents', 'cachedContents', limit);
		}
		case 'extend': {
			const ttl = this.getNodeParameter('ttlSeconds', i) as number;
			return [await extendCache.call(this, cacheName.call(this, i), ttl)];
		}
		case 'delete': {
			const name = cacheName.call(this, i);
			await geminiRequest.call(this, 'DELETE', name);
			return [{ name, deleted: true }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex: i });
	}
}

interface CacheSpec {
	model: string;
	label: string;
	systemInstruction?: IDataObject;
	contents: IDataObject[];
	ttlSeconds: number;
	fingerprint: string;
}

function readCacheSpec(this: IExecuteFunctions, i: number): CacheSpec {
	const model = normaliseModel(this.getNodeParameter('model', i) as string);
	const label = this.getNodeParameter('label', i) as string;
	const systemText = this.getNodeParameter('systemInstruction', i, '') as string;
	const format = this.getNodeParameter('contentFormat', i) as string;
	const ttlSeconds = this.getNodeParameter('ttlSeconds', i) as number;

	let contents: IDataObject[];
	if (format === 'json') {
		const raw = this.getNodeParameter('contentJson', i) as string | IDataObject[];
		contents = typeof raw === 'string' ? (JSON.parse(raw) as IDataObject[]) : raw;
		if (!Array.isArray(contents)) {
			throw new NodeOperationError(this.getNode(), 'Contents must be a JSON array', { itemIndex: i });
		}
	} else {
		contents = [{ role: 'user', parts: [{ text: this.getNodeParameter('contentText', i) as string }] }];
	}

	const systemInstruction = systemText ? { parts: [{ text: systemText }] } : undefined;
	return {
		model,
		label,
		systemInstruction,
		contents,
		ttlSeconds,
		fingerprint: fingerprint(model, systemInstruction, contents),
	};
}

async function createCache(this: IExecuteFunctions, spec: CacheSpec): Promise<IDataObject> {
	return await geminiRequest.call(this, 'POST', 'cachedContents', {
		model: spec.model,
		displayName: buildDisplayName(spec.label, spec.fingerprint),
		contents: spec.contents,
		...(spec.systemInstruction ? { systemInstruction: spec.systemInstruction } : {}),
		ttl: `${spec.ttlSeconds}s`,
	});
}

async function extendCache(this: IExecuteFunctions, name: string, ttlSeconds: number): Promise<IDataObject> {
	return await geminiRequest.call(this, 'PATCH', name, { ttl: `${ttlSeconds}s` }, { updateMask: 'ttl' });
}

async function getOrCreate(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const spec = readCacheSpec.call(this, i);
	const minRemainingSeconds = this.getNodeParameter('minRemainingSeconds', i) as number;
	const all = (await listAll.call(this, 'cachedContents', 'cachedContents')) as unknown as CacheSummary[];
	const now = Date.now();

	const decision = decideCacheAction(matchingCaches(all, spec.model, spec.fingerprint), now, {
		ttlSeconds: spec.ttlSeconds,
		minRemainingSeconds,
	});

	const cache =
		decision.action === 'reuse'
			? (decision.cache as unknown as IDataObject)
			: decision.action === 'extend'
				? await extendCache.call(this, decision.cache.name, spec.ttlSeconds)
				: await createCache.call(this, spec);

	return {
		action: decision.action,
		cacheName: cache.name,
		model: cache.model,
		displayName: cache.displayName,
		fingerprint: spec.fingerprint,
		expireTime: cache.expireTime,
		remainingSeconds: remainingSeconds(cache as unknown as CacheSummary, now),
		cachedTokens: (cache.usageMetadata as IDataObject | undefined)?.totalTokenCount,
	};
}

async function generate(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const name = cacheName.call(this, i);
	const prompt = this.getNodeParameter('prompt', i) as string;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	// A cache only works with the model it was created for, so read the model from the cache
	// instead of asking the user to keep two fields in sync.
	const cache = await geminiRequest.call(this, 'GET', name);
	const response = await geminiRequest.call(this, 'POST', `${cache.model as string}:generateContent`, {
		cachedContent: name,
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		generationConfig: {
			temperature: options.temperature ?? 0.2,
			maxOutputTokens: options.maxOutputTokens ?? 2048,
		},
	});

	if (options.simplify === false) return response;

	const candidate = ((response.candidates as IDataObject[] | undefined) ?? [])[0] ?? {};
	const parts = ((candidate.content as IDataObject | undefined)?.parts as IDataObject[] | undefined) ?? [];
	const usage = (response.usageMetadata as IDataObject | undefined) ?? {};
	const promptTokens = (usage.promptTokenCount as number | undefined) ?? 0;
	const cachedTokens = (usage.cachedContentTokenCount as number | undefined) ?? 0;

	return {
		text: parts.map((p) => p.text ?? '').join(''),
		finishReason: candidate.finishReason,
		cacheName: name,
		model: cache.model,
		usage: {
			promptTokens,
			cachedTokens,
			outputTokens: usage.candidatesTokenCount,
			cachedShare: promptTokens ? Number((cachedTokens / promptTokens).toFixed(3)) : 0,
		},
	};
}

function cacheName(this: IExecuteFunctions, i: number): string {
	const raw = (this.getNodeParameter('cacheName', i) as string).trim();
	return raw.startsWith('cachedContents/') ? raw : `cachedContents/${raw}`;
}
