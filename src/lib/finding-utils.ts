/** Build i18n key for a finding field, appending _variant if present in params. */
export function findingKey(id: string, field: string, params?: Record<string, unknown>): string {
  const variant = params?._variant;
  return variant ? `finding.${id}.${field}.${variant}` : `finding.${id}.${field}`;
}
