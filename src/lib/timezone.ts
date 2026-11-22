export const DEFAULT_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export const DEFAULT_DAILY_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];

export function formatInTimezone(isoString: string | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!isoString) return 'Unscheduled';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function formatTimeOnlyInTimezone(isoString: string | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

export function formatDateKeyInTimezone(isoOrDate: string | Date, timeZone = 'Asia/Kolkata'): string {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function combineYouTubeMetadata(description: string, hashtags: string): string {
  const d = description.trim();
  const h = hashtags.trim();
  if (!h) return d.slice(0, 5000);
  return (d ? `${d}\n\n${h}` : h).slice(0, 5000);
}

export function validateYouTubeMetadata(title: string, description: string, hashtags: string) {
  const cleanTitle = title.trim();
  const combined = combineYouTubeMetadata(description, hashtags);
  return {
    titleValid: cleanTitle.length >= 1 && cleanTitle.length <= 100,
    titleLength: cleanTitle.length,
    descriptionCombinedLength: combined.length,
    descriptionValid: combined.length <= 5000,
  };
}

export function formatTimestampField(value: unknown, timeZone = 'Asia/Kolkata'): string {
  if (!value) return 'Just now';
  if (typeof value === 'string') return formatInTimezone(value, timeZone);
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    return formatInTimezone((value as { toDate: () => Date }).toDate().toISOString(), timeZone);
  }
  return 'Just now';
}
