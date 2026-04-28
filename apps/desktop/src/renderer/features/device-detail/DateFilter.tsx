import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { toast } from 'sonner';
import { formatDate } from '@renderer/lib/format';

interface DateFilterProps {
  dates: string[];
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

function getDateLabel(iso: string): string {
  const today = new Date().toLocaleDateString('sv-SE');
  const formatted = formatDate(iso);
  return iso === today ? `今天 (${formatted})` : formatted;
}

interface DateSelectProps {
  label: string;
  value: string;
  dates: string[];
  disabled: boolean;
  onChange: (date: string) => void;
}

function DateSelect({ label, value, dates, disabled, onChange }: DateSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className="w-[140px] rounded-xl"
        disabled={disabled}
        title={disabled ? '只有一个完成日期' : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {dates.map((date) => (
          <SelectItem key={date} value={date}>
            {getDateLabel(date)}
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
  // Ensure today is always in the list and at the top
  const today = new Date().toLocaleDateString('sv-SE');
  const allDates = Array.from(new Set([today, ...dates])).sort((a, b) => b.localeCompare(a));
  const startValue = allDates.includes(startDate) ? startDate : allDates[0];

  // End date options: only dates >= startDate
  const endDates = allDates.filter((d) => d >= startValue);
  const endValue = endDates.includes(endDate) ? endDate : endDates[0];

  const handleStartChange = (date: string) => {
    if (date > endDate) {
      toast.error('时间范围无效', { description: '起始时间不能晚于结束时间，已自动调整' });
    }
    onStartDateChange(date);
  };

  const handleEndChange = (date: string) => {
    if (date < startDate) {
      toast.error('时间范围无效', { description: '结束时间不能早于起始时间' });
      return;
    }
    onEndDateChange(date);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">完成日期</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">从</span>
        <DateSelect
          label="开始完成日期"
          value={startValue}
          dates={allDates}
          disabled={allDates.length <= 1}
          onChange={handleStartChange}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">至</span>
        <DateSelect
          label="结束完成日期"
          value={endValue}
          dates={endDates}
          disabled={endDates.length <= 1}
          onChange={handleEndChange}
        />
      </div>
    </div>
  );
}
