import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { formatDate } from '@renderer/lib/format';

interface DateFilterProps {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
}

function getDateLabel(iso: string): string {
  const today = new Date().toLocaleDateString('sv-SE');
  const formatted = formatDate(iso);
  return iso === today ? `今天 (${formatted})` : formatted;
}

export function DateFilter({ dates, selected, onSelect }: DateFilterProps) {
  // Ensure today is always in the list and at the top
  const today = new Date().toLocaleDateString('sv-SE');
  const allDates = dates.includes(today) ? dates : [today, ...dates];

  return (
    <Select value={selected} onValueChange={onSelect}>
      <SelectTrigger className="rounded-xl">
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
  );
}
