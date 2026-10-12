// Run the engine off the main thread so the page stays responsive while it works.
//   const w = new Worker(new URL('./lumvibeAudioWeb.worker.ts', import.meta.url), { type: 'module' });
//   w.postMessage({ voice: voiceBuf, beat: beatBuf, params }, [voiceBuf, beatBuf]);
//   w.onmessage = e => e.data.error ? show(e.data.error) : play(e.data.blob);
// NOT RUN IN A BROWSER (see lumvibeAudioWeb.ts).
import { bakeAudioStudioWeb } from './lumvibeAudioWeb';

self.onmessage = async (e: MessageEvent) => {
  try {
    const { voice, beat, params } = e.data as { voice: ArrayBuffer; beat?: ArrayBuffer | null; params: number[] };
    const r = await bakeAudioStudioWeb({ voice, beat, params });
    (self as unknown as Worker).postMessage({ blob: r.blob, durationSec: r.durationSec });
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ error: String(err?.message || err) });
  }
};
