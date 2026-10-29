# 0030: Answer crawlers and training opt-outs

## Status

Accepted. Amends decision 5 of specs/0011-citability.md.

## What

The Instant Audit "Crawler access" row (`ai_bot_directives`) and the "Pages crawlers can open" row (`cite_paths`) now judge two lists, defined in `services/audit/llmCrawlerReadiness.ts`:

- **Answer crawlers** (`ANSWER_CRAWLER_BOTS`): OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User. A block at `/` fails the row. A block on the homepage, `/llms.txt` or `/sitemap.xml` fails the cite paths row.
- **Training opt-outs** (`TRAINING_CRAWLER_BOTS`): GPTBot, ClaudeBot, Google-Extended, Applebot-Extended. A block never fails a row. When the answer crawlers pass, the row stays a pass and its detail adds an information line: "You opted out of AI training; this does not stop AI answers citing you." When Google-Extended is blocked, the line also says that the token covers grounding in Gemini apps, and that Google Search and AI Overviews do not use it.

The same split applies to the preflight simulator (`services/audit/auditSimulator.ts`). Its per-vendor flags (`chatGptAllowed`, `claudeAllowed`, `perplexityAllowed`) read only answer crawlers. A Google-Extended block no longer lowers the predicted evidence yield. The robots.txt fix snippet in the fix list names the answer crawlers only, so following it does not undo a training opt-out.

`LLM_CRAWLER_BOTS` stays exported as the union of both lists.

## Why

The old row failed any block of nine named crawlers. Four of them are training or opt-out tokens. Owners who chose "answers yes, training no" were told their crawler access failed, though AI answers could still read and cite them. That is a wrong verdict, not a missing measurement.

Vendor documentation, read on 2026-10-29:

| Token | Vendor role | Source |
| --- | --- | --- |
| GPTBot | Crawls content that may train OpenAI's foundation models. Each OpenAI setting is independent, so blocking it does not remove a site from ChatGPT search. | [OpenAI: Overview of OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| OAI-SearchBot | Surfaces sites in ChatGPT search features. | same |
| ChatGPT-User | Fetches a page for a user action in ChatGPT. Not used for automatic crawling. OpenAI says robots.txt rules may not apply. | same |
| ClaudeBot | Collects public web content that may be used to train Anthropic's models. | [Anthropic: Does Anthropic crawl data from the web](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| Claude-SearchBot | Indexes content to improve Claude's search results. Blocking it keeps the site out of that index. | same |
| Claude-User | Fetches a page when a user's question needs it. Blocking it stops Claude retrieving the site for answers. | same |
| PerplexityBot | Surfaces and links sites in Perplexity search results. Perplexity says it is not used to crawl for foundation models. | [Perplexity: Perplexity crawlers](https://docs.perplexity.ai/guides/bots) |
| Perplexity-User | Fetches a page for a user question and may link it in the answer. Perplexity says it generally ignores robots.txt. | same |
| Google-Extended | A product token, not a crawler. Controls use of Google-crawled content for Gemini training and for grounding in Gemini apps and Grounding with Google Search on Vertex AI. It does not affect inclusion or ranking in Google Search. | [Google: Google's common crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) |
| Googlebot | AI Overviews and AI Mode follow Googlebot robots rules and the usual snippet controls. Google-Extended is not listed as a control for them. | [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) |
| Applebot-Extended | Does not crawl. Controls whether Applebot data may train Apple's foundation models. Sites that disallow it can still appear in search results, and the rule is not a ranking factor. | [Apple: About Applebot](https://support.apple.com/en-us/119829) |

Two edge cases follow from those sources:

- ChatGPT-User and Perplexity-User may fetch a page even when robots.txt blocks them. The row still fails on that block, because it reports the owner's stated rule, not what a fetcher does. The detail text names the rule only.
- Google-Extended is not purely training: it also covers Gemini app grounding. It stays in the opt-out list because Google Search and AI Overviews do not use it. The information line names the Gemini grounding effect instead of hiding it.

## Alternatives considered

- **A fourth status for opt-outs (for example `info`).** Rejected. Every consumer of `LlmCrawlerStatus` (teasers, failure codes, the fix list, the weekly card) would need a new branch, and stored teaser rows would need a migration. A pass with a detail line keeps the three honest statuses and carries the fact.
- **Fail Google-Extended as an answer crawler because of Gemini grounding.** Rejected. It would keep failing owners whose Google Search and AI Overviews visibility is untouched. The information line states the Gemini effect.
- **Drop training tokens from the audit entirely.** Rejected. Owners ask whether their opt-out is in place. Naming it in the detail answers that without a verdict.
- **Add Googlebot, Applebot or Bingbot as answer crawlers.** Not in this change. Blocking a general search crawler is a search indexing problem with wider effects, and it needs its own row and wording.
- **Leave ChatGPT-User and Perplexity-User off the fail list because they may ignore robots.txt.** Rejected. A block is still the owner telling that vendor to stay out of answers, which is the signal this row reports.

## Invariants

- Only answer crawlers can fail `ai_bot_directives` or `cite_paths`.
- A training opt-out is described, never scored and never failed.
- Statuses stay `pass`, `fail` or `not_measured`. No 0-100 score.
- Vendor roles are re-checked against the sources above before a crawler moves between lists.
