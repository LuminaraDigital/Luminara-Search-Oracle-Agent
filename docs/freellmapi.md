# FreeLLMAPI + Luminara (BYOK sidecar)

Luminara can use [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) as a **personal / self-host OpenAI-compatible gateway**. This is not the multi-tenant production brain for luminarasuite.com. Hosted Worker keys (Groq/NIM/etc.) stay unchanged.

## What you get

| Goal | How |
|---|---|
| One key instead of many | Settings → LLM → FreeLLMAPI base URL + unified `freellmapi-…` key |
| Audits survive 429s | Native failover + 60s cooldown skips rate-limited engines |
| Cheap heavy loops | FreeLLMAPI stacks free tiers; prefer-gateway puts it first |
| Task-aware routing | Switchyard maps efficient → `auto:fast`, capable/advisor → `auto:smart` |
| Modalities | Embeddings, TTS (“Brief aloud”), images, transcription via `services/freellm/modalitiesService.ts` |
| One brain for app + agents | Same `/v1` URL + key for Luminara, Cursor, Claude Code, Codex |

## Quick start

1. Run FreeLLMAPI locally (default UI/API: `http://localhost:3001`).
2. Add provider keys in FreeLLMAPI → Keys, copy the **unified** key.
3. In Luminara: Settings → LLM → set Base URL `http://localhost:3001/v1`, paste the unified key, leave **Prefer FreeLLMAPI** on.
4. Ping; then run Instant Audit or Oracle chat.

Port note: Local SERP defaults also mention `:3001`. Do not run both services on the same port.

## Point coding agents at the same gateway

Use the same base URL and unified key:

```bash
# Example OpenAI SDK / compatible clients
export OPENAI_BASE_URL=http://localhost:3001/v1
export OPENAI_API_KEY=freellmapi-your-unified-key
```

Cursor / Claude Code / Codex: set custom OpenAI-compatible endpoint to `http://localhost:3001/v1` with the FreeLLMAPI unified key (see FreeLLMAPI `docs/clients`).

## Quality tip

Blind `auto` can vary for strict JSON SEO reports. For pinned quality, turn **Prefer FreeLLMAPI** off and keep Groq/NIM first; FreeLLMAPI still participates later in the failover chain.

## Architecture boundary

- Browser calls FreeLLMAPI **directly** (localhost-safe). No Worker-hosted FreeLLMAPI secret.
- Worker continues to proxy hosted/BYOK Groq, NIM, OpenRouter, Ollama, Gemini only.
