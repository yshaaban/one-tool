import { main } from './reference/demo-cli.js';
import { runIfEntrypoint } from './shared/example-utils.js';

export { main } from './reference/demo-cli.js';

await runIfEntrypoint(import.meta.url, main);
