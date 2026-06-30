import { resolveAndroidOemKeepaliveGuide } from '../androidOemKeepaliveGuide';

describe('android OEM keepalive guide', () => {
  it('returns Xiaomi/Redmi specific autostart and battery steps for Android users', () => {
    const guide = resolveAndroidOemKeepaliveGuide({
      manufacturer: 'Xiaomi',
      brand: 'Redmi',
      language: 'zh-Hant',
    });

    expect(guide.vendorLabel).toBe('Xiaomi / Redmi / POCO');
    expect(guide.steps.join('\n')).toContain('自啟動');
    expect(guide.steps.join('\n')).toContain('省電策略');
  });

  it('falls back to generic OEM guidance when the vendor is unknown', () => {
    const guide = resolveAndroidOemKeepaliveGuide({
      manufacturer: 'unknown vendor',
      brand: '',
      language: 'en',
    });

    expect(guide.vendorLabel).toBe('This Android device');
    expect(guide.steps.join('\n')).toContain('Auto start');
    expect(guide.steps.join('\n')).toContain('Battery');
  });
});
