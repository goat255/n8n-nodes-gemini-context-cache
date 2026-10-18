# Product feedback: explicit Gemini context caching in n8n

*Written in the format I would use as an FDE handing a field finding to Product. One page.*

## Summary

n8n's Google Gemini nodes cannot create or use explicit context caches. Customers with large, stable
context (catalogues, policy manuals, long agent instructions) pay full input price on every call or
fall back to hand-built HTTP Request workflows. The request types already carry the field, so the
gap is in the node surface, not the transport.

## Evidence

| Signal | Detail |
|---|---|
| Code | `packages/@n8n/nodes-langchain/nodes/vendors/GoogleGemini/helpers/interfaces.ts` declares `cachedContent?: string` on the request, but no action sets it and no operation manages caches. Neither `googleGemini` (76 properties) nor `lmChatGoogleGemini` exposes a cache parameter. |
| Community | Forum threads such as "How can I enable context caching in Gemini?" and "Using Prompt Caching in N8N" ask for exactly this. |
| Field | A broker's chatbot with a 627K-token catalogue: about $0.02 per chat without caching, about $0.005 with it. At 10K chats a month that is roughly $150 saved monthly on one workflow. The workaround took two extra workflows of raw HTTP calls. |

## What customers hit today

1. No way to create, list, extend or delete a cache from a node.
2. No way to point the Gemini chat model or the Message a Model action at an existing cache.
3. Gemini's free tier allows **zero** cached tokens. The error (`TotalCachedContentStorageTokensPerModelFreeTier limit=0`) reads like a bug, not a billing requirement, and users give up.
4. Implicit caching (automatic on Gemini 2.5+) is invisible, so users cannot tell whether they are already getting a discount.

## Classification

| Part | Where it belongs | Why |
|---|---|---|
| Cache management (create / list / extend / delete) | **Node improvement**: new "Cache" resource on the Google Gemini node | Small, self-contained, matches the existing resource/operation pattern (File, File Search). |
| "Use cache" on Message a Model and the Gemini chat model | **Node improvement** | The `cachedContent` field already exists in the request type; this is a UI option plus pass-through. |
| Content-change detection (Get or Create) | **Keep in the community node for now** | Useful, but an opinionated policy (fingerprint in display name). Ship after the basics prove demand. |
| Cross-provider "prompt caching" abstraction (Gemini, Anthropic, OpenAI) | **Product question, not a node fix** | Each provider caches differently (explicit objects vs cache-control markers vs automatic). Worth a spec only if AI Agent users ask for cost controls broadly. |
| Friendly free-tier error | **Quick fix** | Map the quota message to "explicit caching requires billing". One line in error handling. |

## Proposed first step

Add a **Cache** resource to the Google Gemini node with Create, Get, Get Many, Extend and Delete, and
a "Cached Content" option on Message a Model. Effort is roughly one engineer-week including tests.
A working reference implementation, linted with `n8n-node lint`, is in this repository.

## How we would know it worked

- Forum threads on Gemini caching stop recurring.
- Share of Gemini executions with `cachedContentTokenCount > 0` in responses (if telemetry allows).
- Fewer HTTP Request nodes pointing at `generativelanguage.googleapis.com/v1beta/cachedContents` in
  shared templates.
