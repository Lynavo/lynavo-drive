import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY =
  '@vividrop/onboarding/unconnected/v1/seen';
export const ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY =
  '@vividrop/onboarding/sync-activity-tour/v1/seen';

async function hasSeen(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch (error) {
    console.warn(
      '[onboardingStorage] failed to read onboarding flag',
      key,
      error,
    );
    return true;
  }
}

async function markSeen(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch (error) {
    console.warn(
      '[onboardingStorage] failed to write onboarding flag',
      key,
      error,
    );
  }
}

export function hasSeenUnconnectedGuide(): Promise<boolean> {
  return hasSeen(ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY);
}

export function markUnconnectedGuideSeen(): Promise<void> {
  return markSeen(ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY);
}

export function hasSeenSyncActivityTour(): Promise<boolean> {
  return hasSeen(ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY);
}

export function markSyncActivityTourSeen(): Promise<void> {
  return markSeen(ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY);
}
