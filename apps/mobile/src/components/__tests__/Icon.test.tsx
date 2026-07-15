import React from 'react';
import { render } from '@testing-library/react-native';
import { Icon } from '../Icon';

describe('Icon', () => {
  test('renders settings row icons registered in the glyph map', () => {
    const { getByText } = render(
      <>
        <Icon name="language-outline" />
        <Icon name="trash-outline" />
      </>,
    );

    expect(getByText(String.fromCharCode(60587))).toBeTruthy();
    expect(getByText(String.fromCharCode(61175))).toBeTruthy();
  });
});
