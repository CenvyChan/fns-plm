export type FormBinding = { formKey: string; formVersion: number }

/** Stored in a Flowable user task's formKey; never resolve an unpinned "latest". */
export function flowableFormKey(binding: FormBinding): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(binding.formKey) ||
      !Number.isSafeInteger(binding.formVersion) || binding.formVersion < 1) {
    throw new Error('invalid pinned form binding')
  }
  return `plm-form:${binding.formKey}:v${binding.formVersion}`
}

/** The future trusted engine adapter must parse the task's actual formKey. */
export function parseFlowableFormKey(value: unknown): FormBinding | null {
  if (typeof value !== 'string') return null
  const match = /^plm-form:([A-Za-z][A-Za-z0-9_-]{0,63}):v([1-9][0-9]*)$/.exec(value)
  if (!match) return null
  const binding = { formKey: match[1]!, formVersion: Number(match[2]) }
  return Number.isSafeInteger(binding.formVersion) ? binding : null
}
