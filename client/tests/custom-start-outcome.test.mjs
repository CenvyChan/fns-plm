import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyStartFailure } from '../src/customStartOutcome.ts'

test('明确 unavailable 前置拒绝可在恢复后经重新确认再试；模糊结果保持锁定', async () => {
  {
    const unavailable = { status: 503, error: 'flowable_unavailable_no_process_started' }
    assert.equal(classifyStartFailure(unavailable.status, unavailable.error), 'definitely-not-started')
    // After restore, the user must explicitly confirm again before issuing a new attempt.
    let confirmedAgain = false
    assert.equal(confirmedAgain && classifyStartFailure(503, unavailable.error) === 'definitely-not-started', false)
    confirmedAgain = true
    assert.equal(confirmedAgain && classifyStartFailure(503, unavailable.error) === 'definitely-not-started', true)
    for (const [status, error] of [
      [502, 'flowable_start_outcome_uncertain_no_retry'],
      [503, 'start_outcome_uncertain_no_retry'],
      [400, 'unknown_error'],
      [409, 'start_already_in_progress_or_recorded'],
      [409, 'idempotency_key_reused_with_different_request'],
      [503, undefined],
    ]) assert.equal(classifyStartFailure(status, error), 'uncertain', `${status}/${error}`)
    assert.equal(classifyStartFailure(401, 'authentication_required'), 'uncertain')
    assert.equal(classifyStartFailure(403, 'role_forbidden'), 'uncertain')
    assert.equal(classifyStartFailure(403, 'current_scope_flowable_membership_required'), 'uncertain')
    assert.equal(classifyStartFailure(502, 'flowable_unavailable_no_process_started'), 'uncertain')
    assert.equal(classifyStartFailure(503, 'custom_bpmn_runtime_release_blocked'), 'definitely-not-started')
  }
})
