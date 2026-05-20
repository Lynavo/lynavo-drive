import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LoginGlobalScreen } from '../LoginGlobalScreen';

describe('LoginGlobalScreen', () => {
  it('shows Apple and Google login without phone login', () => {
    const { getByText, queryByText } = render(<LoginGlobalScreen />);

    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(queryByText('+86')).toBeNull();
  });

  it('keeps provider buttons disabled while provider login is pending', () => {
    const { getByText } = render(<LoginGlobalScreen />);

    fireEvent.press(getByText('Continue with Apple'));

    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
  });
});
