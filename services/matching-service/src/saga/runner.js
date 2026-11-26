const { SagaError, LeaseLostError } = require('./errors');
const { withSpan, runInTraceparent } = require('../common/spans');
const { runWithContext } = require('../common/context');
const { withRetry } = require('../common/retry');
const logger = require('../common/logger');

// Orchestration-style saga engine. One place decides what happens next, so the
// whole flow can be read top to bottom (the alternative, choreography, spreads
// that logic across services reacting to each other's events).
//
// The runner holds NO state between calls: everything it needs is in the saga
// document (store). If the process dies, any replica can load the document and
// continue. That is why matching-service can run as 2+ replicas.
//
// store interface (Mongo in production, in-memory in tests):
//   claim(rideId, owner, leaseMs) -> saga | null   atomically take ownership
//   save(saga)                    -> boolean       false if we no longer own it
//   renew(rideId, owner, leaseMs) -> boolean
//   release(rideId, owner)
//   requestCompensation(rideId, failure) -> boolean  COMPLETED -> COMPENSATING

function createRunner({
  store, steps, owner,
  leaseMs = 30000,
  maxCompensationRounds = 5,
  isCancelRequested = async () => false,
  onCompensationFailed = async () => {},
  now = Date.now,
  retryOpts = {},
}) {
  const ensureLease = (lease) => { if (lease.lost) throw new LeaseLostError(); };

  // Persist the whole saga. Fencing: the store only writes if we still own the
  // lease, so a "zombie" orchestrator (paused, then woken after another replica
  // took over) cannot overwrite the new owner's progress.
  async function persist(saga) {
    if (!(await store.save(saga))) throw new LeaseLostError();
  }

  async function startCompensation(saga, stepName, reason, message) {
    saga.state = 'COMPENSATING';
    saga.failure = { step: stepName, reason, message, at: now() };
    logger.warn('saga failed, compensating', { rideId: saga.rideId, step: stepName, reason });
    await persist(saga);
  }

  async function forward(saga, lease) {
    for (const step of steps) {
      if (saga.completedSteps.includes(step.name)) continue; // resume: skip finished work

      ensureLease(lease);
      if (await isCancelRequested(saga.rideId)) {
        // Checked BETWEEN steps; reserveDriver also checks it while waiting for a driver.
        // The upcoming step is recorded as the "failed" one so that it, and every
        // step before it (including createRide, which cancels the ride row), is undone.
        return startCompensation(saga, step.name, 'CANCELLED_BY_RIDER', 'Rider cancelled');
      }

      saga.currentStep = step.name;
      saga.stepLog.push({ step: step.name, startedAt: now(), endedAt: null });
      await persist(saga);

      try {
        await withSpan(`saga.step.${step.name}`, { 'ride.id': saga.rideId }, () =>
          step.action(saga.context, {
            // lets a step save partial progress (e.g. "I locked driver X") before
            // doing something slow, so a crash right after is still compensable
            persist: () => persist(saga),
            ensureLease: () => ensureLease(lease),
            isCancelRequested: () => isCancelRequested(saga.rideId),
          }));
      } catch (err) {
        if (err instanceof LeaseLostError) throw err;
        const reason = err instanceof SagaError ? err.reason : (err.reason || err.code || 'STEP_ERROR');
        return startCompensation(saga, step.name, reason, err.message);
      }

      saga.completedSteps.push(step.name);
      saga.stepLog[saga.stepLog.length - 1].endedAt = now();
      await persist(saga);
    }
    saga.state = 'COMPLETED';
    await persist(saga);
  }

  async function compensate(saga, lease) {
    // Undo the steps that finished PLUS the one that failed (it may have done part
    // of its work), newest first. Compensations are idempotent, so undoing
    // something that never happened is harmless.
    const toUndo = steps
      .filter((s) => saga.completedSteps.includes(s.name) || s.name === (saga.failure && saga.failure.step))
      .reverse();

    let allDone = true;
    for (const step of toUndo) {
      // Already undone in an earlier attempt (resume after crash): skip.
      if (saga.compensationLog.some((e) => e.step === step.name && e.ok)) continue;
      ensureLease(lease);
      try {
        await withRetry(
          () => withSpan(`saga.compensate.${step.name}`, { 'ride.id': saga.rideId }, () => step.compensate(saga.context, saga)),
          { retries: 2, baseMs: 100, ...retryOpts });
        saga.compensationLog.push({ step: step.name, ok: true, at: now() });
      } catch (err) {
        if (err instanceof LeaseLostError) throw err;
        saga.compensationLog.push({ step: step.name, ok: false, error: err.message, at: now() });
        allDone = false;
        // STOP here. Reverse order is the contract: do not undo an earlier step
        // while a later one is still undone.
        break;
      }
      await persist(saga);
    }

    if (allDone) {
      saga.state = 'COMPENSATED';
    } else {
      saga.compensationRounds = (saga.compensationRounds || 0) + 1;
      if (saga.compensationRounds >= maxCompensationRounds) {
        saga.state = 'COMPENSATION_FAILED'; // needs a human; the ride is marked FAILED
      }
      // else: stays COMPENSATING with the lease released; the sweeper retries later.
    }
    await persist(saga);
    if (saga.state === 'COMPENSATION_FAILED') await onCompensationFailed(saga);
  }

  async function run(rideId) {
    const saga = await store.claim(rideId, owner, leaseMs);
    if (!saga) return { claimed: false };

    const lease = { lost: false };
    const timer = setInterval(async () => {
      try { if (!(await store.renew(rideId, owner, leaseMs))) lease.lost = true; } catch (_) { /* retry next tick */ }
    }, Math.max(10, Math.floor(leaseMs / 3)));
    if (timer.unref) timer.unref();

    try {
      // Re-enter the original request's trace and correlation id, even when this
      // is a different process resuming the saga later.
      await runWithContext({ correlationId: saga.correlationId }, () =>
        runInTraceparent(saga.traceparent, () =>
          withSpan('saga.run', { 'ride.id': saga.rideId, 'saga.state.start': saga.state }, async () => {
            if (saga.state === 'RUNNING') await forward(saga, lease);
            if (saga.state === 'COMPENSATING') await compensate(saga, lease);
          })));
      return { claimed: true, state: saga.state };
    } catch (err) {
      if (err instanceof LeaseLostError) {
        logger.warn('saga lease lost, stopping', { rideId });
        return { claimed: true, lost: true };
      }
      throw err;
    } finally {
      clearInterval(timer);
      // Give the lease back so a non-terminal saga can be resumed right away.
      await store.release(rideId, owner).catch(() => {});
    }
  }

  // Cancel a ride whose booking saga already COMPLETED (status CONFIRMED): flip the
  // saga back to COMPENSATING; the caller then calls run() to execute it.
  const requestCompensation = (rideId, reason) =>
    store.requestCompensation(rideId, { step: null, reason, message: reason, at: now() });

  return { run, requestCompensation };
}

module.exports = { createRunner };
