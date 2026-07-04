import cron, { type ScheduledTask } from "node-cron";
import {
  missingCapabilities,
  type ProviderRegistry,
  type SignalSkill,
  type SkillContext,
} from "@ottostreet/core";
import type { Store } from "./db.js";

export interface RunError {
  skill: string;
  ticker: string;
  message: string;
}

export interface RunSummary {
  /** Skills that were runnable (had their required capabilities). */
  skillsRun: number;
  /** Tickers on the watchlist at run time. */
  tickers: number;
  /** Signals produced by skills before dedupe. */
  generated: number;
  /** New signals actually stored. */
  stored: number;
  /** Signals dropped as duplicates of a recent identical signal. */
  deduped: number;
  errors: RunError[];
}

interface SkillRunResult {
  generated: number;
  stored: number;
  errors: RunError[];
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private running = new Set<string>();

  constructor(
    private readonly skills: SignalSkill[],
    private readonly providers: ProviderRegistry,
    private readonly store: Store,
  ) {}

  start(): void {
    for (const skill of this.skills) {
      const missing = missingCapabilities(this.providers, skill.requires);
      if (missing.length > 0) {
        console.warn(`[scheduler] skill "${skill.id}" disabled — missing capabilities: ${missing.join(", ")}`);
        continue;
      }
      this.tasks.push(cron.schedule(skill.schedule, () => void this.runSkill(skill)));
      console.log(`[scheduler] skill "${skill.id}" scheduled (${skill.schedule})`);
    }
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }

  /** Run every runnable skill against the whole watchlist once. */
  async runAllOnce(): Promise<RunSummary> {
    const tickers = this.store.listSymbols().length;
    const summary: RunSummary = { skillsRun: 0, tickers, generated: 0, stored: 0, deduped: 0, errors: [] };
    for (const skill of this.skills) {
      if (missingCapabilities(this.providers, skill.requires).length > 0) continue;
      summary.skillsRun += 1;
      const result = await this.runSkill(skill);
      summary.generated += result.generated;
      summary.stored += result.stored;
      summary.errors.push(...result.errors);
    }
    summary.deduped = summary.generated - summary.stored;
    return summary;
  }

  private async runSkill(skill: SignalSkill): Promise<SkillRunResult> {
    const result: SkillRunResult = { generated: 0, stored: 0, errors: [] };
    // Guard against a slow run overlapping the next cron tick.
    if (this.running.has(skill.id)) return result;
    this.running.add(skill.id);
    try {
      const ctx: SkillContext = {
        providers: this.providers,
        log: (msg) => console.log(`[${skill.id}] ${msg}`),
        now: () => new Date(),
      };
      for (const ticker of this.store.listSymbols()) {
        try {
          const signals = await skill.run(ctx, ticker);
          result.generated += signals.length;
          for (const signal of signals) {
            if (this.store.insertSignal(signal)) result.stored += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[${skill.id}] ${ticker} failed:`, message);
          result.errors.push({ skill: skill.id, ticker, message });
        }
      }
    } finally {
      this.running.delete(skill.id);
    }
    if (result.stored > 0) console.log(`[${skill.id}] stored ${result.stored} new signal(s)`);
    return result;
  }
}
