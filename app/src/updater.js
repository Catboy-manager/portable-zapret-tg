'use strict';

const crypto = require('crypto');

const PRESERVED = ['config', 'history', 'logs', 'RUN_AS_ADMIN.txt'];
const ASSET_PATTERN = /ZapretTG-(\d+\.\d+\.\d+)-win-x64\.zip/i;
const SHA_PATTERN = /SHA256:\s*([0-9a-f]{64})/i;
const ALLOWED_ASSET_HOSTS = ['github.com', 'objects.githubusercontent.com'];

function normalizeVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function parseLatestRelease(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('empty release payload');
  const version = normalizeVersion(payload.tag_name);
  if (!version) throw new Error('release tag has no valid version');
  const versionText = version.join('.');
  const body = String(payload.body || '');
  const shaMatch = body.match(SHA_PATTERN);
  if (!shaMatch) throw new Error('SHA256 is missing from the release body');
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find((a) => a && ASSET_PATTERN.test(String(a.name || '')));
  if (!asset || !asset.browser_download_url) throw new Error('portable ZIP asset is missing');
  let assetUrl;
  try {
    assetUrl = new URL(String(asset.browser_download_url));
  } catch {
    throw new Error('asset URL is invalid');
  }
  if (assetUrl.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.includes(assetUrl.hostname)) {
    throw new Error('asset URL host is not allowed');
  }
  return {
    version: versionText,
    assetName: String(asset.name),
    assetUrl: String(asset.browser_download_url),
    sha256: shaMatch[1].toLowerCase(),
    notes: body.trim(),
  };
}

function verifySha256(buffer, expected) {
  if (!/^[0-9a-f]{64}$/i.test(String(expected || ''))) return false;
  if (!Buffer.isBuffer(buffer)) return false;
  return crypto.createHash('sha256').update(buffer).digest('hex') === String(expected).toLowerCase();
}

function isSafeEntry(entry) {
  if (typeof entry !== 'string' || !entry) return false;
  if (entry.startsWith('/') || entry.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(entry)) return false;
  if (entry.split(/[\\/]/).includes('..')) return false;
  if (/[\0\r\n]/.test(entry)) return false;
  return true;
}

function isPreserved(entry) {
  const normalized = String(entry).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return PRESERVED.some((name) => {
    const target = name.toLowerCase();
    return normalized === target || normalized.startsWith(`${target}/`);
  });
}

function planUpdate(entries) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array');
  const replace = [];
  const preserve = [];
  for (const entry of entries) {
    if (!isSafeEntry(entry)) throw new Error(`unsafe archive path: ${entry}`);
    (isPreserved(entry) ? preserve : replace).push(entry);
  }
  return { replace, preserve };
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildApplyScript({ appRoot, stagingDir, exeName = 'ZapretTG.exe', parentPid }) {
  if (!appRoot || !stagingDir) throw new Error('appRoot and stagingDir are required');
  const pid = Number(parentPid) || 0;
  return `@'
ZapretTG update handoff
'@ | Out-Null
$ErrorActionPreference = 'Stop'
$appRoot = ${psQuote(appRoot)}
$staging = ${psQuote(stagingDir)}
$exeName = ${psQuote(exeName)}
$parentId = ${pid}
$preserve = @('config', 'history', 'logs', 'RUN_AS_ADMIN.txt')
$backup = Join-Path $staging '.local-state'
$deadline = (Get-Date).AddMinutes(2)

while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) { exit 1 }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 500

New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($name in $preserve) {
  $source = Join-Path $appRoot $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination $backup -Recurse -Force
  }
}

$applied = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    Copy-Item -LiteralPath (Join-Path $staging '*') -Destination $appRoot -Recurse -Force -ErrorAction Stop
    $applied = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $applied) { exit 2 }

foreach ($name in $preserve) {
  $saved = Join-Path $backup $name
  if (Test-Path -LiteralPath $saved) {
    Copy-Item -LiteralPath $saved -Destination (Join-Path $appRoot $name) -Recurse -Force
  }
}

Start-Process -FilePath (Join-Path $appRoot $exeName) -WorkingDirectory $appRoot
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
`;
}

module.exports = {
  compareVersions,
  parseLatestRelease,
  verifySha256,
  planUpdate,
  buildApplyScript,
  PRESERVED,
};
