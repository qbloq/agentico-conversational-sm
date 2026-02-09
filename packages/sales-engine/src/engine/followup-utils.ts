/**
 * Follow-up Utility Functions
 */

/**
 * Parses interval string (e.g., '15m', '2h', '1d', '1w') into minutes
 */
export function parseIntervalToMinutes(interval: string): number {
  if (!interval) return 0;
  
  const val = parseInt(interval);
  if (isNaN(val)) return 0;
  
  const unit = interval.toLowerCase().replace(/[0-9]/g, '').trim();

  switch (unit) {
    case 'm': 
    case 'min':
    case 'mins':
    case 'minutes':
      return val;
    case 'h': 
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      return val * 60;
    case 'd': 
    case 'day':
    case 'days':
      return val * 60 * 24;
    case 'w': 
    case 'week':
    case 'weeks':
      return val * 60 * 24 * 7;
    default: 
      return 0;
  }
}

/**
 * Calculates the execution time for a follow-up based on an interval
 */
export function calculateScheduledTime(interval: string, fromDate: Date = new Date()): Date {
  const minutes = parseIntervalToMinutes(interval);
  const scheduledAt = new Date(fromDate);
  scheduledAt.setMinutes(scheduledAt.getMinutes() + minutes);
  return scheduledAt;
}
