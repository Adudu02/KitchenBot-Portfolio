#!/usr/bin/env node
// Sanitization gate: scans a tree for secrets, real-looking phone numbers,
// forbidden files and denylisted terms before anything is committed.
//
// Findings are reported as { file, line, rule }. The matched value is never
// returned or printed, so the gate's own output cannot leak what it found.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic style keys
  /(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, // GitHub tokens
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{30,}/,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/, // AWS access key id
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/, // Google API key
  /(?<![A-Za-z0-9])EAA[A-Za-z0-9]{30,}/, // Meta / WhatsApp Cloud API tokens
  /(?<![A-Za-z0-9])xox[abeoprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/, // PEM / OpenSSH / PGP private keys
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  /(?<![A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}/, // Stripe-style keys
  /(?:api|secret|access|refresh)[_-]?(?:key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{24,}/i, // generic assignments
];

// Phone numbers. Separators are horizontal whitespace (incl. NBSP), dots and
// dashes only, so a match can never span lines.
const SEP = '[ \\t\\u00A0.-]';
// With a country code (+52, 52 or 0052): optional mobile "1" (optionally in
// parentheses), then an area code and either 3-4 / 4 digit groups or four pair
// groups. The leading boundary stops digit runs and hex tokens (epoch millis,
// hashes); the trailing one stops longer numbers.
const PHONE_WITH_COUNTRY_CODE = new RegExp(
  `(?<![A-Za-z0-9])(?:\\+|00)?52${SEP}?(?:\\(?1\\)?)?${SEP}?` +
    `(?:\\(?\\d{2,3}\\)?${SEP}?\\d{3,4}${SEP}?\\d{4}|\\(?\\d{2}\\)?(?:${SEP}\\d{2}){4})(?!\\d)`,
  'g',
);
// Without a country code, only separated 10-digit shapes: parenthesised area
// code (with 3-4 digit or pair groups), 2-4-4 groups, and five pair groups,
// joined by space, dash or dot.
// Bare 10-digit runs are not flagged (epoch seconds are 10 digits). Groups that
// continue into a longer separated sequence (dates, lists) are skipped.
const PHONE_LOCAL = new RegExp(
  `(?<![A-Za-z0-9])(?<!\\d${SEP})(?:\\(\\d{2,3}\\)${SEP}?(?:\\d{3,4}${SEP}\\d{4}|\\d{2}(?:${SEP}\\d{2}){3})|\\d{2}${SEP}\\d{4}${SEP}\\d{4}|\\d{2}(?:${SEP}\\d{2}){4})(?!\\d)(?!${SEP}\\d)`,
  'g',
);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Fictitious numbers: 55 0000 00NN, with or without +52 and the mobile "1".
const FICTITIOUS_PREFIXES = ['52550000', '5215500000', '55000000'];

const FORBIDDEN_EXTENSIONS = new Set([
  '.ogg', '.wav', '.mp3', '.opus', '.m4a', '.oga', '.flac',
  '.apk', '.jks', '.keystore', '.sqlite', '.db', '.pem', '.p12',
]);
const FORBIDDEN_BASENAMES = new Set(['local.properties']);
const FORBIDDEN_SEGMENTS = new Set(['audio', 'results', 'samples', 'dist', 'node_modules']);

const SKIPPED_DIRS = new Set(['node_modules', '.git']);

const BINARY_SNIFF_BYTES = 8192;

function isForbiddenPath(relPath) {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot > 0 && FORBIDDEN_EXTENSIONS.has(lower.slice(dot))) return true;
  if (FORBIDDEN_BASENAMES.has(lower)) return true;
  if ((lower === '.env' || lower.startsWith('.env.')) && lower !== '.env.example') return true;
  return parts.slice(0, -1).some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
}

function looksBinary(buffer) {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function hasRealPhone(line) {
  const uuidSpans = [...line.matchAll(UUID_PATTERN)].map((m) => [m.index, m.index + m[0].length]);
  for (const pattern of [PHONE_WITH_COUNTRY_CODE, PHONE_LOCAL]) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (uuidSpans.some(([from, to]) => start >= from && end <= to)) continue;
      const digits = match[0].replace(/\D/g, '');
      if (!FICTITIOUS_PREFIXES.some((prefix) => digits.startsWith(prefix))) return true;
    }
  }
  return false;
}

// When the root is a git work tree, scan exactly what git would commit
// (tracked + untracked-not-ignored), so ignored local build output cannot
// fail the gate. Otherwise walk the directory.
function gitFileList(root) {
  if (!existsSync(join(root, '.git'))) return null;
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .filter((rel) => existsSync(join(root, rel)));
  } catch {
    return null;
  }
}

async function walk(root, dir = root, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await walk(root, join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}

export async function scan(root, { denylist = [] } = {}) {
  const terms = denylist.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const files = (gitFileList(root) ?? (await walk(root))).filter(
    (rel) => !rel.split('/').some((part) => part === '.git'),
  );
  files.sort();

  const findings = [];
  for (const rel of files) {
    const lowerPath = rel.toLowerCase();
    if (isForbiddenPath(rel)) findings.push({ file: rel, line: 0, rule: 'forbidden-file' });
    if (hasRealPhone(rel)) findings.push({ file: rel, line: 0, rule: 'phone' });
    if (terms.some((term) => lowerPath.includes(term))) findings.push({ file: rel, line: 0, rule: 'denylist' });

    const abs = join(root, rel);
    if (!(await stat(abs)).isFile()) continue;
    const buffer = await readFile(abs);
    if (looksBinary(buffer)) continue;

    const lines = buffer.toString('utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      const line = index + 1;
      if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
        findings.push({ file: rel, line, rule: 'secret-pattern' });
      }
      if (hasRealPhone(text)) findings.push({ file: rel, line, rule: 'phone' });
      const lowerText = text.toLowerCase();
      if (terms.some((term) => lowerText.includes(term))) findings.push({ file: rel, line, rule: 'denylist' });
    });
  }
  return findings;
}

function parseArgs(argv) {
  const args = { root: null, denylist: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--denylist') {
      const value = argv[i + 1];
      // A missing, empty or flag-like value must never silently disable the denylist.
      args.denylist = value === undefined || value.trim() === '' || value.startsWith('--') ? '' : value;
      i += 1;
    } else if (!args.root) {
      args.root = argv[i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    console.error('usage: sanitize-check.mjs <root> [--denylist <path>]');
    return 2;
  }
  const root = await realpath(resolve(args.root));

  let denylist = [];
  if (args.denylist === '') {
    console.error('denylist path required');
    return 2;
  }
  if (args.denylist === undefined) {
    console.error('no denylist: generic rules only');
  } else {
    let denyPath;
    try {
      denyPath = await realpath(resolve(args.denylist));
    } catch {
      console.error('denylist file not found');
      return 2;
    }
    const rel = relative(root, denyPath);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      console.error('refusing to run: the denylist must live outside the scanned root');
      return 2;
    }
    denylist = (await readFile(denyPath, 'utf8')).split(/\r?\n/);
    if (!denylist.some((entry) => entry.trim() !== '')) {
      console.error('denylist is empty');
      return 2;
    }
  }

  const findings = await scan(root, { denylist });
  for (const f of findings) console.log(`${f.file}:${f.line}:${f.rule}`);
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`sanitize-check failed: ${err.message}`);
      process.exit(2);
    },
  );
}
