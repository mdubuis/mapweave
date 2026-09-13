---
description: Produce an end-of-phase report for the Mapweave roadmap and ask for go-ahead before continuing
---

Read `MAPWEAVE.md` to identify the phase currently in progress. Then produce a report with these sections, in order:

1. **What changed** — files/directories added, removed, or modified during this phase, in plain terms (not a diff dump).
2. **What was validated** — commands actually run (build/lint/test) and their outcome. If something wasn't run, say so explicitly rather than omitting it.
3. **Open questions** — anything ambiguous that needs a decision before moving on.
4. **Next phase preview** — one or two sentences on what the next phase would involve.

End with an explicit question asking whether to proceed to the next phase, and update the phase status and decisions log in `MAPWEAVE.md` once the user confirms — not before.

Do not start next-phase work in this same turn, even if the answer seems obvious.
