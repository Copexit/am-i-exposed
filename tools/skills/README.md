# Transcreation Skills

Three Claude Code skills for translating and reviewing am-i.exposed content. These skills automate the translation workflow - from initial transcreation through quality control - while enforcing the project's voice rules and Bitcoin privacy terminology.

## Setup

Skills live in `tools/skills/` (tracked in git) and are symlinked into `.claude/skills/` (gitignored) so Claude Code can discover them.

**First-time setup** (run once after cloning):

```sh
mkdir -p .claude && ln -sf ../tools/skills .claude/skills
```

After this, Claude Code will auto-discover all three skills.

## Skills

### `transcreation-exposed`

Transcreation for all am-i.exposed content - UI strings, finding descriptions, glossary definitions, FAQ, guide, and about page. Handles all supported language pairs (EN, DE, ES, PT, FR).

Contains:

- am-i.exposed voice definition (inline) - no "we/us/our", no em dashes
- 5-step translation process (classify, understand, extract intent, write, stop-slop)
- UI string rules for common.json translations (i18next double-brace syntax)
- Bitcoin/privacy terminology (do-not-translate list + per-language notes)
- Subagent strategy for large translation jobs
- Delivery checklists

### `qc-review`

Quality control and review framework for translated content.

Contains:

- 5-dimension scoring system (accuracy, fluency, terminology, voice, completeness)
- Issue classification (4 severity levels, 5 categories)
- 6-step review process
- Content-type checklists (UI strings, glossary/FAQ, about/marketing)
- Standardized report format
- Subagent strategy for large reviews

### `stop-slop`

AI writing pattern removal. Mandatory final pass for all translations. Catches filler phrases, passive voice, parallel structures, hedges, and other AI tells.

## How They Work Together

```text
stop-slop
+-- used by transcreation-exposed (Step 4 of every translation)
+-- used by qc-review (voice pass detects AI patterns)

transcreation-exposed
+-- voice definition embedded inline
+-- references public/locales/en/common.json as source of truth
+-- referenced by qc-review when reviewing translations

qc-review
+-- loads transcreation-exposed for voice and terminology reference
```

## Typical Workflows

### Translate UI strings

1. Invoke `transcreation-exposed` (it will pull in `stop-slop`)
2. Provide the source strings or point to `public/locales/en/common.json`
3. Specify target locale (e.g., de, es, pt, fr)
4. The skill guides the full process: classify, understand, translate, stop-slop

### Translate long-form content

Same as above. For content over 5,000 words or with 5+ distinct sections, the skill spawns subagents automatically.

### Review existing translations

1. Invoke `qc-review` (it will pull in `transcreation-exposed` and `stop-slop`)
2. Provide source and target files
3. Specify the language pair
4. The skill runs a 3-pass review and produces a scored report

### Large-scale audit

For the full common.json (~2061 keys), `qc-review` chunks by namespace prefix and spawns subagents. Each subagent reviews its namespace and returns a scored report. The orchestrator merges results and runs cross-namespace consistency checks.

## Key References

- **Source strings:** `public/locales/en/common.json` (2061 keys)
- **Existing translations:** `public/locales/{lang}/common.json` (de, es, pt, fr)
- **Locale config:** `src/lib/i18n/config.ts`
- **Placeholder syntax:** i18next double-brace: `{{variable}}`

## Current Locale Status

Run the transcreation workflow's diff job to get up-to-date key counts per locale. Source of truth: `public/locales/en/common.json`.
