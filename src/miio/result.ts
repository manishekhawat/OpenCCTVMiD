/**
 * A reply is not a result.
 *
 * get_properties is accepted by Dafang firmware 5.5.1_1025 for any
 * siid/piid and returns [] every time. Judging a call by its RPC envelope
 * alone marked thirteen such calls as working, which was wrong in the most
 * misleading direction: it invented a capability out of a device politely
 * saying nothing.
 *
 * So an answer only counts when it carries something — a value, an "ok", a
 * non-empty array.
 */
export const isEmptyResult = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) {
    return value.length === 0 || value.every(v => v === null || v === undefined);
  }
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
};
