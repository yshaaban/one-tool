export async function ensureIndexedDbSupport(): Promise<void> {
  if ('indexedDB' in globalThis) {
    return;
  }

  await import('fake-indexeddb/auto');
}

export function createExampleDbName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
