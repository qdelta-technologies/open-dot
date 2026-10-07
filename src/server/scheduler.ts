import "server-only";
import { Cron } from "croner";
import * as repo from "./repo";
import { onEvent } from "./bus";
import { runRoutine } from "./agent/runtime";

// Routines are cron jobs that wake a dot with an instruction.

const g = globalThis as unknown as { __dotsJobs?: Map<string, Cron>; __dotsSchedulerStarted?: boolean };
const jobs = (g.__dotsJobs ??= new Map());

function schedule(routineId: string) {
  jobs.get(routineId)?.stop();
  jobs.delete(routineId);
  const routine = repo.getRoutine(routineId);
  if (!routine?.enabled) return;

  const tz = routine.timezone || "UTC";
  const cron = new Cron(routine.schedule, { protect: true, timezone: tz }, () => {
    const fresh = repo.getRoutine(routineId);
    if (fresh) runRoutine(fresh);
  });
  jobs.set(routineId, cron);

  // Missed-run catch-up: if the last expected fire was after lastRunAt, run now
  try {
    const prev = cron.previousRun();
    if (prev) {
      const prevMs = prev.getTime();
      const lastRan = routine.lastRunAt ?? 0;
      if (prevMs > lastRan && Date.now() - prevMs < 24 * 60 * 60 * 1000) {
        // Missed within the last 24h — run immediately to catch up
        const fresh = repo.getRoutine(routineId);
        if (fresh) void Promise.resolve().then(() => runRoutine(fresh));
      }
    }
  } catch {
    // previousRun() may throw on some cron expressions — skip catch-up safely
  }
}

export function startScheduler() {
  if (g.__dotsSchedulerStarted) return;
  g.__dotsSchedulerStarted = true;
  for (const r of repo.listRoutines()) schedule(r.id);
  onEvent((ev) => {
    if (ev.type === "routine") schedule(ev.data.id);
    if (ev.type === "routine_deleted") {
      jobs.get(ev.id)?.stop();
      jobs.delete(ev.id);
    }
  });
}
