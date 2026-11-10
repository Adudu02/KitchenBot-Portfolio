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
];

// Mexican numbers: +52, optional mobile "1", area code, then 7-8 digits.
// Horizontal whitespace only, so a match can never span lines. Digit runs that
// are part of a longer token (epoch millis, hashes, UUID segments) are excluded
// by the word-character and "word-" boundaries.
const PHONE_PATTERN =
  /(?<!\w)(?<!\w-)\+?52[ \t-]?1?[ \t-]?\(?\d{2,3}\)?[ \t-]?\d{3,4}[ \t-]?\d{4}(?!\w)(?!-\w)/g;
// Fictitious numbers (+52 55 0000 00NN, optionally with the mobile "1").
const FICTITIOUS_PREFIXES = ['52550000', '5215500000'];

const FORBIDDEN_EXTENSIONS = new Set(['.ogg', '.wav', '.mp3', '.apk', '.jks', '.keystore']);
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
  return parts.slice(0, -1).some((segment) => FORBIDDEN_SEGMENTS.has(segment));
}

function looksBinary(buffer) {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function hasRealPhone(line) {
  for (const match of line.matchAll(PHONE_PATTERN)) {
    const digits = match[0].replace(/\D/g, '');
    if (!FICTITIOUS_PREFIXES.some((prefix) => digits.startsWith(prefix))) return true;
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
  const args = { root: null, denylist: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--denylist') {
      args.denylist = argv[i + 1] ?? null;
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
  if (args.denylist) {
    let denyPath;
    try {
      denyPath = await realpath(resolve(args.denylist));
    } catch {
      console.error('denylist file not found');
      return 2;
    }
    const rel = relative(root, denyPath);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      console.error('refusing to run: the denylist must live outside the scanned root');
      return 2;
    }
    denylist = (await readFile(denyPath, 'utf8')).split(/\r?\n/);
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
