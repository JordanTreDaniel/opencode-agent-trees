# Feature-first documentation

## Why features are first-class

A feature is a user capability, not a code module or implementation task. It exists outside its technical implementation so that refactors, new tools, or partial builds cannot silently redefine what the user asked for. Every feature record preserves the exact source quote and message ID. That provenance is mandatory: the original vision must remain recoverable even when its implementation or documentation changes.

The feature catalog is [`features.json`](./features.json), validated as a whole-file array against [`schema.json`](./schema.json) (Draft 2020-12). JSON is canonical. Human-readable pages, including [F-01 recursive recovery](./recursive-wake-up.md), render or explain the records; they do not override them.

`features.json` is canonical; `recursive-wake-up.md` is generated (`node scripts/render-wake-up.mjs`) and test-enforced — never hand-edit it.

## The feature loop

For each feature, maintain one traceable chain:

1. **Story** — the user outcome, written at Cockburn User-Goal altitude as “I can…”, without implementation nouns.
2. **Validate and invalidate** — Given/When/Then scenarios say what success looks like; explicit invalidation rules state what evidence proves the feature absent or broken.
3. **Criteria** — stable, observable proof items name what should be seen, how proof is gathered, expected values, evidence, and current proof status.
4. **Routine** — a pointer to an inventory-grade ordered procedure (trigger, inputs, steps), or an explicit null with a reason.
5. **How-to documentation** — a pointer to the user-facing skill or guide, marked present/planned/none.

The aim is **documentation = test = skill**: the story names the capability, validation and proof make it checkable, the routine describes its repeatable use, and the skill/document teaches it. These are linked records, not interchangeable artifacts: passing a proof criterion does not by itself prove the how-to documentation is usable.

## Status and lifecycle

`status` and `lifecycle` answer different questions:

- `status` records delivery: `not-implemented`, `partial`, or `implemented`.
- `lifecycle` records product maturity: `proposed`, `accepted`, `implemented`, `verified`, or `deprecated`.
- `accepted` means the intent is recorded, not that the feature is implemented.
- `verified` requires observable proof; do not infer it from code presence, research, or a passing build.
- A tentative idea may be `proposed`; `deprecated` preserves a stable ID and its history rather than deleting the feature.

## Stable links to extraction and proof systems

Each feature carries a durable `links` object: `storyId` maps to an `app-skills-extraction` `user-stories.json` item; `routineId` maps to an extraction routine when one exists; `proofIds` identify this catalog’s criteria; and `skillDocRef` points to how-to documentation. IDs remain stable when wording or implementation changes.

### `app-skills-extraction` projection

Project a feature into `user-stories.json` without losing the user-facing altitude:

| Feature record | Extraction item |
| --- | --- |
| `links.storyId` | `id` (for example, `US-001`) |
| User or beneficiary established by the source | `actor` |
| User outcome from `story` | `activity` and Cockburn User-Goal `story` |
| Observable acceptance from `validation.scenarios[].then` | `acceptanceCriteria` (2–5 strings where the extraction schema requires them) |
| Known route/action references | `relatedRoutes` / `relatedActions` |
| Appropriate scope estimate | `complexity` (`simple`, `moderate`, or `complex`) |

Do not invent an actor, route, action, or implementation detail to fill an extraction field. Keep validation/invalidation and provenance in this feature catalog if the extraction format has no corresponding field. A routine projection uses its stable routine ID and ordered steps; routine inventory fields include trigger, category, inputs, configuration, and `{order, action, target, description}` steps. The broader `feature-tree.json` can then group linked stories, routes, actions, and routines into capabilities, but is an index rather than the source of the feature contract.

### Review-dash `ProofCriteria` boundary

Feature `criteria.items[]` deliberately resembles the review-dash engine’s screenshot criteria: stable slug, description, and `expected_values`, with additional method/evidence/status fields useful to feature-level validation. It is **not** an engine-native payload. The engine expects top-level task metadata (including `task_id`, `task_title`, and `generated_at`) and screenshot criteria such as `analysis_prompt`, `selector`, and viewport details. It is keyed by a **Notion task page ID**, not a feature ID; Zod strips unknown fields. Therefore:

- Keep feature criteria here and link them through stable `proofIds`.
- When engine proof is needed, create/reference a separate engine-native criteria file and record its path in `criteria.engineRef.criteriaPath`, or record the associated Notion task page ID in `criteria.engineRef.taskId`.
- Do not put `F-01` in `task_id` or assume the engine will preserve feature-only fields.
- The engine routine captures evidence; its vision judge compares observed results with expected values; missing analysis for a slug fails validation and can requeue QA. A feature remains `verified` only when its own required proof is complete.

## Borrowed ideas and boundaries

- **Gherkin:** Given/When/Then scenario shape makes user-visible behavior testable. It is a structure, not a claim that every scenario is executable by a test runner today.
- **Jobs to Be Done:** optional `jobStory` captures “When [situation], I want [motivation], so I can [outcome]” where context adds useful clarity.
- **Spec-Kit:** keep the feature specification separate from implementation planning. `story`, validation, proof, and routine describe the contract; they do not dictate technical tasks.
- **ADR/MADR:** link architectural decisions from `notes` or a future decision reference when a choice affects the feature contract. An ADR explains a decision; it does not replace the user’s provenance or acceptance criteria.
- **Story maps / PR-FAQ:** useful optional discovery artifacts; they are not required fields and do not replace an accepted feature record.

The catalog also distinguishes a product acceptance criterion (“the parent waits for the required siblings”) from a requirement-quality checklist (“is the requirement unambiguous?”). The first belongs in validation/proof; unresolved requirement questions belong in `ambiguities`.

## Add a feature

1. Assign the next stable `F-XX` ID; never recycle a retired ID.
2. Write a user-goal `story` as “I can…” and keep implementation nouns out of it. Add a `jobStory` only when situation and motivation are known.
3. Preserve the exact user quote and source `messageId` in `provenance`. Select `direct-user-quote`, `user-correction`, or `spec-derived` honestly. Keep source fragments verbatim; explain synthesized/spec-derived provenance in `notes`.
4. Add at least one Given/When/Then scenario and at least one concrete invalidation rule.
5. Add stable proof IDs, slugs, expected values, evidence, method, and `not-run` status until evidence exists. Set the engine reference only when a real criteria path or task page ID exists.
6. Link a routine ID and its ordered contract, or set the routine reference to null and explain why. Link a present/planned how-to document.
7. Fill `links` so the feature, extraction story, routine, proof items, and skill document are traceable. Add unresolved questions to `ambiguities` rather than silently resolving them.
8. Parse both JSON files and validate the complete `features.json` array against `schema.json` before review:

   ```sh
   python3 -m json.tool docs/features/schema.json >/dev/null
   python3 -m json.tool docs/features/features.json >/dev/null
   python3 -c 'import json, jsonschema; schema=json.load(open("docs/features/schema.json")); catalog=json.load(open("docs/features/features.json")); jsonschema.Draft202012Validator(schema).validate(catalog)'
   ```

Do not mark a feature verified solely because its implementation exists. First gather the evidence named by its criteria and resolve any ambiguity that changes the expected behavior.
