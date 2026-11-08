import { isEmptyResult } from '../src/miio/result';

/**
 * These cases are drawn from real replies observed on isa.camera.df3,
 * firmware 5.5.1_1025. The empty ones were originally reported as working
 * capabilities, which is the mistake this function exists to prevent.
 */
describe('isEmptyResult', () => {
  it('treats the get_properties reply as empty', () => {
    // Returned for every siid/piid the grid asked for.
    expect(isEmptyResult([])).toBe(true);
  });

  it('treats a list of nulls as empty', () => {
    // get_prop for a property the camera does not implement.
    expect(isEmptyResult([null])).toBe(true);
    expect(isEmptyResult([null, null])).toBe(true);
  });

  it('treats null and undefined as empty', () => {
    expect(isEmptyResult(null)).toBe(true);
    expect(isEmptyResult(undefined)).toBe(true);
  });

  it('treats an object with no keys as empty', () => {
    expect(isEmptyResult({})).toBe(true);
  });

  it('counts an "ok" acknowledgement', () => {
    // set_cruise / set_track
    expect(isEmptyResult(['ok'])).toBe(false);
    expect(isEmptyResult('ok')).toBe(false);
  });

  it('counts real property values', () => {
    // get_prop(["cruise","track","power","night_mode"]) -> ["on","0"]
    expect(isEmptyResult(['on', '0'])).toBe(false);
  });

  it('counts a device info object', () => {
    expect(isEmptyResult({ model: 'isa.camera.df3', fw_ver: '5.5.1_1025' })).toBe(false);
  });

  it('does not mistake falsy values for emptiness', () => {
    // A property legitimately reading 0 or false must still count.
    expect(isEmptyResult([0])).toBe(false);
    expect(isEmptyResult([false])).toBe(false);
    expect(isEmptyResult(0)).toBe(false);
    expect(isEmptyResult(false)).toBe(false);
  });

  it('counts a partially populated list', () => {
    expect(isEmptyResult([null, 'on'])).toBe(false);
  });
});
