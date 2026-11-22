function getTimezoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => {
    const val = parts.find((p) => p.type === type)?.value ?? '00';
    return parseInt(val, 10);
  };

  let hour = get('hour');
  if (hour === 24) hour = 0;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i++) {
    const actual = getTimezoneParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0
    );
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diff = targetAsUtc - actualAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function parseSlotTime(timeStr: string): { hour: number; minute: number } {
  const [hStr, mStr] = timeStr.split(':');
  const hour = Math.min(23, Math.max(0, parseInt(hStr || '9', 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(mStr || '0', 10) || 0));
  return { hour, minute };
}

export function computeUpcomingSlots(params: {
  timeZone: string;
  dailyPublishingTimes: string[];
  existingScheduledIsos: string[];
  slotsNeeded: number;
  now?: Date;
}): string[] {
  const {
    timeZone,
    dailyPublishingTimes,
    existingScheduledIsos,
    slotsNeeded,
    now = new Date(),
  } = params;

  if (slotsNeeded <= 0 || dailyPublishingTimes.length === 0) {
    return [];
  }

  const parsedTimes = dailyPublishingTimes
    .map(parseSlotTime)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  const existingTimestamps = existingScheduledIsos
    .map((iso) => Date.parse(iso))
    .filter((ms) => !Number.isNaN(ms));

  const minAllowedMs = now.getTime() + 60 * 1000;
  const startParts = getTimezoneParts(now, timeZone);

  const selected: string[] = [];

  for (let dayOffset = 0; dayOffset < 30 && selected.length < slotsNeeded; dayOffset++) {
    const refUtc = new Date(
      Date.UTC(startParts.year, startParts.month - 1, startParts.day + dayOffset, 12, 0, 0)
    );
    const y = refUtc.getUTCFullYear();
    const m = refUtc.getUTCMonth() + 1;
    const d = refUtc.getUTCDate();

    for (const slot of parsedTimes) {
      if (selected.length >= slotsNeeded) break;
      const candidate = zonedDateTimeToUtc(y, m, d, slot.hour, slot.minute, timeZone);
      const candidateMs = candidate.getTime();
      if (candidateMs <= minAllowedMs) continue;

      const collidesExisting = existingTimestamps.some(
        (exMs) => Math.abs(exMs - candidateMs) < 10 * 60 * 1000
      );
      if (collidesExisting) continue;

      const collidesSelected = selected.some(
        (iso) => Math.abs(Date.parse(iso) - candidateMs) < 10 * 60 * 1000
      );
      if (collidesSelected) continue;

      selected.push(candidate.toISOString());
    }
  }

  return selected;
}

export function combineYouTubeDescription(description: string, hashtags: string): string {
  const desc = description.trim();
  const tags = hashtags.trim();
  const combined = desc && tags ? `${desc}\n\n${tags}` : desc || tags;
  return combined.slice(0, 5000);
}
