import { parseArgs } from 'node:util';
import { raceCondition, type RaceResult } from './distributed.ts';
import { renderScenario, renderTrace } from './render.ts';
import { findScenario, scenarios } from './scenarios.ts';
import { simulate } from './simulate.ts';

const useColour = process.stdout.isTTY === true && !process.env['NO_COLOR'];
const paint = (code: string, s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => paint('1', s);
const dim = (s: string) => paint('2', s);
const green = (s: string) => paint('32', s);
const red = (s: string) => paint('31', s);
const yellow = (s: string) => paint('33', s);

const HELP = `
${bold('Rate limiter simulator')} — Chapter 4, System Design Interview

  Five rate limiting algorithms on a deterministic virtual clock. Same traffic,
  same trace, every time — so the book's figures are reproducible and the
  differences between the algorithms are real rather than anecdotal.

${bold('Usage')}
  npm run sim -- --list                      List the scenarios
  npm run sim -- --scenario=<name>           Run one scenario
  npm run sim -- --scenario=<name> --trace   ...with a request-by-request trace
  npm run sim -- --all                       Run every scenario
  npm run sim -- --race                      Demonstrate the distributed race condition
  npm run sim -- --help                      This message

${bold('Options')}
  --trace          Print each request with the limiter's internal state after it
  --json           Machine-readable output
  --limit=<n>      Race demo: the rate limit            (default 5)
  --concurrency=<n>  Race demo: requests in flight      (default 10)

${bold('Start here')}
  npm run sim -- --scenario=fixed-window-edge-burst
`;

function listScenarios(): void {
  console.log('');
  console.log(`  ${bold('Scenarios')}`);
  console.log('');

  const width = Math.max(...scenarios.map((s) => s.name.length));
  for (const s of scenarios) {
    const figure = s.figure ? dim(` [${s.figure}]`) : '';
    console.log(`  ${bold(s.name.padEnd(width))}${figure}`);
    console.log(`  ${' '.repeat(width)}  ${dim(s.summary)}`);
    console.log('');
  }

  console.log(`  ${dim('Run one with:')} npm run sim -- --scenario=<name>`);
  console.log('');
}

function runScenario(name: string, opts: { trace: boolean; json: boolean }): number {
  const scenario = findScenario(name);

  if (!scenario) {
    console.error(`\n  ${red('Unknown scenario:')} ${name}`);
    console.error(`  ${dim('Try:')} npm run sim -- --list\n`);
    return 1;
  }

  const result = simulate(scenario);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          scenario: scenario.name,
          figure: scenario.figure,
          traffic: scenario.traffic,
          runs: result.runs.map((r) => ({
            limiter: r.limiter.name,
            params: r.limiter.params,
            allowed: r.allowed,
            rejected: r.rejected,
            peakInRollingWindow: r.peakInRollingWindow,
            avgQueueDelayMs: r.avgQueueDelayMs,
            maxQueueDelayMs: r.maxQueueDelayMs,
            decisions: r.decisions,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(renderScenario(result));

  if (opts.trace) {
    for (const run of result.runs) {
      console.log(renderTrace(run));
    }
  }

  return 0;
}

function renderRace(result: RaceResult): string {
  const lines: string[] = [];
  const naive = result.strategy === 'read-check-write';

  lines.push('');
  lines.push(
    `  ${bold(naive ? 'GET / check / SET  (naive)' : 'Atomic check-and-increment  (Lua script)')}`,
  );
  lines.push('');

  for (const line of result.timeline) {
    const colour = line.includes('LOST UPDATE')
      ? yellow
      : line.includes('REJECT')
        ? red
        : line.includes('ALLOW')
          ? green
          : dim;
    lines.push(`    ${colour(line)}`);
  }

  lines.push('');
  lines.push(`    ${bold('allowed')}        ${result.allowed}  ${dim(`(limit ${result.limit})`)}`);
  lines.push(`    ${bold('final counter')}  ${result.finalCounter}`);

  if (result.overAdmitted > 0) {
    lines.push(
      `    ${yellow(`over the limit by ${result.overAdmitted} — the rate limit did not hold`)}`,
    );
  } else {
    lines.push(`    ${green('the limit held')}`);
  }

  if (result.lostUpdates > 0) {
    lines.push(
      `    ${yellow(`${result.lostUpdates} lost updates — the counter is not even counting correctly`)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function runRace(limit: number, concurrency: number): number {
  console.log('');
  console.log(dim('─'.repeat(78)));
  console.log(`  ${bold('The race condition')}  ${dim('(Figure 4-14)')}`);
  console.log(dim('─'.repeat(78)));
  console.log(
    `  ${concurrency} requests hit the counter at nearly the same instant. The limit is ${limit}.`,
  );
  console.log(
    `  ${dim('The store is 5ms away, so the gap between GET and SET is 5ms wide — and everything')}`,
  );
  console.log(`  ${dim('else in flight gets to run inside it.')}`);

  const naive = raceCondition('read-check-write', { limit, concurrency });
  const atomic = raceCondition('atomic', { limit, concurrency });

  console.log(renderRace(naive));
  console.log(renderRace(atomic));

  console.log(`  ${bold('What to notice')}`);
  console.log('');
  console.log(
    `  The naive version let ${naive.allowed} requests through a limit of ${limit}, and its counter`,
  );
  console.log(
    `  finished at ${naive.finalCounter} — so it does not even know it went wrong. Every request that read`,
  );
  console.log(
    `  the counter before anyone wrote to it saw the same stale value and cheerfully`,
  );
  console.log(`  admitted itself.`);
  console.log('');
  console.log(
    `  ${bold('The trap:')} the instinctive fix is a lock. Do not say that in an interview. A lock`,
  );
  console.log(
    `  around every request serialises your entire rate limiter and turns a 1ms check`,
  );
  console.log(
    `  into a queue — you have solved correctness by destroying the latency budget the`,
  );
  console.log(`  rate limiter existed to protect.`);
  console.log('');
  console.log(
    `  ${bold('The answer:')} make the whole read-check-write *one* operation the store executes`,
  );
  console.log(
    `  indivisibly. In Redis that is a Lua script (${dim('EVAL')}) or a sorted set. No lock, no`,
  );
  console.log(`  serialisation, no round trip in the middle for anyone to race through.`);
  console.log('');
  console.log(`  ${dim('See redis/token-bucket.lua for the real thing.')}`);
  console.log('');

  return 0;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      list: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      race: { type: 'boolean', default: false },
      trace: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  if (values.list) {
    listScenarios();
    return 0;
  }

  if (values.race) {
    return runRace(Number(values.limit ?? 5), Number(values.concurrency ?? 10));
  }

  if (values.all) {
    let code = 0;
    for (const s of scenarios) {
      code =
        runScenario(s.name, { trace: values.trace, json: values.json }) || code;
    }
    return code;
  }

  if (values.scenario) {
    return runScenario(values.scenario, {
      trace: values.trace,
      json: values.json,
    });
  }

  console.log(HELP);
  return 0;
}

process.exitCode = main();
