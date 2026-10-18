import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const CREDENTIAL = 'geminiContextCacheApi';

type Context = IExecuteFunctions | ILoadOptionsFunctions;

export async function geminiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const { host } = await this.getCredentials<{ host: string }>(CREDENTIAL);
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, {
			method,
			url: `${host.replace(/\/$/, '')}/v1beta/${path.replace(/^\//, '')}`,
			body,
			qs,
			json: true,
		})) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			description: hintFor(error as JsonObject),
		});
	}
}

/** Follows nextPageToken until `limit` items are collected (or every page when limit is 0). */
export async function listAll(
	this: Context,
	path: string,
	key: string,
	limit = 0,
	extraQs: IDataObject = {},
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let pageToken: string | undefined;
	do {
		const page = await geminiRequest.call(this, 'GET', path, undefined, {
			...extraQs,
			pageSize: 1000,
			...(pageToken ? { pageToken } : {}),
		});
		items.push(...((page[key] as IDataObject[] | undefined) ?? []));
		pageToken = page.nextPageToken as string | undefined;
	} while (pageToken && (limit === 0 || items.length < limit));
	return limit === 0 ? items : items.slice(0, limit);
}

// The two failures people actually hit, translated into what to do next.
function hintFor(error: JsonObject): string | undefined {
	const text = JSON.stringify(error);
	if (/TotalCachedContentStorageTokens|FreeTier/i.test(text)) {
		return 'Explicit caching is not available on the free tier. Enable billing on the Google Cloud project behind this API key.';
	}
	if (/minimum|too small|min_total_token_count/i.test(text)) {
		return 'Gemini only caches content above a per-model minimum (2,048 to 4,096 tokens). Smaller prompts are already covered by implicit caching.';
	}
	return undefined;
}
