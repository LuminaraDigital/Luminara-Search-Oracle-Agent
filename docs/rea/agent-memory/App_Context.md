# App Context: TencentDB Agent Memory → Luminara

Status: ORIENT filled in from the owner's request on 2026-11-18. The owner has not yet confirmed the assumptions marked (A).

| Question | Answer |
| --- | --- |
| Target | `TencentCloud/TencentDB-Agent-Memory`, commit `42d4cde` (2026-11-10), cloned into the session scratchpad only. It is not inside this repository. |
| Permission | Open source under MIT (`LICENSE`, © 2026 Tencent). Copying and changing it is allowed if the copyright and permission notice are kept. Some parts bundle third-party code; see Scope_Notes.md. |
| What the owner wants | "Connect it and customize it to match Luminara" without breaking the application. |
| What it would be for | Luminara's agents: the Oracle chat, the Telegram bot, Android Ask and the MCP tools. The goal is to remember users, projects and working methods across sessions. (A) |
| Who it is for | Luminara customers (small businesses tracking AI visibility) and the agents that act for them. (A) |
| Platform | Cloudflare Worker with D1, KV, a Durable Object, Queues and Workers AI. The web app is React, plus a Telegram Mini App and an Android app. |
| Skill level | The owner ships through agents and has a release gate (merge-commit PR from staging to main). |
| Hard rules | Never break production. New behaviour ships dark behind a flag. Migrations are named rather than numbered. No `git add -A`. Landing page is off limits. No clones under someone else's brand. |

## The question this project answers
Should Luminara run Tencent's memory stack, copy parts of it, or rebuild the ideas inside the memory tables it already has? Also, which three features come first?
