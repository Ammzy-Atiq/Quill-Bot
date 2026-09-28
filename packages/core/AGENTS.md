# AGENTS.md — packages/core (framework-free engine)

Owner: **bot-agent**. Imported by the bot **and** the website (e.g. the live normalizer demo and
the verification evaluator), so:

- **No discord.js, no Node-only APIs** in `src/` (it must run in the browser too). No I/O —
  functions take data in and return decisions out. Redis/DB access happens in the callers.
- Deterministic and fast: the normalizer + matcher run on every message.
- Every exported function has unit tests next to it (`*.test.ts`).
- Data files (word lists) live in `src/data/`; validate them with `pnpm wordlist:validate`.

Planned modules: `normalizer/`, `wordlist/`, `matcher/`, `detectors/`, `risk/`, `antinuke/`,
`antiraid/`, `verification/` — see the root `AGENTS.md` status board.
