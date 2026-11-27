const CRITICAL_TARGETS = [
  'YouTubeWeb',
  'YouTubeVideoRedirect',
  'DiscordCDN',
  'DiscordMedia',
  'RuTrackerMain',
];

const DEFAULT_HEALTH_TARGETS = [
  'DiscordMain',
  'DiscordGateway',
  'DiscordCDN',
  'DiscordMedia',
  'YouTubeWeb',
  'YouTubeVideoRedirect',
  'YouTubeImage',
  'RuTrackerMain',
  'RuTrackerStatic',
];

const LEGACY_TARGETS = ['YouTubeShort'];

function normalizeHealthTargets(saved) {
  const names = Array.isArray(saved) ? saved.filter(n => typeof n === 'string' && n) : [];
  const result = names.filter(n => !LEGACY_TARGETS.includes(n));
  for (const name of DEFAULT_HEALTH_TARGETS) {
    if (!result.includes(name)) result.push(name);
  }
  return result;
}

function isCriticalTarget(name) {
  return CRITICAL_TARGETS.includes(name);
}

function effectiveCheckOk(row) {
  if (!row || row.ok !== true) return false;
  const status = Number(row.status);
  return Number.isFinite(status) && status >= 200 && status < 300;
}

module.exports = {
  CRITICAL_TARGETS,
  DEFAULT_HEALTH_TARGETS,
  normalizeHealthTargets,
  isCriticalTarget,
  effectiveCheckOk,
};
