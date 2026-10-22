// HC-SR04 distance from the light bar. The Arduino prints "DIST <cm>" several times a second;
// this reads those lines from the same USB serial port the light bar uses.

const listeners = new Set();
export const sensor = {
  cm: -1,          // smoothed distance, -1 = nothing in range
  raw: -1,
  at: 0,           // when the last reading arrived
  base: null,      // distance when the reference was set
  hist: [],
  get live() { return performance.now() - this.at < 1500; },
  on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  // Ratio > 1 means closer to the screen than at the reference.
  get closeness() { return this.base && this.cm > 0 ? this.base / this.cm : 1; },
};

let reader = null;
export async function readSensor(port) {
  if (!port?.readable) return;
  const decoder = new TextDecoder();
  let buf = '';
  try {
    reader = port.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = /^DIST\s+(-?\d+)/.exec(line);
        if (!m) continue;
        const v = Number(m[1]);
        sensor.raw = v; sensor.at = performance.now();
        sensor.hist.push(v); if (sensor.hist.length > 5) sensor.hist.shift();
        // Median of the last five readings, ignoring "nothing in range" unless most are empty.
        const good = sensor.hist.filter(x => x > 0).sort((a, b) => a - b);
        sensor.cm = good.length >= 3 ? good[Math.floor(good.length / 2)] : -1;
        listeners.forEach(cb => cb(sensor));
      }
    }
  } catch { /* port closed */ }
  finally { try { reader?.releaseLock(); } catch {} reader = null; }
}
export async function stopSensor() {
  try { await reader?.cancel(); } catch {}
  sensor.at = 0; sensor.cm = -1; sensor.hist = [];
}
