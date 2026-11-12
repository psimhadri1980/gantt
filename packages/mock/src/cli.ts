
// npm run generate -- --tasks 10000 --links 0.5 --depth 3 --lanes 0 > big.json
import { generate } from './generate.ts';
/** Reads a numeric `--name value` command-line option, or the default. */
const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
process.stdout.write(JSON.stringify(generate({ tasks: arg('tasks', 10000), linkDensity: arg('links', 0.5), depth: arg('depth', 3), laneEvery: arg('lanes', 0), seed: arg('seed', 1) })));
