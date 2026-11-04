import { isAuthorizedCronRequest } from "@civic-job-board/core";

interface CronRunFailure {
  /** Logged as `[daily-check] <logEvent>` with the thrown error. */
  logEvent: string;
  /** Returned to the caller, so it must not include error details. */
  message: string;
}

/**
 * A GET handler for a Vercel cron route. Requests without the `CRON_SECRET`
 * bearer header get 401. Otherwise it runs the job and answers 200 with the
 * report the job returns, even when the report says a part failed; only a run
 * that throws answers 500, with the thrown error logged rather than returned.
 */
export function cronRouteHandler(failure: CronRunFailure, runJob: () => Promise<object>) {
  return async function GET(request: Request): Promise<Response> {
    if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      return Response.json(await runJob());
    } catch (cause) {
      console.error(`[daily-check] ${failure.logEvent}`, cause);
      return Response.json({ ok: false, error: failure.message }, { status: 500 });
    }
  };
}
