/** Exact HTTP/error pairs whose endpoint contract rejects before the engine start call. */
const DEFINITELY_NOT_STARTED = new Set([
  '503:flowable_unavailable_no_process_started',
  '401:authentication_required',
  '403:role_forbidden',
  '403:current_scope_flowable_membership_required',
  '503:custom_bpmn_runtime_release_blocked',
  '400:model_id_and_idempotency_key_required',
  '400:unsupported_start_field',
  '400:invalid_expected_version_id',
  '400:invalid_business_context',
  '404:published_model_not_found_in_scope',
  '409:published_version_changed',
  '409:published_version_integrity_or_safe_subset_failed',
  '409:published_graph_binding_mismatch',
  '409:published_assignment_invalid',
  '409:published_assignment_membership_expired',
  '409:published_assignment_invalid_republish_required',
  '409:published_graph_invalid',
])

export type StartFailureOutcome = 'definitely-not-started' | 'uncertain'

export function classifyStartFailure(status: number, error: unknown): StartFailureOutcome {
  if (typeof error !== 'string') return 'uncertain'
  return DEFINITELY_NOT_STARTED.has(`${status}:${error}`) ? 'definitely-not-started' : 'uncertain'
}
