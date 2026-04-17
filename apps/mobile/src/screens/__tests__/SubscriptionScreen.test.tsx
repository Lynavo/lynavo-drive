import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Must mock react-native-localize before i18n import
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hans',
      countryCode: 'CN',
      languageTag: 'zh-Hans-CN',
      isRTL: false,
    },
  ],
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: MockText } = require('react-native');
    return ReactInner.createElement(MockText, null, name);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
    purchase: jest.fn(),
    restore: jest.fn().mockResolvedValue([]),
    finishTransaction: jest.fn().mockResolvedValue(undefined),
    checkEligibility: jest
      .fn()
      .mockResolvedValue([
        { productId: 'com.vividrop.mobile.china.monthly.999', eligibleForIntroOffer: true },
      ]),
    onOrphanPurchaseVerified: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../services/subscription-service', () => ({
  verifyIapReceipt: jest.fn().mockResolvedValue(undefined),
  getSubscriptionStatus: jest.fn(),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { IAP_ENABLED: true, IAP_RESTORE_ENABLED: true, SUBSCRIPTION_ENFORCEMENT: false },
}));

const mockLoadSubscription = jest.fn().mockResolvedValue(undefined);

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    user: { id: 1, status: 'trial_expired' },
    subscription: null,
    loadSubscription: mockLoadSubscription,
  }),
  isFeatureAccessAllowed: () => false,
}));

import i18n from '../../i18n';
import { SubscriptionScreen } from '../SubscriptionScreen';
import { iapService } from '../../services/iap-service';
import { verifyIapReceipt } from '../../services/subscription-service';
import { ApiError, ERROR_CODE } from '../../services/api';

function renderScreen() {
  return render(<SubscriptionScreen />);
}

describe('SubscriptionScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hans');
  });

  beforeEach(() => jest.clearAllMocks());

  test('renders subscribe button', () => {
    const { getByText } = renderScreen();
    expect(getByText(/立即订阅|立即訂閱|Subscribe Now/)).toBeTruthy();
  });

  test('renders Restore button when flags enabled', () => {
    const { getByText } = renderScreen();
    expect(getByText(/恢復購買|恢复购买|Restore Purchases/)).toBeTruthy();
  });

  test('monthly card shows trial copy when eligible', async () => {
    const { findByText } = renderScreen();
    expect(
      await findByText(/免費試用|免费试用|free trial/i),
    ).toBeTruthy();
  });

  test('subscribe tap invokes iapService.purchase then verify', async () => {
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: 'com.vividrop.mobile.china.yearly.104',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_1',
    });

    const { getByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() => expect(iapService.purchase).toHaveBeenCalled());
    await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalled());
  });

  test('restore tap invokes iapService.restore', async () => {
    (iapService.restore as jest.Mock).mockResolvedValueOnce([]);
    const { getByText } = renderScreen();
    fireEvent.press(getByText(/恢復購買|恢复购买|Restore Purchases/));
    await waitFor(() => expect(iapService.restore).toHaveBeenCalled());
  });

  test('2002 from verify is treated as success (success modal shown)', async () => {
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: 'com.vividrop.mobile.china.yearly.104',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_1',
    });
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_ALREADY_USED, 'used'),
    );

    const { getByText, findByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    expect(await findByText(/支付成功|Payment Successful/)).toBeTruthy();
  });
});
