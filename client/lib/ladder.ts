// The system's range ladder, as the client asks for it.
//
// `bands` is a LIST declaration, not a record — four rungs in order, and
// order is the whole point — so it arrives through
// `/api/stack/declarations/bands` rather than the record door the seat's
// other vocabulary comes through (`record()` merges objects per key and
// hands back `{}` for an array; that empty object cost half an hour).
//
// One hook rather than a prop threaded from the chrome: a request is
// cheap and it is a STREAM that is scarce on a LAN host (rule 6 — six
// connections, and an SSE stream never gives one back). This re-reads
// on the same nudge every other declaration does, so a pack correction
// reaches the buttons without a reload.

import { bandsIn, type Band } from '../../core/bands.ts';
import { api } from './api.ts';
import { DECLARED, useLive } from './use-session.ts';

const NO_LADDER: Band[] = [];

export function useBands(): Band[] {
  const { data } = useLive(
    () => api<unknown>('/api/stack/declarations/bands').then(bandsIn).catch(() => NO_LADDER),
    [],
    { on: DECLARED },
  );
  return data ?? NO_LADDER;
}
