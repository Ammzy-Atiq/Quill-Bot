# AGENTS.md — packages/core (framework-free engine)

Owner: **bot-agent**. Imported by the bot **and** the website (live normalizer demo on the
landing page, `evaluateVerification` in the verify flow), so:

- **No discord.js, no `node:` imports** in `src/` — it must run in browsers. Only import the
  browser-safe entry points of `@quill/shared` (`/config`, `/redis`, `/wordlists`, `/actions`, …).
- No I/O: functions take data in and return decisions out. Redis/DB access happens in callers.
- Deterministic and fast (normalizer + matcher run on every message: ~0.2 ms for a normal
  message, matcher build ~200 ms once per process).
- Every module has unit tests next to it (`*.test.ts`).

## Modules

| Path | What |
|---|---|
| `src/normalizer/` | `normalize(text, options)` → chunks, tokens, views (`raw`, `c1`, `c2`, `compact`), stats. Pipeline: NFKC → strip invisible chars → strip combining marks (diacritics/Zalgo) → homoglyphs (`tables.ts`) → lowercase → leetspeak (context-aware) → split → join single-letter runs → repetition collapse. `normalizeTerm()` folds dictionary terms identically. |
| `src/matcher/` | `AhoCorasick` + `WordMatcher` (built-in lists share one instance; custom words get their own). Handles doubled-letter collisions (`nigger` vs `Niger`, `butt` vs `but`) and never lets substring hits span normal words (`this hit` ≠ `shit`). |
| `src/wordlist/` | Word entry types, `parseWordlist()` for the source format. |
| `src/data/wordlists/` | **2800+ built-in terms**, one file per category, 14 languages. |
| `src/risk/` | `evaluateRisk()` — decaying score, trust multipliers, repeat multiplier, ladder steps that re-arm after decay. |
| `src/verification/` | `scoreIdentityLink()` + `evaluateVerification()` (pass / flag / block, reason codes). Used by the website. |

## Word list format (`src/data/wordlists/<category>.ts`)

```
@lang en            ← language for following lines
@severity 3         ← 1 mild … 5 extreme (default filter ignores severity 1)
@match boundary     ← exact | boundary | substring
term
another term | s=4 | m=substring | lang=es
```

- `boundary` (default): whole word/phrase; sees through repetition, leet, homoglyphs, spacing.
- `substring`: anywhere, incl. inside words (`motherfucker`) — **only** for stems that never
  appear inside innocent words. The validator checks every substring term against a 275k-word
  English dictionary.
- `exact`: whole word, no repetition collapse.
- Don't add inflections that `boundary` already covers through normalization (`sh1t`, `fuuuck`),
  and don't add words with common innocent meanings (country names, tools, food, names).
- The `self_harm` category is for **encouraging others**; never add a person's own ideation
  ("I want to die") — the bot must not punish people in crisis.

After editing run `pnpm wordlist:validate` (add `--suggest` to see boundary terms that could
safely become substring) and `pnpm test` (includes a false-positive corpus in
`src/data/wordlists/wordlists.test.ts` — add a sentence there whenever you fix a false positive).
