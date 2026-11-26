---
name: medyra-design-system
description: "Build Medyra UI consistent with its brand and accessibility rules: maroon tokens, Plus Jakarta Sans and Inter, shadcn on Base UI, product-style cards, responsive layouts and honest illustrative labels. Use for any component or page change."
---

# medyra-design-system

## Purpose and triggers
Build Medyra UI consistent with its brand and accessibility rules: maroon tokens, Plus Jakarta Sans and Inter, shadcn on Base UI, product-style cards, responsive layouts and honest illustrative labels. Use for any component or page change.

**Agents:** medyra-feature-engineer, medyra-code-reviewer

**Required inputs:** The screen or component to change; src/app/globals.css tokens; src/components/ui.

## Workflow
1. Use token classes (text-maroon-900, bg-sand, bg-surface), never raw hex.
2. Compose links with render={<Link />} (Base UI), not asChild.
3. Reuse src/components/layout (AppHeader, AppPage, EmptyState, Pagination) and existing cards.
4. Semantic landmarks, labelled sections, visible focus, 4.5:1 contrast, motion-reduce variants.
5. Avoid heavy gradients, glassmorphism, large emojis, stock medical imagery; label illustrative UI.
6. Optional deeper guidance: .agents/skills/web-design-guidelines and vercel-react-best-practices (ignore their Vercel deployment parts).

## Medyra invariants
- CLAUDE.md 'Brand and design'.

## Validation
Component tests; lint; manual check at 375px, 768px and desktop.

## Required evidence
Screens checked and widths.

## Prohibited
New UI libraries or fonts without approval.

## Failure handling
Report design conflicts to the product steward rather than inventing a new pattern.

## Output contract
Handoff JSON.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
