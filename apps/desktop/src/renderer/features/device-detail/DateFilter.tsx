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

export function DateFilter({
  dates,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateFilterProps) {
  // Ensure today is always in the list and at the top
  const today = new Date().toLocaleDateString('sv-SE');
  const allDates = dates.includes(today) ? dates : [today, ...dates];

  // End date options: only dates >= startDate
  const endDates = allDates.filter((d) => d >= startDate);

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
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">从</span>
        <Select value={startDate} onValueChange={handleStartChange}>
          <SelectTrigger className="w-[140px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allDates.map((date) => (
              <SelectItem key={date} value={date}>
                {getDateLabel(date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">至</span>
        <Select value={endDate} onValueChange={handleEndChange}>
          <SelectTrigger className="w-[140px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {endDates.map((date) => (
              <SelectItem key={date} value={date}>
                {getDateLabel(date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
