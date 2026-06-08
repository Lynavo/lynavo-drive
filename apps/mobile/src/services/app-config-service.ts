import { apiGet } from './api';
import { setBackgroundSilentAudioEnabled } from './SyncEngineModule';

export interface AppConfig {
  giftCard: {
    enabled: boolean;
  };
  backgroundSilentAudio: {
    enabled: boolean;
  };
}

interface AppConfigResponse {
  features?: {
    gift_card?: {
      enabled?: boolean;
    };
    background_silent_audio?: {
      enabled?: boolean;
    };
  };
}

export async function getAppConfig(): Promise<AppConfig> {
  const data = await apiGet<AppConfigResponse>('/config', {
    skipAuth: true,
  });

  return {
    giftCard: {
      enabled: data.features?.gift_card?.enabled === true,
    },
    backgroundSilentAudio: {
      enabled: data.features?.background_silent_audio?.enabled === true,
    },
  };
}

export async function refreshNativeAppFeatureSettings(): Promise<void> {
  const config = await getAppConfig();
  await setBackgroundSilentAudioEnabled(config.backgroundSilentAudio.enabled);
}
