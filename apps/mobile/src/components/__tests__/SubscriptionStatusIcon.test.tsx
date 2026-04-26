import React from 'react';
import { render } from '@testing-library/react-native';

import {
  SubscriptionStatusIcon,
  getSubscriptionStatusIconTone,
} from '../SubscriptionStatusIcon';

describe('SubscriptionStatusIcon', () => {
  test('maps subscription display states to the requested icon colors', () => {
    expect(getSubscriptionStatusIconTone('account_trial')).toBe('trial');
    expect(getSubscriptionStatusIconTone('subscription_intro_trial')).toBe(
      'trial',
    );
    expect(getSubscriptionStatusIconTone('trial_expired')).toBe('expired');
    expect(getSubscriptionStatusIconTone('sub_expired')).toBe('expired');
    expect(getSubscriptionStatusIconTone('subscribed')).toBe('subscribed');
    expect(getSubscriptionStatusIconTone('subscribed_cancelled')).toBe(
      'subscribed',
    );
    expect(getSubscriptionStatusIconTone('unknown')).toBeNull();
  });

  test('renders the crown icon from image assets', () => {
    const { toJSON } = render(<SubscriptionStatusIcon tone="trial" />);

    expect(toJSON()).toBeTruthy();
  });
});
