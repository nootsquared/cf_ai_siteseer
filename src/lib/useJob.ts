import { useEffect, useRef, useState } from "react";
import { fetchJob, type JobState } from "./api";

// Polls the job until it reaches a terminal state (complete / error).
// Starts with a fast 600ms cadence then backs off to 1.5s after a few polls
// so we remain responsive without hammering the worker.
export function useJob(jobId: string | null) {
  const [state, setState] = useState<JobState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!jobId) {
      setState(null);
      setPollError(null);
      return;
    }
    cancelledRef.current = false;
    let tries = 0;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelledRef.current) return;
      try {
        const next = await fetchJob(jobId);
        if (cancelledRef.current) return;
        setState(next);
        setPollError(null);
        if (next.status === "complete" || next.status === "error") return;
      } catch (e) {
        if (cancelledRef.current) return;
        // Don't surface transient 404s — the DO may not be ready yet
        if (tries > 5) {
          setPollError((e as Error).message);
        }
      }
      tries += 1;
      const delay = tries < 4 ? 800 : 1500;
      timer = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelledRef.current = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [jobId]);

  return { state, pollError };
}
