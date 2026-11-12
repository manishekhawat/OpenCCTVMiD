import { parseAccountJson, parseSetCookie, resolveUrl } from '../src/cloud/parse';

describe('parseSetCookie', () => {
  it('splits cookies the native layer joined with ", "', () => {
    const joined =
      'serviceToken=abc/def+gh==; Path=/; Domain=sts.api.io.mi.com; HttpOnly, ' +
      'userId=1234567; Expires=Wed, 01-Jan-2031 00:00:00 GMT; Path=/, ' +
      'cUserId=xYz-1; Path=/';
    expect(parseSetCookie(joined)).toEqual({
      serviceToken: 'abc/def+gh==',
      userId: '1234567',
      cUserId: 'xYz-1',
    });
  });

  it('does not split inside an Expires date', () => {
    const v = parseSetCookie('ick=k1; Expires=Thu, 12-Nov-2026 16:00:00 GMT; Path=/');
    expect(v).toEqual({ ick: 'k1' });
  });

  it('keeps "=" inside values', () => {
    expect(parseSetCookie('passToken=V1:aGVsbG8=; Path=/')).toEqual({ passToken: 'V1:aGVsbG8=' });
  });

  it('handles no header', () => {
    expect(parseSetCookie(undefined)).toEqual({});
  });
});

describe('parseAccountJson', () => {
  it('strips the &&&START&&& guard', () => {
    expect(parseAccountJson('&&&START&&&{"_sign":"abc","code":70016}')).toEqual({ _sign: 'abc', code: 70016 });
  });

  it('accepts plain JSON', () => {
    expect(parseAccountJson('{"code":0}')).toEqual({ code: 0 });
  });

  it('returns null for an HTML page instead of throwing', () => {
    expect(parseAccountJson('<html><title>Xiaomi Account - Tips</title>')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('keeps absolute URLs', () => {
    expect(resolveUrl('https://sts.api.io.mi.com/sts?x=1', 'https://account.xiaomi.com/a')).toBe(
      'https://sts.api.io.mi.com/sts?x=1',
    );
  });

  it('resolves a root-relative redirect against the current host', () => {
    expect(resolveUrl('/pass/serviceLoginAuth2/end?x', 'https://account.xiaomi.com/identity/result/check')).toBe(
      'https://account.xiaomi.com/pass/serviceLoginAuth2/end?x',
    );
  });
});
