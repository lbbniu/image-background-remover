// 统一的 UTC 时间工具，避免 Workers 与本地环境因为 TZ 不同导致 period 漂移。

const MAX_DAY_OF_MONTH = 31;

export function utcDate(value) {
  return value ? new Date(value) : new Date();
}

export function startOfMonthUtc(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfNextMonthUtc(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

// 加 N 月并对月末做钳制：1/31 + 1mo → 2/28（或 2/29）。
export function addMonthsUtc(date, months = 1) {
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1,
  ));
  const day = Math.min(date.getUTCDate(), lastDayOfMonthUtc(target));
  target.setUTCDate(day);
  target.setUTCHours(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
  return target;
}

export function lastDayOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

export function monthPeriodFromUtc(date = new Date()) {
  const start = startOfMonthUtc(date);
  const end = startOfNextMonthUtc(date);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export function monthlyPeriodAfterUtc(periodEnd) {
  const start = utcDate(periodEnd);
  const end = addMonthsUtc(start, 1);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export function isExpiredUtc(periodEnd, now = new Date()) {
  if (!periodEnd) return false;
  return utcDate(periodEnd).getTime() <= now.getTime();
}

export function clampDayOfMonth(day) {
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(Math.floor(day), MAX_DAY_OF_MONTH);
}
