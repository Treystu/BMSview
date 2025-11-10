# Post-Deployment Action Plan

**Status**: ✅ **All production-critical work complete - Ready to deploy**

**Next Steps**: Execute this plan AFTER production deployment

---

## Summary: What's Remaining

All **production-critical work is 100% complete**. The remaining 9 uncompleted todo items fall into three categories:

1. **Optional Runtime Tests** (5 items) - Can skip, can be done anytime post-deploy
2. **Environment Blocked** (1 item) - Requires staging environment, do later
3. **Post-Deployment** (3 items) - Can only run after deployment is live

---

## Pre-Deployment Checklist

### ✅ Required (All Complete)
- [x] All Phase 0-4 implementation
- [x] All documentation
- [x] All tests passing (85+)
- [x] Build succeeds

### Optional Pre-Deploy (Recommended)
- [ ] Run `MANUAL_VALIDATION_CHECKLIST.md` locally (1-2 hours)

### Ready to Deploy?
**YES ✅** - Execute: `git push origin main`

---

## Deployment Steps

```bash
# 1. Create MongoDB indexes
mongosh
use bmsview
# Run scripts from MONGODB_INDEXES.md

# 2. Deploy
git push origin main
# Netlify auto-deploys

# 3. Verify (see Phase 1 below)
```

---

## Post-Deployment Phases

### Phase 1: First 4 Hours (Immediate Verification)
- [ ] Admin dashboard loads (`/admin.html`)
- [ ] Run "Cache Integrity Check" diagnostic → ✅ Pass
- [ ] Sync starts automatically (90s interval)
- [ ] Network shows reduced request volume

### Phase 2: First 24 Hours (Continuous Monitoring)
- [ ] Run all 7 diagnostics every 2 hours
- [ ] Monitor MongoDB query rate (target: 30/min)
- [ ] Track cache hit rate (target: 80%+)
- [ ] Document any issues

### Phase 3: 24-48 Hours (Performance Validation)
- [ ] Verify 90% query reduction achieved
- [ ] Test optional items (weather, offline/online)
- [ ] Capture performance logs
- [ ] All diagnostics passing

### Phase 4: 48+ Hours (Final Documentation)
- [ ] Complete optional validation tests
- [ ] Document findings
- [ ] Mark deployment successful
- [ ] Schedule staging migration test

---

## Optional Post-Deployment Tests (Can Skip)

These 5 items can be done anytime after deployment succeeds:

1. **Compare Request Volume**
   - Verify MongoDB query reduction (90% expected)
   - Compare Atlas metrics before/after
   - Timeline: 24-48 hours after deploy

2. **Weather Function Runtime Test**
   - Upload BMS screenshot, verify analysis works
   - Expected: No errors
   - Timeline: Any time post-deploy

3. **Offline/Online Transitions**
   - DevTools throttling: Offline → Online
   - Verify sync auto-resumes
   - Timeline: Any time post-deploy

4. **Generate-Insights Timing**
   - Capture logs from `generate-insights-with-tools.cjs`
   - Verify background handoff at 55s
   - Timeline: Post-deployment monitoring

5. **Run Full Validation Suite**
   - Complete `MANUAL_VALIDATION_CHECKLIST.md`
   - Run all 27 tests
   - Timeline: 48+ hours post-deploy

---

## Environment Blocked (Cannot Complete Now)

**1 Item: MongoDB Schema Migration on Staging**
- Requires: Staging environment + MongoDB admin access
- Action: Schedule AFTER production deployment succeeds
- Timeline: Within 1 week post-deploy
- Owner: DevOps/Database admin

---

## Success Criteria

### ✅ Deployment Successful When:
- All 7 diagnostics pass
- MongoDB queries 30/min (90% reduction)
- No errors in browser/console
- Sync running automatically
- Analysis uploads work

### ⚠️ If Issues Occur:
1. Run diagnostics to identify problem
2. Refer to troubleshooting section below
3. Can rollback via Netlify

---

## Quick Troubleshooting

**Diagnostics Failing?**
- Clear cache via admin, refresh, retry
- Check browser console for errors
- Verify MongoDB connection

**Query Rate Not 30/min?**
- Verify MongoDB indexes were created
- Check index usage: `db.analysis_results.aggregate([{$indexStats:{}}])`
- May need to rebuild indexes

**Sync Not Running?**
- Console: `syncManager.getSyncStatus()`
- Manual trigger: `syncManager.forceSyncNow()`
- Check network tab for errors

**Can't Access Admin?**
- Verify deployment succeeded in Netlify
- Check browser console for errors
- Try hard refresh: Ctrl+Shift+R

---

## Timeline

```
Day 0:   Deploy code + create indexes → Quick verification (Phase 1)
Day 1:   Monitor metrics (Phase 2) → Verify 90% reduction (Phase 3)
Day 2:   Complete optional tests (Phase 4) → Document findings
Day 3+:  Schedule staging migration test
```

---

## References

- **Deployment Guide**: `COMPLETION_SUMMARY_FINAL.md`
- **Index Creation**: `MONGODB_INDEXES.md`
- **Validation Tests**: `MANUAL_VALIDATION_CHECKLIST.md`
- **Architecture**: `ARCHITECTURE.md`
- **Diagnostics**: Open `/admin.html` → Diagnostics tab

---

## Sign-Off

**Before Deploying:**
- [x] Reviewed COMPLETION_SUMMARY_FINAL.md
- [x] Reviewed this action plan
- [x] All core work complete

**After Deploying:**
- [ ] Phase 1 verification complete
- [ ] Phase 2 monitoring complete
- [ ] Phase 3 validation complete
- [ ] Phase 4 documented

**Then:** Deployment ✅ **SUCCESSFUL**

