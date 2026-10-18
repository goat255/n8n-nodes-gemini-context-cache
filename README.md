# n8n-nodes-gemini-context-cache

Explicit Gemini context caching for n8n. Put a large, stable context (a product catalog, a policy
manual, a codebase digest) into a Gemini cache once, then answer many questions against it without
paying full input price on every call.

n8n's built-in Gemini nodes do not expose caching today. Gemini 2.5 and newer models do apply
*implicit* caching automatically, but it is best effort: you cannot see it, control its lifetime or
count on the discount. This node covers the explicit side.

## When to use it

| Situation | Use this node? |
|---|---|
| Same 50K+ token context, many questions an hour (support bot, RAG-free document Q&A) | Yes |
| Long agent runs that re-send the same instructions and documents | Yes |
| Context under the model minimum (2,048 to 4,096 tokens) | No, implicit caching already covers it |
| Context that changes on every call | No, there is nothing to reuse |

## Operations

**Cache**

- **Get or Create**: the one most workflows need. Fingerprints the model, system instruction and
  content; reuses a live cache built from identical input, extends it when it is close to expiry,
  or creates a new one when the content changed. Safe to put in front of every chat request.
- **Create**, **Get**, **Get Many**, **Delete**
- **Extend**: set a new TTL. Expiry is the only field Gemini lets you change.

**Content**

- **Generate**: ask a question against a cache. The model is read from the cache itself (a cache
  only works with the model it was built for), and the output reports how many prompt tokens were
  served from cache.

## Example: catalog chatbot

```
Webhook (question)
  -> Gemini Context Cache: Get or Create   label "product-catalog", content from the catalog file
  -> Gemini Context Cache: Generate        cache {{ $json.cacheName }}, prompt {{ $('Webhook').item.json.body.question }}
  -> Respond to Webhook                    {{ $json.text }}
```

When the catalog file changes, its fingerprint changes and the next request builds a fresh cache.
Old caches simply expire, so there is no invalidation job to run.

Output of **Generate** (simplified):

```json
{
  "text": "The Standard plan includes dental cover after a 6-month waiting period.",
  "cacheName": "cachedContents/abc123",
  "usage": { "promptTokens": 48210, "cachedTokens": 48190, "outputTokens": 41, "cachedShare": 1 }
}
```

## Credentials

Create a **Gemini Context Cache API** credential with an API key from Google AI Studio. Explicit
caching is a paid feature: the key must belong to a Google Cloud project with billing enabled, or
cache creation fails with a free-tier quota error (the node says so in plain words).

The credential test lists caches, so a green check means the key works *and* caching is reachable.

## Design notes

- **Content changes are detected, not tracked.** Gemini caches are immutable apart from their
  expiry, so a 16-character SHA-256 fingerprint is appended to the display name, for example
  `product-catalog [3f9a0c2b7d1e4a65]`. Get or Create finds a match with one list call and needs no
  database.
- **Extend before it dies.** A matching cache with less than *Minimum Remaining* seconds left is
  extended, so a long agent loop does not lose its cache halfway through.
- **No runtime dependencies**, so the package is eligible for n8n Cloud verification.

## Background

This node started as a workaround inside a client deployment. Two write-ups sit next to the code:

- [docs/PRODUCT_FEEDBACK.md](docs/PRODUCT_FEEDBACK.md): the gap, the evidence and which parts belong
  in n8n core versus a community node.
- [docs/FIVE_DAY_DEPLOYMENT.md](docs/FIVE_DAY_DEPLOYMENT.md): how I run a time-boxed on-site
  deployment, and where findings like this one come from.

## Development

```bash
npm install
npm run build
npm run lint
npm test
npm run dev   # starts a local n8n with this node loaded
```

## License

MIT
