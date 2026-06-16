export const GUAYAQUIL_TIMEZONE = 'America/Guayaquil';
const GUAYAQUIL_UTC_OFFSET = '-05:00';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: GUAYAQUIL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: GUAYAQUIL_TIMEZONE,
    hour: '2-digit',
    hour12: false
});

export const getGuayaquilDateString = (date = new Date()) => dateFormatter.format(date);

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: GUAYAQUIL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
});

export const getGuayaquilTimeString = (date = new Date()) => timeFormatter.format(date);

export const getGuayaquilHour = (date = new Date()) => {
    const formatted = hourFormatter.format(date);
    return Number(formatted === '24' ? '0' : formatted);
};

export const getGuayaquilHourLabel = (date = new Date()) =>
    `${getGuayaquilHour(date).toString().padStart(2, '0')}:00`;

export const addDaysToDateString = (dateString: string, days: number) => {
    const base = new Date(`${dateString}T00:00:00${GUAYAQUIL_UTC_OFFSET}`);
    base.setUTCDate(base.getUTCDate() + days);
    return getGuayaquilDateString(base);
};

export const guayaquilStartOfDayIso = (dateString: string) =>
    new Date(`${dateString}T00:00:00.000${GUAYAQUIL_UTC_OFFSET}`).toISOString();

export const guayaquilEndOfDayIso = (dateString: string) =>
    new Date(`${dateString}T23:59:59.999${GUAYAQUIL_UTC_OFFSET}`).toISOString();

export const toUnixSeconds = (dateInput: string | Date) =>
    Math.floor(new Date(dateInput).getTime() / 1000);

export const getLiveWindow = (date = new Date()) => {
    const today = getGuayaquilDateString(date);
    const yesterday = addDaysToDateString(today, -1);
    const tomorrow = addDaysToDateString(today, 1);
    const liveStartIso = guayaquilStartOfDayIso(yesterday);
    const todayStartIso = guayaquilStartOfDayIso(today);
    const tomorrowStartIso = guayaquilStartOfDayIso(tomorrow);
    const nowIso = date.toISOString();

    return {
        today,
        yesterday,
        liveStartIso,
        todayStartIso,
        tomorrowStartIso,
        nowIso,
        liveStartUnix: toUnixSeconds(liveStartIso),
        todayStartUnix: toUnixSeconds(todayStartIso),
        tomorrowStartUnix: toUnixSeconds(tomorrowStartIso),
        nowUnix: toUnixSeconds(date)
    };
};

export const dateStringIncludesToday = (startDate: string, endDate: string, now = new Date()) => {
    const today = getGuayaquilDateString(now);
    return startDate <= today && endDate >= today;
};
