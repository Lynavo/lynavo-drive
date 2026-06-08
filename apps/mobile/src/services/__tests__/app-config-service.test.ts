import { getAppConfig, refreshNativeAppFeatureSettings } from '../app-config-service';
import { apiGet } from '../api';
import { setBackgroundSilentAudioEnabled } from '../SyncEngineModule';

jest.mock('../api', () => ({
  apiGet: jest.fn(),
}));

jest.mock('../SyncEngineModule', () => ({
  setBackgroundSilentAudioEnabled: jest.fn(),
}));

describe('app-config-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses background silent audio as disabled by default', async () => {
    (apiGet as jest.Mock).mockResolvedValueOnce({
      features: {
        gift_card: { enabled: true },
      },
    });

    await expect(getAppConfig()).resolves.toEqual({
      giftCard: { enabled: true },
      backgroundSilentAudio: { enabled: false },
    });
  });

  it('applies the background silent audio flag to the native sync engine', async () => {
    (apiGet as jest.Mock).mockResolvedValueOnce({
      features: {
        background_silent_audio: { enabled: true },
      },
    });

    await refreshNativeAppFeatureSettings();

    expect(setBackgroundSilentAudioEnabled).toHaveBeenCalledWith(true);
  });
});
