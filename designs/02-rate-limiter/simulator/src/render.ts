import type { LimiterRun, SimulationResult } from './simulate.ts';
import type { Decision } from './types.ts';

/** ANSI colours, switched off when piped or when NO_COLOR is set. */
const useColour = process.stdout.isTTY === true && !process.env['NO_COLOR'];
const paint = (code: string, s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => paint('32', s);
const red = (s: string) => paint('31', s);
const dim = (s: string) => paint('2', s);
const bold = (s: string) => paint('1', s);
const yellow = (s: string) => paint('33', s);

const RULE = '─'.repeat(78);

/** Milliseconds to `m:ss` (or `h:mm:ss` past the hour), matching the book. */
export function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Above this many requests, per-request marks stop fitting; switch to sparklines. */
const MARK_LIMIT = 72;

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values: number[], max: number): string {
  if (max <= 0) return SPARK[0]!.repeat(values.length);
  return values
    .map((v) => {
      if (v === 0) return dim('·');
      const i = Math.min(
        SPARK.length - 1,
        Math.max(0, Math.round((v / max) * (SPARK.length - 1))),
      );
      return SPARK[i]!;
    })
    .join('');
}

/** Bucket decisions into `columns` equal slices of the trace. */
function bucketise(
  decisions: Decision[],
  durationMs: number,
  columns: number,
): { offered: number[]; admitted: number[] } {
  const offered = new Array<number>(columns).fill(0);
  const admitted = new Array<number>(columns).fill(0);
  const width = durationMs / columns;

  for (const d of decisions) {
    const i = Math.min(columns - 1, Math.floor(d.t / width));
    offered[i]! += 1;
    if (d.allowed) admitted[i]! += 1;
  }

  return { offered, admitted };
}

/**
 * One character per request, in arrival order, with a `│` wherever a window
 * boundary falls between two requests. This is the view that makes the boundary
 * burst leap off the screen.
 */
function renderMarks(decisions: Decision[], markEveryMs: number | undefined): string {
  const out: string[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i]!;

    if (markEveryMs && i > 0) {
      const previous = decisions[i - 1]!;
      const crossed =
        Math.floor(d.t / markEveryMs) !== Math.floor(previous.t / markEveryMs);
      if (crossed) out.push(dim('│'));
    }

    out.push(d.allowed ? green('✓') : red('✗'));
  }

  return out.join('');
}

/** The header showing where the window boundaries sit on the mark timeline. */
function renderMarkAxis(
  decisions: Decision[],
  markEveryMs: number | undefined,
): string | undefined {
  if (!markEveryMs || decisions.length === 0) return undefined;

  const parts: string[] = [];
  let windowIndex = Math.floor(decisions[0]!.t / markEveryMs);
  let runLength = 0;

  const flush = () => {
    if (runLength === 0) return;
    const label = ` w${windowIndex + 1} `;
    const bar =
      runLength >= label.length
        ? label
            .padStart(Math.floor((runLength + label.length) / 2), '─')
            .padEnd(runLength, '─')
        : '─'.repeat(runLength);
    parts.push(bar);
  };

  for (const d of decisions) {
    const w = Math.floor(d.t / markEveryMs);
    if (w !== windowIndex) {
      flush();
      parts.push('┼');
      windowIndex = w;
      runLength = 0;
    }
    runLength += 1;
  }
  flush();

  return dim(parts.join(''));
}

function verdict(run: LimiterRun, limit: number | undefined): string {
  if (limit === undefined) return '';
  if (run.peakInRollingWindow > limit) {
    return yellow(`⚠ ${(run.peakInRollingWindow / limit).toFixed(1)}× the limit`);
  }
  return green('✓ never exceeded');
}

/** Pull the configured limit out of a limiter's params, if it advertises one. */
function limitOf(run: LimiterRun): number | undefined {
  const p = run.limiter.params;
  const raw = p['limit'] ?? p['capacity'];
  return typeof raw === 'number' ? raw : undefined;
}

/** 0.08333333333333333 is not a number anyone wants to read. */
function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}

function paramString(params: Readonly<Record<string, string | number>>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? formatNumber(v) : v}`)
    .join(' ');
}

export function renderScenario(result: SimulationResult): string {
  const { scenario, runs } = result;
  const { traffic } = scenario;
  const lines: string[] = [];

  const title = scenario.figure
    ? `${bold(scenario.name)}  ${dim(`(${scenario.figure})`)}`
    : bold(scenario.name);

  lines.push('');
  lines.push(dim(RULE));
  lines.push(`  ${title}`);
  lines.push(dim(RULE));
  lines.push(`  ${scenario.summary}`);
  lines.push('');
  lines.push(
    `  ${dim('Traffic')}  ${traffic.description}  ${dim(`(${traffic.arrivals.length} requests over ${formatTime(traffic.durationMs)})`)}`,
  );
  lines.push('');

  const nameWidth = Math.max(...runs.map((r) => r.limiter.label.length));
  const useMarks = traffic.arrivals.length <= MARK_LIMIT;

  if (useMarks) {
    const axis = renderMarkAxis(runs[0]!.decisions, scenario.markEveryMs);
    if (axis) lines.push(`  ${' '.repeat(nameWidth)}  ${axis}`);
  } else {
    const columns = 60;
    const { offered } = bucketise(runs[0]!.decisions, traffic.durationMs, columns);
    const peak = Math.max(...offered);
    lines.push(
      `  ${dim('offered'.padEnd(nameWidth))}  ${dim(sparkline(offered, peak))}  ${dim(`peak ${peak}/slice`)}`,
    );
    lines.push('');
  }

  for (const run of runs) {
    const label = run.limiter.label.padEnd(nameWidth);
    const limit = limitOf(run);

    const bar = useMarks
      ? renderMarks(run.decisions, scenario.markEveryMs)
      : sparkline(
          bucketise(run.decisions, traffic.durationMs, 60).admitted,
          Math.max(
            ...bucketise(runs[0]!.decisions, traffic.durationMs, 60).offered,
          ),
        );

    const pct = Math.round((run.allowed / run.decisions.length) * 100);
    const stats = `${String(run.allowed).padStart(3)}/${run.decisions.length} allowed (${String(pct).padStart(3)}%)`;

    lines.push(`  ${bold(label)}  ${bar}`);
    lines.push(
      `  ${' '.repeat(nameWidth)}  ${dim(paramString(run.limiter.params))}`,
    );

    const peak = `peak ${run.peakInRollingWindow} in any ${formatTime(scenario.markEveryMs ?? 60_000)}`;
    lines.push(`  ${' '.repeat(nameWidth)}  ${stats} · ${peak} ${verdict(run, limit)}`);

    if (run.maxQueueDelayMs !== undefined) {
      lines.push(
        `  ${' '.repeat(nameWidth)}  ${yellow(`queueing delay: avg ${run.avgQueueDelayMs}ms, worst ${run.maxQueueDelayMs}ms`)}`,
      );
    }

    lines.push('');
  }

  lines.push(`  ${bold('What to notice')}`);
  for (const line of scenario.lesson.trim().split('\n')) {
    lines.push(`  ${line.trim()}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * A request-by-request trace with the limiter's internal state after each
 * decision. This is how you check the algorithm against the book by hand.
 */
export function renderTrace(run: LimiterRun): string {
  const lines: string[] = [];
  const stateKeys = Object.keys(run.decisions[0]?.state ?? {});

  lines.push('');
  lines.push(`  ${bold(run.limiter.label)} ${dim(paramString(run.limiter.params))}`);
  lines.push('');

  const header = [
    'time'.padEnd(8),
    'decision'.padEnd(9),
    ...stateKeys.map((k) => k.padStart(9)),
  ].join(' ');
  lines.push(`  ${dim(header)}`);

  for (const d of run.decisions) {
    const cells = [
      formatTime(d.t).padEnd(8),
      (d.allowed ? green('allow') : red('reject')).padEnd(useColour ? 18 : 9),
      ...stateKeys.map((k) => String(d.state[k] ?? '').padStart(9)),
    ];
    lines.push(`  ${cells.join(' ')}`);
  }

  lines.push('');
  return lines.join('\n');
}
