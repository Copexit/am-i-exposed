import { validateParam } from "./registry";

export class ConsentRequiredError extends Error {
  constructor() {
    super("Lookup consent required");
    this.name = "ConsentRequiredError";
  }
}

export interface LookupConsent {
  readonly serviceId: string;
  readonly txids: ReadonlySet<string>;
}

// Only objects minted by grantLookupConsent are honoured, so a structurally
// identical plain object cannot forge consent.
const granted = new WeakSet<LookupConsent>();

export function grantLookupConsent(serviceId: string, txids: string[]): LookupConsent {
  const valid = txids.map((t) => validateParam("txid", t)).filter((t): t is string => t !== null);
  const consent: LookupConsent = Object.freeze({ serviceId, txids: new Set(valid) });
  granted.add(consent);
  return consent;
}

export const isGrantedConsent = (c: LookupConsent | undefined): c is LookupConsent =>
  c !== undefined && granted.has(c);
