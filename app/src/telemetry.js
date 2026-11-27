const fs = require('fs');
const os = require('os');

const SENSITIVE_KEY = /secret|token|password|authorization|cookie/i;
const SENSITIVE_PARAM = /([?&](?:secret|token|password|authorization|cookie)=)[^&]*/gi;
const SENSITIVE_INLINE = /("?(?:secret|token|password|authorization|cookie)"?\s*[:=]\s*["']?)((?:Bearer\s+)?[^"'&,;)\s]+)/gi;

function redactUrl(value) {
  return String(value).replace(SENSITIVE_PARAM, '$1[REDACTED]');
}

function redact(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try { return JSON.stringify(redact(JSON.parse(trimmed))); } catch {}
    }
    return redactUrl(value).replace(SENSITIVE_INLINE, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = redact(item);
    }
    return out;
  }
  return value;
}

function rotateIfNeeded(file, maxBytes = 10 * 1024 * 1024, keep = 3) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < Number(maxBytes)) return false;
    for (let i = Math.max(2, keep); i >= 2; i--) {
      const src = `${file}.${i - 1}`;
      const dest = `${file}.${i}`;
      if (!fs.existsSync(src)) continue;
      fs.rmSync(dest, { force: true });
      fs.renameSync(src, dest);
    }
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

function systemInfo(baseDir, extra = {}) {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  return {
    ts: new Date().toISOString(),
    systemLocale: locale,
    preferredLanguages: locale ? [locale] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    node: process.versions.node || '',
    chrome: process.versions.chrome || '',
    electron: process.versions.electron || '',
    platform: process.platform,
    arch: process.arch,
    packaged: false,
    baseDir,
    cpuCount: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    ...extra,
  };
}

module.exports = { redact, redactUrl, rotateIfNeeded, systemInfo };
