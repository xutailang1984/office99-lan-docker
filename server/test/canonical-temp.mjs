import { realpathSync } from 'node:fs';
import os from 'node:os';

// macOS can report /var/... as its temp root even though the physical directory
// is under /private/var. Start fixtures on the physical path so storage tests
// can keep rejecting actual symlinks inside their test directories.
const temp = realpathSync(os.tmpdir());
if (process.platform === 'win32') {
  process.env.TEMP = temp;
  process.env.TMP = temp;
} else {
  process.env.TMPDIR = temp;
}
