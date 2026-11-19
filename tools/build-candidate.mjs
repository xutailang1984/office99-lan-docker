import {spawn} from 'node:child_process';
import {access, copyFile, mkdir, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const runtime = path.join(root, '.runtime');
const output = path.resolve(process.argv[2] ?? path.join(runtime, 'dev-web'));
if (!output.startsWith(runtime + path.sep)) throw Error('Output must be under .runtime');
if (process.argv.length > 3) throw Error('Usage: node tools/build-candidate.mjs [.runtime/dev-web]');
await mkdir(output, {recursive: true});
const platform = process.platform;
const version = '4.7.2';
const tag = version + '.stable';
const env = {...process.env};
const defaultLocation = {
  darwin: '/Applications/Godot.app/Contents/MacOS/Godot',
  win32: path.join(os.homedir(), '.local/share/godot', version, 'Godot_v' + version + '-stable_win64.exe')
};
const godot = process.env.GODOT_EXE || defaultLocation[platform] || 'godot';
const normalTemplates = platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Godot/export_templates', tag)
  : platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/Godot/export_templates', tag)
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'godot/export_templates', tag);

// Windows uses a small isolated profile. macOS and Linux use Godot's normal template directory.
const profile = path.join(runtime, 'build-profile');
const templates = platform === 'win32' ? path.join(profile, 'roaming/Godot/export_templates', tag) : normalTemplates;
if (platform === 'win32') {
  env.APPDATA = path.join(profile, 'roaming');
  env.LOCALAPPDATA = path.join(profile, 'local');
  env.TMP = env.TEMP = path.join(profile, 'temp');
  for (const dir of [templates, env.LOCALAPPDATA, env.TEMP]) await mkdir(dir, {recursive: true});
}
for (const name of ['version.txt', 'web_nothreads_release.zip']) {
  const target = path.join(templates, name);
  try {
    await access(target);
  } catch {
    try {
      if (platform === 'win32') await copyFile(path.join(normalTemplates, name), target);
      else throw Error('Missing templates');
    } catch {
      throw Error('Install Godot ' + version + ' export templates before building: ' + normalTemplates);
    }
  }
}

async function run(executable, args, label) {
  const child = spawn(executable, args, {cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { log += part; });
  const deadline = setTimeout(() => child.kill(), 360_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(deadline);
    await writeFile(path.join(output, label + '.log'), log);
  }
  if (code !== 0 || /^\s*(SCRIPT ERROR:|ERROR:)/m.test(log)) {
    const errors = log.split(/\r?\n/).filter(line => /SCRIPT ERROR:|ERROR:|at:/.test(line)).slice(0, 15);
    throw Error(label + ' failed. See ' + path.join(output, label + '.log') + '\n' + errors.join('\n'));
  }
  return log.trim();
}
const engineVersion = await run(godot, ['--version'], 'godot-version');
if (!engineVersion.startsWith(version + '.stable.')) throw Error('Expected Godot ' + version + ' stable; found ' + engineVersion);
const project = path.join(root, 'client');
await run(process.execPath, ['tools/moba/sync-data.mjs'], 'moba-data');
await run(godot, ['--headless', '--path', project, '--import'], 'import');
await run(godot, ['--headless', '--path', project, '--export-release', 'Web', path.join(output, 'index.html')], 'export');
await run(process.execPath, ['tools/finalize_web.mjs', output], 'finalize');
for (const name of ['index.html','play.html','index.wasm','index.pck','platform/app.mjs','moba-play.html','moba/app.mjs','moba/sim/world.mjs']) {
  if (!(await stat(path.join(output, name))).size) throw Error('Empty Web export: ' + name);
}
console.log(JSON.stringify({exported: true, platform, output, engineVersion}));
