/**
 * Historical account-specific observations were removed from this public tree.
 * These placeholders are not authorization, runtime metadata, or a live query contract.
 */
export const TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS = {} as const

export const GET_INVENTORY_DATA_READ_ONLY_OBSERVATION = null

export const AGING_READ_ONLY_PARAMETER_METADATA = {
  status: 'historical_observation_removed',
  organizationMapping: null,
  currencyMapping: null,
  parseStatus: 'not_retained',
  rowsPersisted: false,
  liveCallsAllowed: false,
} as const
