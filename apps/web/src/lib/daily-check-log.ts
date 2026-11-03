type LogFields = Record<string, string | number | boolean | null>;

/** One progress line, `[daily-check] <event> key=value ...`; never pass secrets or job text. */
export function logDailyCheck(event: string, fields: LogFields = {}) {
  const pairs = Object.entries(fields).map(([key, value]) =>
    `${key}=${typeof value === "string" && /[\s"=]/.test(value) ? JSON.stringify(value) : value}`);
  console.log(["[daily-check]", event, ...pairs].join(" "));
}
