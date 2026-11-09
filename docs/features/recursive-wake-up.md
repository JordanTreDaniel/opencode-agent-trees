# F-01 — Recursive leaf-first recovery

> **Status:** implemented; lifecycle: verified.
> Implementation status (2026-11-01): tree.recover implements the recursive routine and NRR discovery; adversarial/live verification passed 2026-11-09 on attempt 9 (see docs/proof/f01v1-demo/).

This page is generated from [`features.json`](./features.json) (the canonical F-01 record) by `node scripts/render-wake-up.mjs`. The JSON Schema is [`schema.json`](./schema.json).

## Intent

> for each leaf agent, i tell them 'continue and finish up'
> we repeat until the root agent is reactivated

Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`.

**User outcome:** I can finish incomplete work from its starting point without repeating completed effort.

**Recursive leaf-first recovery.** Given A user points to an incomplete root session with failed descendants. When Recovery is started without the user supplying child IDs. Then Affected leaves finish first, their separate results propagate upward behind sibling barriers, and the root is reactivated after descendant work completes.

## Inputs

- User-selected session ID (usually the root, but it may be any session in the tree)
- Existing session-family relationships and current state of descendants
- Work, messages, and results produced since the interruption
- Failure information when available: timeout, internet connection drop, or provider-credit/credential problem
- The intended model, subject to OpenCode controls

## Recovery routine

Specified behavior is supported by a source message ID and verbatim quote. Inferred behavior, if present, is separated and remains subject to confirmation.

### Specified behavior

1. **Specified** — Start from the session the user points to, usually any level and often the root, when it is incomplete.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > i come to a session (usually root, could be any level), i see that it didn't complete.

2. **Specified** — Inspect the visible failure or failed sub-agent calls and recursively check for leaf agents.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > i usually see some error that killed it (internet, ai creds) or i see red sub agent calls (failed). i click into those, check recursively for the leaf agents.

3. **Specified** — For each leaf agent, tell it to continue and finish up.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > 3. and for each leaf agent, i tell them "continue and finish up [and wake up your parent by injecting your summary into thier context with brief note about what happened to you]"

4. **Specified** — Prefer for the leaf to wake its parent by injecting its own summary into the parent context with a brief note about what happened.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > wake up your parent by injecting your summary into thier context with brief note about what happened to you

5. **Specified** — Alternatively, wait for the child to complete, collect its output, and give it to the parent.
   - Source: `msg_199e0ded5001LRE6FdrhlXgVHz`
   - Verbatim:
     > wait for the child to complete and then we have to grab the output and then we have to give it to the parent.

6. **Specified** — Keep each child handoff separate so the parent can tell what each sub-agent did.
   - Source: `msg_199e40807001BLRGXI6IOev1RX`
   - Verbatim:
     > I imagine that they keep it separate so that they can tell what each sub agent did.

7. **Specified** — When multiple children failed, wait for both before letting the parent get cooking.
   - Source: `msg_199e0ded5001LRE6FdrhlXgVHz`
   - Verbatim:
     > especially if multiple failed, because then we would have to Wait for both of those children before we really want the parent to get cooking or whatever.

8. **Specified** — Let the parent know that recovery of its children is underway.
   - Source: `msg_199e0ded5001LRE6FdrhlXgVHz`
   - Verbatim:
     > We want the parent to know that we are finishing their children.

9. **Specified** — Prefer leaf wake-up so that the parents are then woken recursively as each child finishes and passes its work upward.
   - Source: `msg_199e0ded5001LRE6FdrhlXgVHz`
   - Verbatim:
     > preferably we wake up the leaf and then that will recursively wake up the parents whenever each child finishes and they will pass their stuff to the parent.

10. **Specified** — Repeat until the root is reactivated with all descendants successfully finished.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > we repeat until the root agent is reactivated, with all descendants having successfully finished.

11. **Specified** — Account for what happened since the chain died and avoid duplicating effort or results.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > time and turns - knowing what happened since the sub agent chain died, and respecting it/not duplicating effort or results.

12. **Specified** — When existing investigations compete, recognize that deciding who did the work/investigation better may be necessary.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > then its a question of who did the work/investigation better

13. **Specified** — Account for behavior differences across timeout, internet-drop, and provider-credential errors under OpenCode controls.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_180`
   - Verbatim:
     > the diff in behavior from timeout, internet drop, open ai creds, with the diff types of errors, and agent-tree behavior based on those (oc controls)

14. **Specified** — Pin all agents involved, including orchestrators, to the intended model.
   - Source: `msg_199dd1a64001gFayw1KkAJbIMA_54`
   - Verbatim:
     > beware you must pin all agents involved to your own model, and orchs must do the same.

### Scope of unresolved mechanics

The specified steps describe the desired outcome and handoff preference, but do not specify coordinator implementation mechanics. Do not infer a payload schema, summary length, or coordination mechanism from “summary” and “brief note.”

### Open questions

- How to distinguish failed from slow or still-running sessions.
- Which descendants are required participants in a sibling barrier.
- Who coordinates and what mechanism it uses when a child cannot wake its parent.
- Handoff payload schema, exact fields, summary length, and ordering; only a summary plus a brief note is specified.
- Reconciliation authority when messages, journals, or files conflict, including how to compare competing investigations.
- Termination meaning (root running, root task done, or every descendant verified).
- Model/depth defaults beyond explicit pinModel behavior and model inheritance for sessions not resumed by this run.
- Data-model schema and persistence.
- Whether core-restart emulation belongs in this plugin.
- What retry, wait, model-switch, or stop policy applies to each failure class (timeout, network drop, provider credits/creds)?

## Termination condition

The specified stopping point is: the root is reactivated with all descendants successfully finished. What “successfully finished” proves, and whether root reactivation is sufficient or the root’s task must also be complete, remain open questions. Do not claim the workflow is verified until that termination contract is resolved and observable proof passes.

## Why this was lost

The failed build translated the requested workflow into five primitives—`whoami`, `family`, `journal`, `handoff`, and `wake`—but never implemented the crawler, the sibling barrier, or upward result bubbling. Those primitives do not by themselves satisfy the leaf-first recovery feature.

## Proof status

- `PC-F-01-01` — Affected leaves finish first, their separate results propagate upward behind sibling barriers, and the root is reactivated after descendant work completes. **not-run**.
- These are feature-level criteria, not engine-native ProofCriteria. The review-dash engine is keyed by Notion task-page ID (task_id), not feature ID; when engine proof is needed, reference the engine-native criteria file by path or attach its task page ID here. Unknown feature fields are stripped by the engine.
- Engine reference: task ID not assigned; criteria path not assigned.

## Record notes

- The inventory combines two exact quote fragments from the same source message.
- Verified 2026-11-09: F-01-V1 acceptance passed on attempt 9 (root ses_e408c94f5ffewWj2xFGZsfC8z4) — an exact 1/2/4 tree of 7 sessions was built and interrupted, tree.recover resumed all 7 with rootReactivated=true, all 6 handoffs were delivered with parentResumed=true, and every original session finished idle_outcome=succeeded with a recovery:done journal entry (descendant count still exactly 7). Adversarial verification PASSed against the primary artifacts. Evidence: docs/proof/f01v1-demo/.
