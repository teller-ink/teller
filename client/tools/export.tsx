// The export affordance — one ghost link, shared by the two screens
// that list files: the shelf's packs and the plugins tool's panels.
//
// Not a registered tool (nothing in here calls `registerTool`), just a
// component two tools both need. It lives beside them rather than in
// `client/components/` because it is console furniture, not seat
// furniture, and the tools are its only callers.
//
// There is deliberately NO import twin. A `.pack` or `.panel` arrives
// by being dropped in the data dir, where the ten-second sweep finds it
// (rule 4a: the folder is the door) — a console upload would be a second
// way in that could disagree with the first.

import { useState } from 'react';
import { download } from '../lib/api.ts';
import { btnGhost } from '../lib/ui.ts';

export function Export({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button
        className={btnGhost}
        disabled={busy}
        title="zip this up as a file you can hand someone"
        onClick={() => {
          setBusy(true);
          setErr('');
          download(path, filename)
            .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
        }}
      >
        export
      </button>
      {err && <span className="w-full text-[11px] text-amber-500/80">{err}</span>}
    </>
  );
}
