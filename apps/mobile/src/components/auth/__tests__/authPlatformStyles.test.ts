import {
  getAuthCardSurfaceStyle,
  getAuthSingleLineInputStyle,
  getAuthTextScalingProps,
} from '../authPlatformStyles';

describe('auth platform styles', () => {
  it('locks Android auth text to the same scale used by the iOS design', () => {
    expect(getAuthTextScalingProps('android')).toEqual({
      allowFontScaling: false,
      maxFontSizeMultiplier: 1,
    });
  });

  it('keeps a light Android card elevation matching the v0 login surface', () => {
    expect(getAuthCardSurfaceStyle('android')).toEqual({
      backgroundColor: '#fbfdff',
      borderColor: 'rgba(59,130,246,0.10)',
      borderWidth: 1,
      elevation: 4,
    });
  });

  it('centers Android single-line auth inputs without forcing a line box', () => {
    expect(getAuthSingleLineInputStyle('android')).toEqual({
      height: 48,
      paddingVertical: 0,
      paddingTop: 0,
      paddingBottom: 0,
      includeFontPadding: false,
      textAlignVertical: 'center',
    });
  });

  it('keeps iOS auth text scalable within the designed cap', () => {
    expect(getAuthTextScalingProps('ios')).toEqual({
      maxFontSizeMultiplier: 1.15,
    });
  });

  it('keeps iOS single-line auth inputs on native vertical centering', () => {
    expect(getAuthSingleLineInputStyle('ios')).toEqual({
      height: 48,
      paddingVertical: 0,
    });
  });
});
