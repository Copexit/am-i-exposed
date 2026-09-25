/** Build i18n key for a finding field, appending _variant if present in params. */
export function findingKey(id: string, field: string, params?: Record<string, unknown>): string {
  const variant = params?._variant;
  return variant ? `finding.${id}.${field}.${variant}` : `finding.${id}.${field}`;
}

/**
 * Like findingKey, but with a _variant returns [variantKey, baseKey] so t()
 * falls back to the base translation before the English defaultValue.
 */
export function findingKeys(id: string, field: string, params?: Record<string, unknown>): string[] {
  const base = `finding.${id}.${field}`;
  return params?._variant ? [findingKey(id, field, params), base] : [base];
}
