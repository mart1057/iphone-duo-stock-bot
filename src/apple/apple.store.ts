import type { AppleStore } from './apple.types.js';

/**
 * Apple Store Thailand has no public store-list JSON endpoint (verified: the
 * retail store list page is client-rendered and /rsp-web/store-list 404s), so
 * stores are discovered from the pickup-message response itself, which carries
 * the full store record (code, name, address, lat/lng).
 *
 * Nothing here is hard-coded: a new Apple Store simply shows up in a later
 * response and gets upserted.
 */
export class StoreDirectory {
  private readonly byCode = new Map<string, AppleStore>();

  add(stores: readonly AppleStore[]): void {
    for (const store of stores) this.byCode.set(store.code, store);
  }

  get(code: string): AppleStore | undefined {
    return this.byCode.get(code);
  }

  all(): AppleStore[] {
    return [...this.byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  get size(): number {
    return this.byCode.size;
  }
}

/// Merges stores discovered across several postcode sweeps, keeping the record
/// with the most populated fields.
export const mergeStores = (stores: readonly AppleStore[]): AppleStore[] => {
  const directory = new StoreDirectory();
  const score = (store: AppleStore): number =>
    Object.values(store).filter((value) => value !== undefined && value !== null).length;

  for (const store of stores) {
    const existing = directory.get(store.code);
    if (!existing || score(store) > score(existing)) directory.add([store]);
  }

  return directory.all();
};
