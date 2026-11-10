import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scan } from './sanitize-check.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'sanitize-check.mjs');

// Every planted value is assembled from fragments so that this test file does
// not trip the gate when the gate scans the repository that contains it.
const PLANTED_SECRETS = {
  'openai-style key': 'const k = "' + 'sk-' + 'A'.repeat(24) + '";\n',
  'github token': 'token=' + 'ghp_' + 'b1'.repeat(18) + '\n',
  'aws access key': 'id: ' + 'AKIA' + 'Q'.repeat(16) + '\n',
  'meta access token': 'EAA' + 'Zz9'.repeat(12) + '\n',
  'slack bot token': 'x = ' + 'xoxb-' + '1234567890-' + 'abcdefghij' + '\n',
  'private key block':
    '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----\nAAAA\n-----END ' + 'OPENSSH PRIVATE KEY' + '-----\n',
};

async function makeTree(files) {
  const root = await mkdtemp(join(tmpdir(), 'sanitize-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

function rulesOf(findings) {
  return findings.map((f) => f.rule);
}

test('clean tree has no findings', async () => {
  const root = await makeTree({
    'README.md': '# Hello\nNothing sensitive here.\n',
    'src/index.js': 'export const answer = 42;\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

for (const [name, content] of Object.entries(PLANTED_SECRETS)) {
  test(`detects secret pattern: ${name}`, async () => {
    const root = await makeTree({ 'src/config.js': content });
    const findings = await scan(root, {});
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'secret-pattern');
    assert.equal(findings[0].file, 'src/config.js');
    assert.equal(findings[0].line, 1);
  });
}

test('secret findings report the line number', async () => {
  const root = await makeTree({ 'a.txt': 'one\ntwo\n' + PLANTED_SECRETS['aws access key'] });
  const findings = await scan(root, {});
  assert.deepEqual(findings, [{ file: 'a.txt', line: 3, rule: 'secret-pattern' }]);
});

test('detects secret patterns without echoing the value', async () => {
  const planted = 'sk-' + 'A'.repeat(24);
  const root = await makeTree({ 'src/config.js': `const k = "${planted}";\n` });
  const res = spawnSync(process.execPath, [CLI, root], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.equal(res.stdout.trim(), 'src/config.js:1:secret-pattern');
  assert.ok(!res.stdout.includes(planted));
  assert.ok(!res.stderr.includes(planted));
});

test('does not mistake ordinary hyphenated words for secrets', async () => {
  const root = await makeTree({
    'notes.md': 'task-implementation-details-for-the-showcase and risk-assessment-for-everything\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

const PHONES = {
  'international spaced': '+52 1 33' + ' 1234 5678',
  'international compact': '+52' + '3312345678',
  'digits only with 1': '521' + '3312345678',
  'parenthesised area code': '+52 (33)' + ' 1234-5678',
};

for (const [name, phone] of Object.entries(PHONES)) {
  test(`detects Mexican phone format: ${name}`, async () => {
    const root = await makeTree({ 'doc.md': `Call ${phone} today\n` });
    const findings = await scan(root, {});
    assert.deepEqual(findings, [{ file: 'doc.md', line: 1, rule: 'phone' }]);
  });
}

test('allows fictitious phones', async () => {
  const root = await makeTree({
    'doc.md': 'Use +52 55 0000 0001 or 525500000001 or +52 1 55 0000 0002 in examples\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

test('phone scan does not match digit runs embedded in longer numbers', async () => {
  const root = await makeTree({
    'ids.txt': 'epoch 17' + '523312345678901\nserial 5' + '233123456789012\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

test('phone scan does not match hex or uuid tokens', async () => {
  const root = await makeTree({
    'hashes.txt':
      'sha deadbeef52' + '3312345678\n' +
      'id 3f9a52b1-52' + '33-4123-8456-' + '7890abcdef12\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

test('phone scan does not match ISO timestamps', async () => {
  const root = await makeTree({
    'log.txt':
      '2026-05-21T10:52:33.123456Z started\n' +
      '2026-12-31 23:59:52 +0000 done\n' +
      '20261105T105233Z\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

test('phone scan does not span line breaks', async () => {
  const root = await makeTree({ 'a.txt': 'version 52\n1\n 3312 3456 7890\n' });
  assert.deepEqual(await scan(root, {}), []);
});

test('flags forbidden files', async () => {
  const root = await makeTree({
    'voice-eval/audio/x.ogg': 'x',
    'app-debug.apk': 'x',
    'local.properties': 'sdk.dir=/x\n',
    '.env': 'A=1\n',
    'voice-eval/results/r.json': '{}\n',
    'keys/release.jks': 'x',
    'keys/upload.keystore': 'x',
    'a/b/clip.wav': 'x',
    'a/b/clip.mp3': 'x',
    'pkg/dist/index.js': 'export {};\n',
    '.env.example': 'A=\n',
    'docs/notes.md': 'hello\n',
  });
  const findings = await scan(root, {});
  assert.ok(findings.every((f) => f.rule === 'forbidden-file'), JSON.stringify(findings));
  assert.deepEqual(findings.map((f) => f.file).sort(), [
    '.env',
    'a/b/clip.mp3',
    'a/b/clip.wav',
    'app-debug.apk',
    'keys/release.jks',
    'keys/upload.keystore',
    'local.properties',
    'pkg/dist/index.js',
    'voice-eval/audio/x.ogg',
    'voice-eval/results/r.json',
  ]);
  assert.ok(!findings.some((f) => f.file === '.env.example'));
});

test('denylist terms are case-insensitive', async () => {
  const root = await makeTree({ 'notes.md': 'We met at the acme kitchen yesterday\n' });
  const findings = await scan(root, { denylist: ['Acme Kitchen'] });
  assert.deepEqual(findings, [{ file: 'notes.md', line: 1, rule: 'denylist' }]);
});

test('denylist also checks file paths', async () => {
  const root = await makeTree({ 'docs/acme-kitchen-plan.md': 'nothing\n' });
  const findings = await scan(root, { denylist: ['acme-kitchen'] });
  assert.deepEqual(findings, [{ file: 'docs/acme-kitchen-plan.md', line: 0, rule: 'denylist' }]);
});

test('denylist ignores blank entries', async () => {
  const root = await makeTree({ 'notes.md': 'plain text\n' });
  assert.deepEqual(await scan(root, { denylist: ['', '   '] }), []);
});

test('CLI reads the denylist file and never prints the matched term', async () => {
  const root = await makeTree({ 'notes.md': 'visit Acme Kitchen soon\n' });
  const outside = await makeTree({ 'deny.txt': 'Acme Kitchen\n\n' });
  const res = spawnSync(process.execPath, [CLI, root, '--denylist', join(outside, 'deny.txt')], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.equal(res.stdout.trim(), 'notes.md:1:denylist');
  assert.ok(!/acme/i.test(res.stdout + res.stderr));
});

test('CLI exits 0 on a clean tree', async () => {
  const root = await makeTree({ 'a.md': 'clean\n' });
  const res = spawnSync(process.execPath, [CLI, root], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('refuses a denylist inside the scanned root', async () => {
  const root = await makeTree({ 'deny.txt': 'secret term\n', 'a.md': 'x\n' });
  const res = spawnSync(process.execPath, [CLI, root, '--denylist', join(root, 'deny.txt')], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 2);
  assert.ok(!res.stdout.includes('secret term'));
});

test('ignores node_modules and .git', async () => {
  const root = await makeTree({
    'node_modules/x.js': PLANTED_SECRETS['openai-style key'],
    'node_modules/y/clip.ogg': 'x',
    '.git/config': PLANTED_SECRETS['github token'],
    'src/ok.js': 'export {};\n',
  });
  assert.deepEqual(await scan(root, {}), []);
});

test('skips content scanning of binary files', async () => {
  const root = await makeTree({ 'img/logo.png': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(PLANTED_SECRETS['aws access key'])]) });
  assert.deepEqual(await scan(root, {}), []);
});

test('binary files still get path checks', async () => {
  const root = await makeTree({ 'a/clip.ogg': Buffer.from([0, 1, 2, 3]) });
  assert.deepEqual(rulesOf(await scan(root, {})), ['forbidden-file']);
});

test('in a git work tree, scans what git would commit and skips ignored files', async () => {
  const root = await makeTree({
    '.gitignore': 'dist/\n.env\n',
    'dist/bundle.js': 'export {};\n',
    '.env': 'A=1\n',
    'src/leak.js': PLANTED_SECRETS['openai-style key'],
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  assert.deepEqual(await scan(root, {}), [{ file: 'src/leak.js', line: 1, rule: 'secret-pattern' }]);
});
