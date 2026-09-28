import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class SnapshotStore {
  constructor(directory) { this.directory = directory; this.sequence = 0; this.pending = false; this.error = null; this.fallback = false; this.lastSavedAt = null; this.chain = Promise.resolve(); }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    const good = [], bad = [];
    for (const slot of [0, 1]) {
      const file = path.join(this.directory, `snapshot-${slot}.json`);
      try {
        const raw = await fs.readFile(file, 'utf8');
        try {
          const envelope = JSON.parse(raw);
          if (envelope.schema !== 1 || !Number.isSafeInteger(envelope.sequence) || !envelope.state || envelope.checksum !== digest(envelope.state)) throw Error('invalid snapshot checksum');
          good.push(envelope);
        } catch { bad.push({ file, raw }); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!good.length && bad.length) throw Error('Both world snapshots are invalid; originals retained.');
    for (const { file, raw } of bad) await fs.writeFile(`${file}.corrupt-${Date.now()}`, raw, { flag: 'wx' });
    good.sort((a, b) => b.sequence - a.sequence);
    this.fallback = bad.length > 0;
    if (!good.length) return null;
    this.sequence = good[0].sequence; this.lastSavedAt = good[0].savedAt;
    return good[0].state;
  }
  save(state) {
    // Capture synchronously: personal inventory and world always share one tick.
    const snapshot = structuredClone(state);
    this.pending = true;
    const operation = this.chain.catch(() => {}).then(async () => {
      const sequence = this.sequence + 1;
      const envelope = { schema: 1, sequence, savedAt: new Date().toISOString(), checksum: digest(snapshot), state: snapshot };
      const file = path.join(this.directory, `snapshot-${sequence % 2}.json`), temporary = `${file}.tmp`;
      try {
        await fs.mkdir(this.directory, { recursive: true });
        const handle = await fs.open(temporary, 'w');
        try { await handle.writeFile(JSON.stringify(envelope)); await handle.sync(); } finally { await handle.close(); }
        const check = JSON.parse(await fs.readFile(temporary, 'utf8'));
        if (check.checksum !== digest(check.state)) throw Error('snapshot verification failed');
        await fs.rename(temporary, file);
        this.sequence = sequence; this.lastSavedAt = envelope.savedAt; this.error = null;
      } catch (error) { this.error = '存档写入失败，请检查磁盘空间与目录权限'; throw error; }
    });
    this.chain = operation;
    operation.finally(() => { if (this.chain === operation) this.pending = false; }).catch(() => {});
    return operation;
  }
  async archive(state) {
    await this.save(state);
    const directory = path.join(this.directory, 'archives', `${state.worldId}-${Date.now()}`);
    await fs.mkdir(directory, { recursive: true });
    for (const slot of [0, 1]) { try { await fs.copyFile(path.join(this.directory, `snapshot-${slot}.json`), path.join(directory, `snapshot-${slot}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  status() { return { policy: 'continuous', sequence: this.sequence, lastSavedAt: this.lastSavedAt, pending: this.pending, error: this.error, fallback: this.fallback }; }
}
