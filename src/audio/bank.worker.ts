import { renderKey } from "./catalog";

/** Renders samples off the main thread and streams them back one by one. */
type Port = {
  onmessage: ((e: MessageEvent<{ keys: string[] }>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
const port = self as unknown as Port;

port.onmessage = (e) => {
  for (const key of e.data.keys) {
    try {
      const r = renderKey(key);
      port.postMessage({ key, data: r.data, sr: r.sr, loopStart: r.loopStart, loopEnd: r.loopEnd }, [r.data.buffer]);
    } catch (err) {
      port.postMessage({ key, error: String(err) }, []);
    }
  }
  port.postMessage({ done: true }, []);
};
