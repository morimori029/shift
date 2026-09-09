export type Density = 'compact' | 'standard' | 'spacious';

export const DENSITY_STYLE: Record<Density, { cellW: string; padY: string; badgeText: string; nameW: string; dutyText: string }> = {
  compact: { cellW: 'w-9', padY: 'py-1', badgeText: 'text-[10px]', nameW: 'w-24', dutyText: 'text-[8px]' },
  standard: { cellW: 'w-12', padY: 'py-1.5', badgeText: 'text-xs', nameW: 'w-32', dutyText: 'text-[9px]' },
  spacious: { cellW: 'w-[68px]', padY: 'py-2', badgeText: 'text-xs', nameW: 'w-36', dutyText: 'text-[10px]' },
};

export const DUTY_COLORS: Record<string, { bg: string; color: string }> = {
  ld: { bg: '#fef3c7', color: '#92400e' },
  bathing: { bg: '#cffafe', color: '#155e75' },
  floor: { bg: '#d1fae5', color: '#065f46' },
  toilet: { bg: '#ede9fe', color: '#5b21b6' },
  onef: { bg: '#e2e8f0', color: '#334155' },
};

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
