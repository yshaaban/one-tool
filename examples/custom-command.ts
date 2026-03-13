import { main } from './quickstarts/custom-command.js';
import { runIfEntrypoint } from './shared/example-utils.js';

export { main } from './quickstarts/custom-command.js';

await runIfEntrypoint(import.meta.url, main);
