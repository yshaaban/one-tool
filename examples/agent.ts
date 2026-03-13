import { main } from './reference/provider-agent.js';
import { runIfEntrypointWithErrorHandling } from './shared/example-utils.js';

export { main } from './reference/provider-agent.js';

await runIfEntrypointWithErrorHandling(import.meta.url, main);
