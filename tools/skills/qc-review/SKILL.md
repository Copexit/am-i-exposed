---
name: qc-review
description: "Quality control and review skill for translated content. Use when reviewing, auditing, or scoring translations for am-i.exposed. Evaluates accuracy, fluency, terminology, voice, and completeness. Produces structured review reports. Trigger on: review translation, QC, quality check, audit translation, proofread, translation review."
---

# Translation Quality Review

Systematic QC framework for translated content.

**Project:** am-i.exposed - client-side Bitcoin privacy analysis tool. Transcreation skill: `transcreation-exposed`. Source i18n files: `public/locales/`. No terminology reference files - use the do-not-translate list and per-language notes in the transcreation skill (Part 4).

Uses the `stop-slop` skill for AI pattern removal.

---

## Part 1: Review Dimensions & Scoring

Five dimensions. Each scored 1-10. No rounding, no averaging across dimensions.

| Dimension | Question | 10 looks like | 1 looks like |
|---|---|---|---|
| Accuracy | Same meaning as source? | Every semantic unit preserved. No additions, no omissions. | Meaning distorted or key information missing. |
| Fluency | Reads naturally in target language? | Native speaker for this audience wrote it. | Machine-translation artifacts. Unnatural phrasing. |
| Terminology | Domain terms correct and consistent? | Every Bitcoin/privacy term uses the established standard. Consistent throughout. | Terms wrong or inconsistent across the file. |
| Voice | Matches the project's voice? | Indistinguishable from content the project would publish. No "we/us/our". | Wrong register, tone, or uses first-person plural. |
| Completeness | Everything translated? | No untranslated strings, no missing segments, all placeholders intact. | Significant gaps, untranslated segments, broken placeholders. |

**Accuracy** - compare source and target segment by segment. Look for semantic shifts, false friends, additions (content in target not in source), and omissions (content in source not in target).

**Fluency** - read the target text without looking at the source. If a sentence makes you pause, it fails. Common failures: calques (source-language syntax leaking into target), over-literal word order, unnatural collocations.

**Terminology** - check every Bitcoin/privacy term against the do-not-translate list and per-language terminology notes in the transcreation skill (Part 4). Verify consistency: same English term = same target term everywhere in the file.

**Voice** - does the translation sound like the project? am-i.exposed is direct, technical, privacy-focused. **Critical:** no first-person plural ("we", "us", "our") allowed anywhere. No em dashes. Common failure: AI-generated translations flatten voice into generic corporate neutral or introduce first-person plural.

**Completeness** - structural integrity. Every source key has a target. Every `{{variable}}` placeholder survives (double-brace i18next syntax). Every HTML tag is preserved. Common failure: placeholders silently deleted during translation.

### Scoring Bands

| Range | Verdict | Action |
|---|---|---|
| 45-50 | Ship-ready | No changes needed. Minor style preferences don't count against it. |
| 38-44 | Minor issues | Fix flagged items and ship. No structural problems. |
| 30-37 | Significant issues | Revise flagged areas and re-review. Patterns suggest systemic problems. |
| Below 30 | Reject | Retranslate. Fundamental accuracy, fluency, or terminology problems. |

The total is a guide, not a gate. A single CRIT issue at 42/50 still blocks shipping.

---

## Part 2: Issue Classification

Two systems work together: severity and category. Every issue gets both: e.g., "CRIT/TERM" or "MIN/FLUENCY".

### Severity Levels

| Severity | Label | Definition | Action | Example |
|---|---|---|---|---|
| Critical | CRIT | Meaning changed, Bitcoin term wrong, placeholder broken, content missing, first-person plural used | Must fix before shipping | "UTXO" translated; `{{count}}` deleted; "We analyze your..." |
| Major | MAJ | Noticeable quality problem affecting user experience | Should fix before shipping | Wrong register; sentence doesn't parse; key term inconsistent |
| Minor | MIN | Correct but improvable; non-preferred synonym | Fix if convenient; acceptable to ship | Slightly awkward phrasing; word order preference; verbose |
| Style | STY | Voice or style preference, debatable | Note for translator's awareness | Could be shorter; rhythm slightly off |

### Issue Categories

**ACCURACY**
- Mistranslation - target says something different from source
- Addition - content in target not present in source
- Omission - content in source missing from target
- False friend - word that looks similar across languages but means something different
- Semantic shift - subtle meaning drift that changes the implication

**FLUENCY**
- Unnatural phrasing - grammatically correct but no native speaker would write it that way
- Grammar error - subject-verb agreement, case, tense
- Punctuation error - misplaced commas, wrong quotation style for locale. **Exception:** do not flag technically-correct-but-unnecessary punctuation in short UI strings when the string reads naturally without it.
- Spelling error - typos, wrong diacriticals
- Calque - structure borrowed from source language

**TERMINOLOGY**
- Wrong term - incorrect translation of a Bitcoin/privacy term
- Inconsistent term - same source term translated differently in different locations
- Untranslated term - left in English when it should be translated
- Over-translated term - translated into target when it should stay in English (Bitcoin terms: UTXO, CoinJoin, PayJoin, Taproot, etc.)

**VOICE**
- Wrong register - too formal, too informal, too academic, too casual
- First-person plural - any use of "we", "us", "our" or target-language equivalents
- Em dash used - any em dash in any form
- AI slop pattern - flag the specific pattern from `stop-slop` (name it)
- Prohibited phrase - crypto-bro language, surveillance FUD, privacy buzzwords
- Generic flattening - distinctive source voice reduced to corporate neutral

**COMPLETENESS**
- Missing translation - empty target for a source key
- Broken placeholder - `{{variable}}` altered, deleted, or malformed
- Broken HTML tag - unclosed tag, deleted tag, reordered nesting
- Untranslated segment - source-language text remaining in target file
- Encoding error - mojibake, wrong character set

---

## Part 3: Review Process

Six steps. Follow in order.

**Single agent vs. subagents:** For small files (under ~100 keys or 5,000 words), one agent runs all six steps sequentially. For the full `common.json` (~2061 keys), the orchestrator handles Steps 1-2 and the file-reading strategy, then each subagent runs Steps 3-5 on its namespace chunk. The orchestrator runs Step 6 on the aggregated results.

### Step 1: Identify the project and load context

Load the transcreation skill (`transcreation-exposed`) for voice definition and terminology. Load `stop-slop`. Read `public/locales/en/common.json` as the source of truth.

### Step 2: Classify the content type

Content type determines which dimensions carry the most weight:

| Content type | Primary dimensions | Secondary dimensions |
|---|---|---|
| UI strings | Completeness, Terminology | Fluency (brevity > elegance) |
| Finding descriptions | Accuracy, Terminology | Fluency |
| Glossary definitions | Accuracy, Voice | Fluency |
| FAQ / Guide | Accuracy, Completeness | Voice, Fluency |
| About / Marketing | Voice, Fluency | Accuracy of intent > literal accuracy |

### Reading very long source files

For large JSON files like `common.json` (~2061 keys):

1. **Read the file in sections** - use offset/limit reads by namespace prefix. Build a namespace inventory with key counts.
2. **Compare source and target file structure** - identify which namespaces are fully translated, partially translated, or untranslated.
3. **Distribute chunks** - each subagent receives its namespace slice from both source and target files.
4. **Orchestrator assembles** - after subagents return, the orchestrator runs cross-chunk checks.

### Step 3: First pass - structural checks

Mechanical verification before reading for quality:

- [ ] All source keys have corresponding translations (no empty values)
- [ ] All `{{variable}}` placeholders preserved exactly (double-brace i18next syntax, character-for-character)
- [ ] All HTML tags preserved and properly nested
- [ ] No source-language text remaining in target (except Bitcoin terms that stay English)
- [ ] Character encoding correct (no mojibake, no broken diacriticals)
- [ ] No em dashes in any string
- [ ] No first-person plural in any string

If structural checks fail, log CRIT issues immediately.

### Step 4: Second pass - accuracy and terminology

Read source and target in parallel, segment by segment:

- Does each segment convey the same meaning?
- Are Bitcoin/privacy terms correctly handled? (kept in English where required, translated consistently where appropriate)
- Numbers, scores, and formatting preserved?
- Any additions? (Content in target not in source.)
- Any omissions? (Content in source not in target.)

For UI strings: check that source and target have the same number of sentences.

### Step 5: Third pass - fluency and voice

Read the target text ALONE. Do not look at the source. This is the "native reader" pass.

- Does it read naturally? Would a native speaker write it this way?
- Is the register consistent throughout?
- Does it match the project voice? am-i.exposed: direct, technical, privacy-focused.
- **Critical voice check:** Any "we/us/our" or target-language equivalents? Flag as CRIT/VOICE.
- **Em dash check:** Any em dashes in any form? Flag as MAJ/VOICE.
- For multi-sentence strings, run a stop-slop check. Skip for short UI strings under ~10 words.
- Button labels imperative? Error messages specific?

### Common false positives - do not flag these

- **Target-language capitalization that differs from English.** Spanish, Portuguese, and French do not title-case headings. German capitalizes nouns but not adjectives/verbs. Sentence case is correct in these languages.
- **Missing articles in form labels.** Terse field labels and column headers omit articles in all target languages.
- **Bitcoin terms kept in English.** UTXO, CoinJoin, PayJoin, Taproot, etc. staying in English is correct, not a completeness issue.
- **Loan words.** "Heuristik" (DE), "cluster" (ES/PT) - established loan words in the target language are correct.

### Step 6: Score and report

Assign dimension scores based on findings. Compile the issue table. Write summary and recommendation. Use the report format from Part 5.

Scoring guidelines:
- Start at 10 for each dimension. Deduct based on issue count and severity.
- One CRIT issue in a dimension: that dimension cannot score above 5.
- Three or more MAJ issues in a dimension: cap at 6.
- MIN and STY issues reduce scores by 0.5 each, roughly.

---

## Part 4: Content-Type Checklists

### Checklist A: UI Strings (common.json translations)

- [ ] All keys have translations (no empty values, no English left unless intentional)
- [ ] Placeholders (`{{variable}}`) preserved exactly (double-brace syntax)
- [ ] HTML tags preserved and properly closed
- [ ] Button labels are imperative verbs
- [ ] Error messages are specific
- [ ] No first-person plural anywhere
- [ ] No em dashes anywhere
- [ ] Consistent terminology within each namespace
- [ ] Consistent terminology across related namespaces
- [ ] No UI string exceeds ~150% of source length
- [ ] Same English term maps to the same target term everywhere (cross-namespace check)
- [ ] Bitcoin/privacy terms from do-not-translate list kept in English

### Checklist B: Long-Form / Glossary / FAQ

- [ ] Central argument preserved
- [ ] Rhetorical devices reproduced, not flattened
- [ ] Section structure preserved
- [ ] No hedges or softeners added that aren't in the source
- [ ] No AI slop patterns in multi-sentence strings
- [ ] No first-person plural
- [ ] No em dashes
- [ ] Links and references still valid
- [ ] Technical descriptions accurate
- [ ] Bitcoin amounts and scores preserved exactly

### Checklist C: About / Marketing Copy

- [ ] Headlines transcreated (not literally translated)
- [ ] CTAs action-oriented and natural in target language
- [ ] No first-person plural (this is the most common violation in marketing)
- [ ] No em dashes
- [ ] No privacy FUD introduced ("Big Brother", "they're watching")
- [ ] No crypto-bro language
- [ ] Voice matches the project personality
- [ ] No AI-generated filler ("in today's world", "it's worth noting")

---

## Part 5: Report Format

Every review produces this structure. No exceptions.

````markdown
## Translation Quality Review

**Project:** am-i.exposed
**Content type:** [UI strings / Glossary / FAQ / About]
**Language pair:** [EN -> DE / EN -> ES / EN -> PT / EN -> FR]
**File(s) reviewed:** [path or description]
**Date:** [YYYY-MM-DD]

### Scores

| Dimension | Score | Notes |
|---|---|---|
| Accuracy | X/10 | [One sentence] |
| Fluency | X/10 | [One sentence] |
| Terminology | X/10 | [One sentence] |
| Voice | X/10 | [One sentence] |
| Completeness | X/10 | [One sentence] |
| **Total** | **XX/50** | **[Ship-ready / Minor issues / Significant issues / Reject]** |

### Issues

| # | Severity | Category | Location | Source | Current | Suggested fix | Notes |
|---|---|---|---|---|---|---|---|
| 1 | CRIT | VOICE | about.built_p1 | "...is built and maintained by..." | "Wir haben..." | "...wird entwickelt von..." | First-person plural |
| 2 | MAJ | TERM | finding.H3_desc | "Round amount" | "Runder Betrag" / "Rundbetrag" | Pick one, use everywhere | Inconsistent term |

### Patterns

[If 3+ issues share a root cause, name the pattern here. List affected locations.]

### Summary

[2-3 sentences. Overall assessment.]

### Recommendation

**[Ship / Fix and ship / Revise and re-review / Retranslate]**
[One sentence explaining the recommendation.]
````

---

## Part 6: Subagent Strategy for Large Reviews

### Model recommendations

| Role | Model | Why |
|---|---|---|
| Orchestrator | Opus | Cross-chunk consistency, pattern identification, final scoring |
| QC subagents | Sonnet | Structured comparison against checklists and terminology |

### When to use subagents

- UI string files over ~100 keys (the full `common.json` at ~2061 keys always requires subagents)
- Multiple documents submitted for review at once
- Full-locale translation audits

Do not use subagents for single documents under 5,000 words or string files under ~100 keys.

### How to chunk

- **UI strings:** chunk by namespace prefix (`finding.*`, `remediation.*`, `glossary.*`, etc.). Each namespace or namespace group = one subagent.

### What each subagent receives

1. This QC skill (`qc-review`)
2. The transcreation skill's voice definition and terminology (Parts 1, 3, 4 from `transcreation-exposed`)
3. The `stop-slop` checklist
4. Their chunk of source + target text - **embedded directly in the subagent prompt as text**
5. A brief: project name, language pair, content type

**Critical: no filesystem handoff.** Embed source and target key-value pairs directly in the subagent's prompt text.

### What each subagent returns

Each subagent returns a scored report for its chunk as **inline text in the final message**, using the exact format from Part 5. No file writes, no filesystem paths.

### Orchestrator responsibilities

After collecting all subagent reports, the orchestrator:

1. **Aggregates dimension scores** - weighted by chunk size.
2. **Merges issue tables** - all issues into one consolidated table. Renumber sequentially.
3. **Runs cross-chunk consistency check** - verify that the same English term maps to the same target term across ALL namespaces. Flag divergences.
4. **Runs cross-chunk voice check** - verify no first-person plural anywhere. Verify no em dashes anywhere.
5. **Identifies cross-chunk patterns** - AI slop in some chunks but not others points to mixed human/machine translation.
6. **Produces one consolidated report** - single report, single score, single recommendation.
