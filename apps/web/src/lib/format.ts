import { formatCurrency } from './currency';

export function formatPrice(amount: number, currency: string = 'TTD'): string {
  return formatCurrency(amount, currency);
}
