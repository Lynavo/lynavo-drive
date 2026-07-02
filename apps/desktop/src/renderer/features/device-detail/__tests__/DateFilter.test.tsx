import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateFilter } from '../DateFilter';

describe('DateFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps date selectors enabled when multiple completion dates exist', () => {
    const onStartDateChange = vi.fn();
    const onEndDateChange = vi.fn();

    render(
      <DateFilter
        dates={['2026-04-27', '2026-04-26', '2026-04-25']}
        startDate="2026-04-25"
        endDate="2026-04-27"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />,
    );

    expect(screen.getByText('Completed date')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Start completed date' })).not.toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'End completed date' })).not.toBeDisabled();
  });

  it('disables date selectors when there is only one completion date', () => {
    const onStartDateChange = vi.fn();
    const onEndDateChange = vi.fn();

    render(
      <DateFilter
        dates={['2026-04-27']}
        startDate="2026-04-27"
        endDate="2026-04-27"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Start completed date' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'End completed date' })).toBeDisabled();
    expect(onStartDateChange).not.toHaveBeenCalled();
    expect(onEndDateChange).not.toHaveBeenCalled();
  });
});
