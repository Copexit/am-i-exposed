---
name: transcreation-exposed
description: "Transcreation skill for am-i.exposed content. Use when translating content for am-i.exposed between any supported language pair. Produces translations that preserve meaning, intent, and rhetorical effect - not word-for-word equivalents. Applies the am-i.exposed voice in the target language. Trigger on: translate, transcreate, ins Deutsche, into English, auf Englisch, auf Deutsch, i18n, localize, sync translations."
---

# am-i.exposed Transcreation

Translate am-i.exposed content with domain precision. This skill handles UI strings from `public/locales/en/common.json`, FAQ text, glossary definitions, marketing copy, and technical privacy documentation. Every translation must be terminologically exact, tonally correct, and free of slop.

---

## Part 1: am-i.exposed Voice

am-i.exposed is a client-side Bitcoin privacy analysis tool. The voice reflects that.

**Register:** Technical privacy tool. Direct over diplomatic. Precise over warm. Educational over alarming.

**Audience assumption:** Users understand Bitcoin basics. They know what a transaction, address, and UTXO are. They may not know chain analysis techniques - that is what the tool teaches. Do not over-explain Bitcoin concepts in UI strings. Glossary entries and guide pages can provide more context.

**Critical voice rules (from CLAUDE.md):**
- **Never use "we", "us", or "our"** in UI copy, metadata, FAQ answers, or any user-facing text. This tool is not a person, company, or group.
- Use **passive voice** or refer to the tool by name ("am-i.exposed").
- Data is never "transmitted to us" - say "transmitted to anyone" or specify the actual recipient (e.g., "mempool.space for blockchain data").
- **No em dashes** in any form. Use a regular hyphen with spaces instead: ` - `.

**Tone gradient:**

| Content type | Register |
|---|---|
| UI strings (buttons, labels, scores) | Neutral, functional. Zero decoration. |
| Finding descriptions | Technical, specific. Name the heuristic and what it reveals. |
| Remediation advice | Direct and actionable. Tell the user what to do. |
| Glossary definitions | Educational, concise. Explain once, with precision. |
| FAQ answers | Conversational but factual. Respect the reader's intelligence. |
| About / marketing | More expressive, but never breathless. Privacy over excitement. |

**Active voice.** Direct instructions. Short sentences for UI. The tool reports findings; the user takes action.

**Prohibited patterns:**
- First person plural: "We analyze...", "Our tool...", "We don't store..."
- Crypto-bro language: "WAGMI", "HODL", "to the moon", "LFG"
- Surveillance FUD: "Big Brother is watching", "They're tracking everything"
- Vague privacy buzzwords: "seamlessly private", "bulletproof anonymity", "military-grade encryption"
- False urgency: "Act now!", "Your privacy is at risk!"
- Exclamation marks in UI strings. Period.
- Em dashes in any form.

**What the voice sounds like:** A competent privacy analysis tool that respects the user's intelligence. It tells you what chain analysis can infer, what the privacy implications are, and what you can do about it. It does not lecture, alarm, or sell.

---

## Part 2: Translation Process

Five steps. Every translation goes through all five. No shortcuts.

### Step 0: Classify content type

Before writing a single word, classify the source:

- **(a) UI strings** from `common.json` - keys like `finding.H1_title`, `common.scan`, `results.grade`
- **(b) Finding descriptions** - heuristic explanations, analyst verdicts, severity descriptions
- **(c) Glossary definitions** - `glossary.def_*` keys, educational privacy/Bitcoin content
- **(d) Guide / FAQ content** - `guide.*`, `faq.*`, `methodology.*` keys
- **(e) About / marketing** - `about.*` keys, landing page content, feature descriptions

Classification determines which rules dominate. UI strings prioritize brevity and consistency. Glossary entries prioritize clarity. About/marketing prioritizes natural flow.

### Step 0b: Determine translation scope

Before translating, determine whether this is a **full translation** (new locale, empty target file) or a **partial update** (target file exists with some translations). For partial updates, diff the source against the target to classify every key:

**Key states:**

| State | How to detect | Action |
|---|---|---|
| **New** | Key exists in English but not in target | Translate. Primary task for partial updates. |
| **Changed** | Key exists in both, but English value differs from what was originally translated | Re-translate. The source text changed. |
| **Unchanged** | Key exists in both, English value matches what was translated | Keep the existing translation. Do not re-translate. |
| **Orphaned** | Key exists in target but not in English | Flag for removal. Report to user - the key may have been renamed. |

**How to diff for UI strings (common.json):**

1. Read `public/locales/en/common.json` - this is the canonical key list.
2. Read the target file (e.g., `public/locales/de/common.json`).
3. Build three lists: keys in English but not target (new), keys in target but not English (orphaned), and keys in both (existing).
4. For the "existing" set: compare English values to infer whether the source changed. If unsure, keep the existing translation and flag it for review rather than re-translating blindly.

**Subagent implications:** When spawning subagents for a partial update, each subagent's prompt should clearly state which keys to translate (new), which to re-translate (changed), and which existing translations to use as consistency context (unchanged). Do not send unchanged keys as part of the translation task - include them as read-only reference.

### Step 1: Understand before writing

**For UI strings (small batch, under ~100 keys):** Read all source keys and their existing target translations before writing anything. For larger batches, this step happens per-chunk inside each subagent - see Part 6.

**For UI strings:** Read the dot-namespaced key. `finding.H1_title` tells you this is a finding title for heuristic H1. `remediation.H1_action` is a remediation action step. That context determines register, length, and grammar.

**For long-form content:** Read the entire source. Identify the argument structure, the rhetorical devices, the intended emotional arc. Mark section boundaries and key claims.

### Step 2: Extract intent

**For UI strings:** State in one phrase what the user learns or does. "Address reuse detected" = the tool found the same address used in multiple transactions. "Use coin control" = the tool recommends the user select specific UTXOs.

**For long-form content:** State the core argument in one sentence. Identify what the reader should think, feel, or do after reading. Note any rhetorical devices worth preserving.

### Step 3: Write in target language

**For UI strings:** Match the source's brevity and register. If the English is three words, aim for three words. If the target language needs five, use five, but never pad. Translate the intent, not the syntax.

**For long-form content:** Write as if composing from scratch in the target language. A native reader should not detect translation. Preserve argument structure and rhetorical devices, but rebuild sentences to sound natural.

### Step 4: Stop-slop pass

**When to apply:** Long-form content (glossary definitions, FAQ answers, about page, guide sections) and multi-sentence UI strings. Skip for short UI strings - labels, buttons, headings, scores, and any string under ~10 words.

**How to invoke:** The orchestrator and single-agent translations should invoke the `stop-slop` skill via the Skill tool for the final assembled output. Subagents apply the checklist manually (they cannot invoke skills).

Check for:
- Connective tissue added during translation ("in this regard", "it should be noted")
- Parallel structures that crept in from the source language
- Passive voice where the source used active (note: passive is appropriate for am-i.exposed when avoiding first-person)
- Hedges and softeners absent from the source ("perhaps", "might", "it seems")
- Filler adverbs ("basically", "essentially", the target-language equivalents)
- Any word in the translation that has no corresponding word or intent in the source
- First-person plural ("we", "us", "our") - must never appear

---

## Part 3: UI String Rules

These rules apply to all translations of `public/locales/*/common.json` keys.

**How to read common.json:** Each entry is a key-value pair in flat JSON. Example:
```json
"finding.H1_title": "Address Reuse Detected"
```
- **The key** (left side: `finding.H1_title`) is the dot-namespaced label. It tells you what namespace the string belongs to and what kind of element it is. Never translate the key. Read it for context.
- **The value** (right side: `"Address Reuse Detected"`) is the English source text. This is what you translate.

**1. Consult the source of truth.** Before translating any UI term, read `public/locales/en/common.json` for the established English wording. The value is the canonical text.

**2. Check existing translations.** Before writing, read the target locale file (e.g., `public/locales/de/common.json`). If the term has been translated before, match it. Consistency across the app is non-negotiable.

**3. Brevity is mandatory.** UI labels occupy fixed space. If the target language runs longer than the source, abbreviate. Never add words absent from the source.

**4. Preserve `{{variable}}` placeholders exactly.** Never translate text inside double braces. `{{count}}` stays `{{count}}`. `{{address}}` stays `{{address}}`. Wrong: `{{Anzahl}}`. Note: this project uses i18next double-brace syntax `{{var}}`, not single-brace `{var}`.

**5. Preserve HTML tags exactly.** `<span>`, `<b>`, `<br/>`, `<1>`, `<0>` stay as-is. Translate only the text content between tags. Never reorder tags.

**6. One English term = one target term, everywhere.** "Address reuse" is always the same translation within a locale. Never use different terms for the same concept in different screens. Refer to the terminology list in Part 4.

**7. Use dot-namespaced keys for context.** `finding.H1_title` is a finding title. `remediation.H1_action` is an action step. `glossary.def_address_reuse` is a glossary definition. The key hierarchy tells you the UI element type, which determines grammar and register.

**8. Button labels use imperative verbs.** "Scan" = "Scannen" (DE), not "Scan-Vorgang". "Export" = "Exportieren", not "Der Export".

**9. Error messages: specific, not generic.** If the source says "Invalid address for this network", translate the specific error.

**10. Length ceiling: ~150% of source.** If the English string is 20 characters, the target should not exceed 30. German compounds may push this. Use judgment, but flag anything that doubles the source length.

**11. Don't add pedantic punctuation.** UI strings prioritize natural flow over grammar-book correctness.

**12. Capitalization follows target-language rules.** English title-cases headings; most other languages do not. Spanish and Portuguese capitalize only the first word. German capitalizes nouns but not adjectives/verbs. French capitalizes only the first word.

**13. No first-person plural.** If the English source accidentally uses "we" or "our", fix it in translation. Use passive voice or refer to "am-i.exposed" by name.

---

## Part 4: Domain Terminology

### Bitcoin Privacy Terms - Do Not Translate

These terms stay in English in all target languages:

> Bitcoin, Satoshi/Sats, Lightning, UTXO, CoinJoin, PayJoin, Stonewall, Whirlpool, WabiSabi, JoinMarket, PayNym, BIP47, Taproot, SegWit, Multisig, P2P, Mainnet, Testnet, Signet, xpub, PSBT, Tor, mempool, hash, on-chain, off-chain, Open Source, HD Wallet, Seed Phrase

### Terms That Must Be Translated Consistently

| English | Context | Notes |
|---|---|---|
| Address reuse | Privacy heuristic | Each language has one term, used everywhere |
| Change output / change detection | Transaction analysis | "Change" as in transaction change, not "modify" |
| Peel chain | Chain analysis pattern | Some languages keep "peel chain" as loan term |
| Dust attack | Privacy attack | Translate conceptually |
| Taint / taint analysis | Fund tracing | Translate conceptually |
| Privacy score | 0-100 rating | Translate consistently |
| Finding | Analysis result | A specific privacy observation |
| Remediation | Fix/action | The suggested action to improve privacy |
| Heuristic | Analysis technique | May keep as loan word in some languages |
| Entity | Known service/organization | Exchange, mixer, etc. |
| Cluster | Group of linked addresses | Translate consistently |
| Round amount | Transaction pattern | Translate conceptually |
| Script type | Address format | Technical, may keep English |

### Per-Language Notes

**German (de):**
- Sie-form for formal address unless existing file uses du (check the file)
- Bitcoin compound words: "Adresswiederverwendung" (address reuse), "Wechselgeld-Erkennung" (change detection)
- Keep technical loan words where established: "Heuristik", "Cluster"
- "Transaktion" not "Überweisung" (that implies bank transfer)

**Spanish (es):**
- Latin American Spanish (the existing file uses this convention)
- "Reutilización de direcciones" for address reuse
- Keep loan words where natural: "cluster", "heurística"

**Portuguese (pt):**
- Brazilian Portuguese conventions (existing file follows this)
- "Reutilização de endereços" for address reuse
- Similar loan word patterns to Spanish

**French (fr):**
- Formal vous register
- "Réutilisation d'adresses" for address reuse
- French typography: non-breaking space before `:`, `?`, `!`, `;`

---

## Part 5: Long-Form Content

For glossary definitions, FAQ answers, guide sections, and about page copy, apply the full transcreation process (Steps 0-4). Do not line-translate.

### Privacy Tool Voice in Long-Form

am-i.exposed long-form content communicates three things:
1. **Education.** Explain what chain analysis can infer and how.
2. **Actionability.** Tell the user what to do about it.
3. **Empowerment.** Privacy is achievable. Specific techniques work.

No FUD. No paranoia. No "they're watching everything." State what the tool detects. Let the reader evaluate.

### Rhetorical Devices Worth Preserving

| Device | Example | Handling |
|---|---|---|
| Specific heuristic reference | "H3: Round Amount Detection" | Keep the heuristic code. Translate the name. |
| Privacy score context | "A score below 40 indicates significant privacy leaks" | Keep the number. Adapt formatting to locale. |
| Tool reference | "am-i.exposed detects this pattern" | Keep tool name. Never translate "am-i.exposed". |
| Concrete example | "If you send exactly 0.1 BTC..." | Translate the framing. Keep the Bitcoin amount. |

---

## Part 6: Subagent Strategy

For large translation jobs, split work across subagents. Each subagent operates independently but follows the same rules.

### Model recommendations

| Role | Model | Why |
|---|---|---|
| Orchestrator | Opus | Judgment calls, cross-chunk consistency, assembly |
| UI string subagents | Sonnet | Formulaic strings, well-constrained by terminology |
| Long-form subagents | Opus | Creative language work, voice preservation |

### When to use subagents

**UI strings - full translation:** Always use subagents for the full `common.json` (~2061 keys). A single agent can handle one namespace of up to ~500 keys.

**UI strings - partial update:** Run the Step 0b diff first. If the total number of new + changed keys is under ~100, a single agent is fine. If the delta exceeds ~100 keys or spans 3+ namespaces, use subagents.

**Ad-hoc batches** under ~100 keys: a single agent is fine regardless of scope.

### Reading very long source files

Before chunking, the orchestrator must scan the full source file and the full target file. For large JSON files like `common.json`:

1. **Read the file in sections** - use offset/limit reads by namespace prefix.
2. **Build a namespace inventory** - list every top-level namespace prefix and its key count. Current distribution (2061 keys total): `finding.*` (484), `remediation.*` (148), `pathways.*` (117), `methodology.*` (108), `setup.*` (103), `glossary.*` (74), `settings.*` (66), `wallet.*` (66), `about.*` (58), `walletGuide.*` (55), `common.*` (49), `page.*` (49), `viz.*` (49), `primaryRec.*` (48), plus ~30 smaller namespaces. Always re-count from the actual file.
3. **Scan existing target translations** - read the target locale file. Run the Step 0b diff.
4. **Write the consistency brief** - using the inventory and a sample of keys from each namespace.

### UI Strings (common.json)

Chunk by key namespace prefix. Suggested groupings:

- `finding.*` (484) - privacy findings, heuristic results, severity descriptions
- `remediation.*` + `primaryRec.*` (196) - remediation actions and primary recommendations
- `pathways.*` + `methodology.*` (225) - analysis pathways and methodology
- `glossary.*` (74) - glossary definitions (dedicated subagent - educational content)
- `setup.*` + `settings.*` + `wallet.*` + `walletGuide.*` (290) - setup, settings, wallet features
- `about.*` + `welcome.*` + `faq.*` + `guide.*` (142) - about, welcome, FAQ, guide
- Everything else (~650) - common UI, viz, scores, errors, etc.

**Warning: `wallet.*` and `walletGuide.*` are distinct namespaces.** Do not merge them. Assign by first dot-segment only.

### What Every Subagent Receives

1. This skill's rules (embed the relevant Parts - typically Parts 1-4 and the delivery checklist)
2. The stop-slop checklist from Step 4 (subagents apply it manually)
3. The consistency brief (see template below)
4. Their assigned chunk - source keys and any existing target translations, **embedded directly in the subagent prompt as text**

**Critical: no filesystem handoff.** Subagents cannot access `/tmp/` or other temporary directories. Embed the source keys and any existing target translations directly in the subagent's prompt text.

### Subagent Output Contract

Every subagent must return its translation as **inline JSON in the final message text**. No file writes. No filesystem paths. The orchestrator parses the returned text directly.

Format: a JSON object where keys are the common.json keys and values are the translated strings.

```json
{
  "finding.H1_title": "Adresswiederverwendung erkannt",
  "finding.H1_desc": "Diese Adresse wurde in mehreren Transaktionen verwendet"
}
```

The orchestrator should strip code fences defensively when parsing.

### Consistency Brief Template

Write this before spawning any subagent. Every subagent gets the same brief.

```
## Consistency Brief
**Direction:** [EN->DE / EN->ES / EN->PT / EN->FR]
**Target locale:** [de / es / pt / fr]
**Content type:** [UI strings / Glossary / Guide / About]
**Audience:** [Bitcoin users checking their transaction privacy]
**Terminology decisions:** [List any ambiguous terms and the chosen translation]
  - "finding" -> [chosen term]
  - "remediation" -> [chosen term]
  - "heuristic" -> [chosen term]
  - "change output" -> [chosen term]
  - "peel chain" -> [chosen term]
**Voice note:** No first-person plural. Passive voice or "am-i.exposed" by name.
**Do not:**
  - Do not translate Bitcoin/privacy terms from the do-not-translate list
  - Do not add explanatory text absent from source
  - Do not use "we", "us", or "our"
  - Do not use em dashes
```

### Error Recovery

- **Malformed JSON:** Strip code fences and retry parse. One retry. If it fails again, the orchestrator translates that chunk directly.
- **Missing keys:** Diff the returned keys against the assigned chunk. Re-prompt with just the missing keys.
- **Terminology inconsistency across chunks:** The orchestrator fixes these during recombination.
- **Truncated output:** Re-prompt: "Your output was truncated. Continue from the last complete key-value pair."

### Recombination

After all subagents return:

1. Assemble chunks in source order
2. Review joins between chunks - no register shifts
3. Cross-chunk terminology check: same English term must map to same target term everywhere
4. Final stop-slop pass on long-form content and multi-sentence strings - invoke the `stop-slop` skill via the Skill tool
5. Spot-check five random strings against the consistency brief
6. Verify no "we/us/our" in any string

---

## Part 7: Delivery Checklist

Run every item. No exceptions.

### Single-agent translations

- [ ] Read the full source before writing anything
- [ ] Can state the intent of each string/section in one sentence
- [ ] Reproduced rhetorical devices, not just words
- [ ] Rhythm is natural in the target language
- [ ] Translation matches am-i.exposed's direct, technical, privacy-focused voice
- [ ] Stop-slop pass complete on multi-sentence strings and long-form content
- [ ] No first-person plural ("we", "us", "our") anywhere
- [ ] No em dashes anywhere

### Additional for UI strings

- [ ] Consulted `public/locales/en/common.json` for established English wording
- [ ] Checked existing translations in target locale file for consistency
- [ ] All `{{variable}}` placeholders preserved exactly as-is (double-brace i18next syntax)
- [ ] All HTML tags preserved exactly
- [ ] Bitcoin/privacy terms kept in English per do-not-translate list
- [ ] No UI string introduces words absent from the English source
- [ ] No string exceeds ~150% of source character length
- [ ] Button labels use imperative verbs in target language
- [ ] Dot-namespaced key context was used to determine register and grammar

### Additional for subagent translations

- [ ] Consistency brief written and reviewed before spawning subagents
- [ ] Every subagent received the brief, this skill's rules, and the stop-slop checklist
- [ ] Each subagent applied stop-slop to multi-sentence strings in its chunk
- [ ] Joins between chunks reviewed
- [ ] Final stop-slop pass across long-form content and multi-sentence strings
- [ ] Terminology consistent across all chunks
- [ ] Five random strings spot-checked against consistency brief
- [ ] No first-person plural in any chunk
