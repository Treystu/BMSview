# BMSview Integration Audit - Estimation Policy

**Date:** 2026-01-20
**Status:** MANDATORY FOR ALL PLANNING
**Enforcement:** Non-negotiable

---

## Core Policy

**ALL effort estimates related to BMSview integration work use LOC (Lines of Code) only.**

---

## What is LOC?

**LOC = Lines of Code = Scope of Code Changes Needed**

Examples:
- "200-300 LOC" = "This fix requires changing/adding 200-300 lines of code"
- "400-600 LOC" = "This feature requires 400-600 lines of code to implement"
- "1700-2450 LOC" = "Total project scope is 1700-2450 lines of code across all phases"

**LOC indicates SCOPE, NOT DURATION.**

---

## What is PROHIBITED

❌ **DO NOT use these:**
- "X hours" or "X hours of work"
- "X days" or "X weeks"
- "timeline is X"
- "when will this be done in X"
- "how long will this take"
- "this will take 2-3 weeks"
- Any time-based estimate

❌ **DO NOT translate LOC to time:**
- "1000 LOC = 10 hours" (WRONG)
- "1000 LOC = 2-3 days" (WRONG)
- "1000 LOC ≈ 1 week" (WRONG)

❌ **DO NOT create time-based schedules:**
- "Week 1: Phase 1"
- "By Friday: Phase 2A"
- "Target deployment: March 15"

**Violating this policy invalidates planning.**

---

## What is REQUIRED

✅ **DO use LOC for all estimates:**
- "This requires 200-300 LOC"
- "Phase 1: 150-200 LOC"
- "Total scope: 1700-2450 LOC"
- "Solar integration: 400-600 LOC"

✅ **DO document duration variation factors:**
When discussing LOC estimates, also note:
- "Implementation time varies based on AI model capabilities"
- "Actual duration depends on developer familiarity with codebase"
- "Testing depth affects implementation timeline"
- "Integration complexity may be discovered during implementation"

✅ **DO use LOC for planning priorities:**
- "Critical work: 700-900 LOC"
- "Important work: 300-400 LOC"
- "Optional work: 250-400 LOC"

✅ **DO use LOC for budget allocation:**
- "Phase 2C: 750-1050 LOC (largest phase)"
- "Phase 3: 300-500 LOC (optimization phase)"

---

## Why This Policy?

### Reason 1: Time estimates are unreliable
- Different AI models have different speeds
- Developers familiar with codebase work faster
- Testing depth varies
- Integration complexity varies
- Performance optimization adds time

**Result:** Time estimates are 2-5x wrong historically

### Reason 2: LOC is reliable and objective
- Code is code - 200 LOC is 200 LOC
- Scope is clear and measurable
- Easy to verify: count the lines
- Doesn't change based on who implements it

**Result:** LOC estimates are accurate scope indicators

### Reason 3: Prevents false confidence
- "2 weeks" sounds doable, then slips to 4 weeks
- "1000 LOC" is objective: either you implement it or you don't
- No false promises about timeline

---

## How To Apply This Policy

### When Planning:
```
❌ WRONG: "Solar integration takes 15-20 hours"
✅ RIGHT: "Solar integration is 400-600 LOC"
```

### When Documenting:
```
❌ WRONG: "This will be done in 2-3 weeks"
✅ RIGHT: "This phase is 1000-1300 LOC.
           Duration varies based on model capabilities
           and developer familiarity with codebase."
```

### When Discussing Timelines:
```
❌ WRONG: "We can deploy by March 1st if we start now"
✅ RIGHT: "We can execute Path B (1000-1300 LOC) immediately.
           Actual deployment date depends on implementation speed
           and AI model capabilities."
```

### When Estimating Progress:
```
❌ WRONG: "We're 30% done in 1 week, so 2 more weeks to finish"
✅ RIGHT: "We've completed 300 LOC of 1700 LOC scope (18%).
           Remaining 1400 LOC depends on complexity discovered."
```

---

## Enforcement

### Document Level
- All planning documents use LOC estimates
- If time-based language is found, it's corrected immediately
- Documents with hours/days/weeks are considered invalid

### Team Level
- Code reviews flag any time-based estimates
- Pull requests cannot merge with time-based planning
- Retrospectives track LOC completed vs estimated

### Project Level
- Roadmaps are LOC-based
- Status reports track LOC completion
- Success metrics are LOC-based, not time-based

---

## Current Status

**All Integration Audit documents have been updated to:**
- ✅ Use LOC-only estimates
- ✅ Remove all time-based language
- ✅ Document variation factors
- ✅ Include enforcement notes

**Policy enforced in:**
- INTEGRATION_ACTION_PLAN.md
- INTEGRATION_STRATEGY_ALIGNED_V3.md
- READY_FOR_EXECUTION.md
- README_INTEGRATION_AUDIT_V3.md
- This document (ESTIMATION_POLICY.md)

---

## Reference: Current Estimates (LOC Only)

```
Path C (Production-Grade System):

Phase 1: Investigation           150-200 LOC
Phase 2A: Data source fixes      200-300 LOC
Phase 2B: Async implementation   300-400 LOC
Phase 2C: Integration            750-1050 LOC
Phase 3: Sync & optimization     300-500 LOC
                                 ___________
TOTAL:                          1700-2450 LOC

By Component:
  Solar integration:        400-600 LOC
  Async optimization:       300-400 LOC
  Weather integration:      150-250 LOC
  Sync optimization:        200-300 LOC
  Data sources:             200-300 LOC
  Historical patterns:      100-150 LOC
  Testing & docs:           100-150 LOC
  Conditional features:     100-150 LOC
```

**These LOC estimates are the SCOPE of work.**
**Actual implementation duration depends on AI model, developer, and complexity.**

---

## Questions?

If a document uses time-based estimates:
1. Flag it as violating policy
2. Replace with LOC estimate
3. Document variation factors
4. Update this policy log if new variation factors discovered

---

**Policy Version:** 1.0
**Effective Date:** 2026-01-20
**Status:** MANDATORY - ALL PLANNING MUST USE LOC

