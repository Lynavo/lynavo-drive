import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hasSeenSyncActivityTour,
  hasSeenUnconnectedGuide,
  markSyncActivityTourSeen,
  markUnconnectedGuideSeen,
  ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
  ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
} from '../onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('onboardingStorage', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('reads both device-scoped onboarding flags', async () => {
    (AsyncStorage.getItem as jest.Mock)
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce(null);

    await expect(hasSeenUnconnectedGuide()).resolves.toBe(true);
    await expect(hasSeenSyncActivityTour()).resolves.toBe(false);

    expect(AsyncStorage.getItem).toHaveBeenNthCalledWith(
      1,
      ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
    );
    expect(AsyncStorage.getItem).toHaveBeenNthCalledWith(
      2,
      ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
    );
  });

  it('marks both onboarding guides as seen', async () => {
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    await markUnconnectedGuideSeen();
    await markSyncActivityTourSeen();

    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      1,
      ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
      '1',
    );
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      2,
      ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
      '1',
    );
  });

  it('falls back to seen when read fails so onboarding does not loop', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error('storage unavailable'),
    );

    await expect(hasSeenUnconnectedGuide()).resolves.toBe(true);
    await expect(hasSeenSyncActivityTour()).resolves.toBe(true);
  });
});
