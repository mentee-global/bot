# Mentee agent evals

This directory contains a `pydantic-evals` test harness for the Mentee
bot agent. It runs a curated dataset against the real agent
(`MenteeAgent.reply()` equivalent) and grades each response with both
deterministic checks and LLM-as-judge evaluators.

The goal is **before/after measurement** when we change prompts, tools,
or post-processing. The baseline lives in `results/baseline_*.json` and
each follow-up PR commits a new `results/<change>_<date>.json` so the
diff is in code review.

## Privacy

The dataset is intentionally synthetic. Every case captures the *shape*
of a failure mode we want to grade, not a literal production message.
Cases reuse no real names, locations are placeholder ("capital city"),
and any pasted-bio content is a synthesized example. Don't paste real
user messages here — the case shapes generalize, the specific text
shouldn't leave the platform.

## Running

```bash
# from backend/
export OPENAI_API_KEY=...
export PERPLEXITY_API_KEY=...

# Run via pytest (writes results to results/run_<timestamp>.json)
uv run pytest tests/evals -m eval -s

# Or run the script directly with a custom output name
uv run python -m tests.evals.run_baseline --output results/my_run.json
```

The suite **skips itself** when either API key is missing, so it's safe
to include in the default test discovery.

## What gets scored

Each case is graded by some subset of these evaluators:

| Evaluator | Kind | What it checks |
|---|---|---|
| `NoMarkerLeak` | deterministic | Body has no PUA citation wrappers, no `citeturn` ASCII residue, no `(host.tld)` bare-domain shorthand. |
| `URLsInAllowlist` | deterministic | Every `https://` URL in body resolves to a normalized key in `deps.citations`. |
| `SourcesBarRendersSomething` | deterministic | If any tool fired and the case expects sources, the trailer payload has ≥1 non-empty title. |
| `Actionability` | LLM-as-judge | When user asked for action ("busca", "find", "list"), did the bot deliver inline or push to next turn? |
| `CitationGrounding` | LLM-as-judge | Are factual claims tied to cited URLs, or asserted ungrounded? |

LLM judges only fire on cases tagged `metadata.judges_apply=True`. They
use `gpt-5.4-mini` (the same model as the agent under test) wrapped
through `pydantic-ai` so output is structured `{score, reasoning}`.

## Cost

A full run is ~12 cases × (1 agent run + ~2 judge calls on the
search-shaped cases) ≈ 22 LLM calls. Run locally; not on CI.

## Adding a case

Edit `dataset.py`. Each `Case` carries `inputs: MenteeInput` and a
`metadata: MenteeMetadata` payload that drives evaluator behavior
(expected language, expected sources, whether LLM judges run).
