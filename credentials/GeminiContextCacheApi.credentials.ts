import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GeminiContextCacheApi implements ICredentialType {
	name = 'geminiContextCacheApi';

	displayName = 'Gemini Context Cache API';

	icon: Icon = {
		light: 'file:../nodes/GeminiContextCache/geminiContextCache.svg',
		dark: 'file:../nodes/GeminiContextCache/geminiContextCache.dark.svg',
	};

	documentationUrl = 'https://github.com/goat255/n8n-nodes-gemini-context-cache#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'A Gemini API key from Google AI Studio. Explicit caching needs a billing-enabled project.',
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'https://generativelanguage.googleapis.com',
			description: 'Change only when routing through a proxy that speaks the Gemini REST API',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-goog-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Listing caches proves both that the key is valid and that the caching API is reachable.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.host}}/v1beta',
			url: '/cachedContents',
			qs: { pageSize: 1 },
		},
	};
}
