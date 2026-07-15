import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDate } from '@renderer/lib/format';

interface DateFilterProps {
  dates: string[];
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

function getDateLabel(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const today = new Date().toLocaleDateString('sv-SE');
  const formatted = formatDate(iso);
  return iso === today ? t('deviceDetail.filter.todayWithDate', { date: formatted }) : formatted;
}

interface DateSelectProps {
  label: string;
  value: string;
  dates: string[];
  disabled: boolean;
  onChange: (date: string) => void;
  todayLabelFormatter: (date: string) => string;
}

function DateSelect({
  label,
  value,
  dates,
  disabled,
  onChange,
  todayLabelFormatter,
}: DateSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className="w-[140px] rounded-xl"
        disabled={disabled}
        title={disabled ? label : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {dates.map((date) => (
          <SelectItem key={date} value={date}>
            {todayLabelFormatter(date)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DateFilter({
  dates,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateFilterProps) {
  const { t } = useTranslation();
  // Ensure today is always in the list and at the top
  const today = new Date().toLocaleDateString('sv-SE');
  const allDates = Array.from(new Set([today, ...dates])).sort((a, b) => b.localeCompare(a));
  const startValue = allDates.includes(startDate) ? startDate : allDates[0];

  // End date options: only dates >= startDate
  const endDates = allDates.filter((d) => d >= startValue);
  const endValue = endDates.includes(endDate) ? endDate : endDates[0];

  const handleStartChange = (date: string) => {
    if (date > endDate) {
      toast.error(t('errors.deviceDetail.invalidDateRange'), {
        description: t('errors.deviceDetail.startAfterEndAdjusted'),
      });
    }
    onStartDateChange(date);
  };

  const handleEndChange = (date: string) => {
    if (date < startDate) {
      toast.error(t('errors.deviceDetail.invalidDateRange'), {
        description: t('errors.deviceDetail.endBeforeStart'),
      });
      return;
    }
    onEndDateChange(date);
  };

  const formatDateLabel = (date: string) => getDateLabel(date, t);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {t('deviceDetail.filter.completedDate')}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('deviceDetail.filter.from')}</span>
        <DateSelect
          label={t('deviceDetail.filter.startLabel')}
          value={startValue}
          dates={allDates}
          disabled={allDates.length <= 1}
          onChange={handleStartChange}
          todayLabelFormatter={formatDateLabel}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('deviceDetail.filter.to')}</span>
        <DateSelect
          label={t('deviceDetail.filter.endLabel')}
          value={endValue}
          dates={endDates}
          disabled={endDates.length <= 1}
          onChange={handleEndChange}
          todayLabelFormatter={formatDateLabel}
        />
      </div>
    </div>
  );
}
