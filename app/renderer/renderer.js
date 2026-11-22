const $ = (id) => document.getElementById(id);

let currentStatus = null;
let pendingSettingsTimer = null;

function esc(s) { return String(s == null ? '' : s); }
function setBanner(msg, kind = 'info') {
  const b = $('banner');
  b.textContent = msg;
  b.className = `banner ${kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'info'}`;
}

function setDot(id, state) {
  const d = $(id);
  d.className = 'dot' + (state ? ' ' + state : '');
}

function gatherSettingsPatch() {
  const mode = document.querySelector('#modeSegment .seg.active')?.dataset.mode || currentStatus?.settings?.winwsMode || 'user';
  return {
    winwsMode: mode,
    monitorIntervalSec: Number($('monInterval').value) || 120,
    probeTimeoutMs: Number($('monTimeout').value) || 6000,
    failThreshold: Number($('monFail').value) || 3,
    candidateCount: Number($('monCand')?.value) || 3,
    cooldownSec: Number($('monCooldown').value) || 600,
    autoSwitchEnabled: $('chkAutoSwitch').checked,
    autoSelect: $('chkAutoSelect').checked,
    tgAutoStart: $('chkTgAuto').checked,
    tgProxy: {
      host: $('tgHost').value || '127.0.0.1',
      port: Number($('tgPort').value) || 1080,
      secret: $('tgSecret').value || '',
    },
  };
}

function scheduleSettingsSave() {
  clearTimeout(pendingSettingsTimer);
  pendingSettingsTimer = setTimeout(async () => {
    try { await window.api.saveSettings(gatherSettingsPatch()); } catch {}
  }, 350);
}

function updateModeUI(mode) {
  document.querySelectorAll('#modeSegment .seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('modeHint').textContent = mode === 'service'
    ? 'Режим службы: выбранный general*.bat устанавливается как служба zapret (sc create/start, реестр стратегии). Нужны права администратора.'
    : 'Пользовательский режим: winws запускается как процесс. Нужны права администратора для WinDivert/драйвера.';
}

function renderCheck(check) {
  const el = $('checkResults');
  if (!check) {
    el.innerHTML = '<div class="result"><div class="name">Нет данных</div><div class="meta">Нажмите «Проверить».</div></div>';
    $('lastCheckMeta').textContent = 'Проверка ещё не выполнялась';
    return;
  }
  $('lastCheckMeta').textContent = `${new Date(check.ts).toLocaleString()} · ${check.okCount}/${check.total} OK · ${check.overallOk ? 'стабильно' : 'деградация'} · ${esc(check.reason || '')}`;
  const items = (check.results || []).map(r => `
    <div class="result">
      <div class="name">${esc(r.name)}</div>
      <span class="badge ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'OK' : 'FAIL'}</span>
      <div class="meta">${r.status ? 'HTTP ' + esc(r.status) : ''} ${esc(r.error || '')}<br>${esc(r.url || '')}</div>
    </div>`).join('');
  const tg = check.telegram ? `
    <div class="result">
      <div class="name">Telegram local proxy</div>
      <span class="badge ${(check.telegram.running || check.telegram.reachable) ? 'ok' : 'bad'}">${(check.telegram.running || check.telegram.reachable) ? 'OK' : 'FAIL'}</span>
      <div class="meta">процесс: ${check.telegram.running ? 'да' : 'нет'} · порт: ${check.telegram.reachable ? 'слушается' : 'нет'}</div>
    </div>` : '';
  el.innerHTML = items + tg;
}

function renderStats(stats, profiles) {
  const el = $('statsSummary');
  const prof = (stats && stats.profiles) || {};
  const rows = (profiles || []).map(p => {
    const s = prof[p] || { success: 0, fail: 0 };
    const total = (s.success || 0) + (s.fail || 0);
    if (!total) return null;
    const rate = Math.round((s.success / total) * 100);
    return `${p}: ${rate}% (${s.success}/${total})`;
  }).filter(Boolean).slice(0, 8);
  el.textContent = rows.length ? 'История профилей: ' + rows.join(' · ') : 'История успешности профилей пока пустая.';
}

function renderStatus(s) {
  currentStatus = s;
  const admin = !!s.isAdmin;
  $('adminBanner').classList.toggle('hidden', admin);
  setDot('dotAdmin', admin ? 'ok' : 'warn');
  $('sideAdmin').textContent = admin ? 'Администратор' : 'Нет прав';

  const sel = $('profileSelect');
  const currentSel = sel.value;
  sel.innerHTML = '';
  for (const p of (s.profiles || [])) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  }
  const target = s.settings.activeProfile || currentSel || s.settings.lastGoodProfile;
  if (target && [...sel.options].some(o => o.value === target)) sel.value = target;

  const winws = s.winws || {};
  const running = !!winws.running;
  setDot('dotWinws', running ? 'ok' : 'bad');
  $('sideWinws').textContent = running ? (s.settings.activeProfile || 'Запущен') : 'Остановлен';

  const svc = s.service || {};
  setDot('dotService', svc.running ? 'ok' : svc.installed ? 'warn' : '');
  $('sideService').textContent = svc.installed ? (svc.running ? 'Работает' : 'Остановлена') : 'Не установлена';

  const tg = s.telegram || {};
  const tgOk = !!(tg.running || tg.reachable);
  setDot('dotTg', tgOk ? 'ok' : 'bad');
  $('sideTg').textContent = tgOk ? `127.0.0.1:${tg.port || s.settings.tgProxy?.port || 1080}` : 'Не активен';

  const mon = s.monitor || {};
  setDot('dotMon', mon.running ? 'ok' : 'warn');
    $('sideMon').textContent = mon.running ? 'active' : 'stopped';
  const lock = !!s.settings.manualProfileLock;
  const lockBtn = $('btnManualLock'); if (lockBtn) { lockBtn.textContent = lock ? 'Ручной lock: ВКЛ' : 'Ручной lock: ВЫКЛ'; lockBtn.classList.toggle('warn', lock); }
  const lockInfo = $('manualLockInfo'); if (lockInfo) lockInfo.textContent = lock ? `Зафиксирован: ${s.settings.manualProfile || s.settings.activeProfile || '—'}` : 'Авто-переключение разрешено (если включено)';

  $('tgHost').value = s.settings.tgProxy?.host || '127.0.0.1';
  $('tgPort').value = s.settings.tgProxy?.port || 1080;
  $('tgSecret').value = s.settings.tgProxy?.secret || '';
  $('monInterval').value = s.settings.monitorIntervalSec;
  $('monTimeout').value = s.settings.probeTimeoutMs;
  $('monFail').value = s.settings.failThreshold;
  $('monCooldown').value = s.settings.cooldownSec;
  $('chkAutoSwitch').checked = !!s.settings.autoSwitchEnabled;
  $('chkAutoSelect').checked = !!s.settings.autoSelect;
  $('chkTgAuto').checked = !!s.settings.tgAutoStart;
  $('tgLinkInline').textContent = tg.link || '—';

  updateModeUI(s.settings.winwsMode || 'user');
  renderCheck(mon.lastCheck);
  renderStats(s.stats, s.profiles);
}

async function refresh() {
  try { renderStatus(await window.api.getStatus()); }
  catch (e) { setBanner('Ошибка статуса: ' + e.message, 'error'); }
}
async function refreshLogs() {
  try {
    const lines = await window.api.getLogs(450);
    const el = $('logView');
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
  } catch {}
}

async function withBusy(btn, label, fn) {
  const orig = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { await fn(); }
  catch (e) { setBanner('Ошибка: ' + (e && e.message ? e.message : String(e)), 'error'); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

async function saveAndRefresh() {
  await window.api.saveSettings(gatherSettingsPatch());
  await refresh();
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#modeSegment .seg').forEach(btn => {
    btn.addEventListener('click', async () => {
      updateModeUI(btn.dataset.mode);
      await saveAndRefresh();
      setBanner(btn.dataset.mode === 'service' ? 'Режим: служба Windows' : 'Режим: пользовательский процесс', 'ok');
    });
  });

  $('btnRefresh').onclick = () => withBusy($('btnRefresh'), 'Обновление…', async () => { await refresh(); await refreshLogs(); setBanner('Статус обновлён', 'ok'); });
  $('btnProbe').onclick = () => withBusy($('btnProbe'), 'Проверка…', async () => {
    const r = await window.api.probeNow(); if (r.check) renderCheck(r.check); if (r.status) renderStatus(r.status); await refreshLogs();
    setBanner(r.check?.overallOk ? 'Проверка: цели доступны' : 'Проверка: есть деградация/недоступность', r.check?.overallOk ? 'ok' : 'warn');
  });

  $('btnApply').onclick = () => withBusy($('btnApply'), 'Применяю…', async () => {
    await saveAndRefresh();
    const profile = $('profileSelect').value;
    const r = await window.api.applyProfile(profile);
    if (r.status) renderStatus(r.status);
    await refreshLogs();
    if (r.ok) setBanner(`Профиль применён: ${profile}`, 'ok');
    else setBanner(r.result?.message || r.result?.hint || `Не удалось применить: ${profile}. Запустите от имени администратора.`, 'error');
  });

  $('btnStopBypass').onclick = () => withBusy($('btnStopBypass'), 'Останавливаю…', async () => {
    const r = await window.api.stopBypass(); if (r.status) renderStatus(r.status); await refreshLogs();
    setBanner('Bypass остановлен', 'ok');
  });

  $('btnInstallService').onclick = () => withBusy($('btnInstallService'), 'Служба…', async () => {
    await window.api.saveSettings({ ...gatherSettingsPatch(), winwsMode: 'service' });
    updateModeUI('service');
    const r = await window.api.startService($('profileSelect').value);
    if (r.status) renderStatus(r.status); await refreshLogs();
    setBanner(r.ok ? 'Служба zapret установлена/запущена' : (r.result?.hint || r.result?.error || 'Ошибка службы. Нужны права администратора.'), r.ok ? 'ok' : 'error');
  });

  $('btnRemoveService').onclick = () => withBusy($('btnRemoveService'), 'Удаление…', async () => {
    const r = await window.api.removeService(); if (r.status) renderStatus(r.status); await refreshLogs();
    setBanner(r.ok ? 'Служба удалена' : 'Не удалось удалить службу', r.ok ? 'ok' : 'error');
  });

    const lockBtn = $('btnManualLock'); if (lockBtn) lockBtn.onclick = () => withBusy(lockBtn, '...', async () => { const r = await window.api.setManualLock(!currentStatus?.settings?.manualProfileLock); if (r.status) renderStatus(r.status); setBanner(r.status?.settings?.manualProfileLock ? 'Ручной lock включён: авто-переключение не будет менять профиль' : 'Ручной lock выключен', 'ok'); });
  $('btnAutoSwitch').onclick = () => withBusy($('btnAutoSwitch'), 'Подбор…', async () => {
    const r = await window.api.autoSwitchNow(); if (r.status) renderStatus(r.status); await refreshLogs();
    setBanner(r.ok ? `Автоподбор применил: ${r.profile}` : (r.reason === 'admin-required' ? 'Автоподбор остановлен: нужны права администратора' : `Автоподбор: ${r.reason || 'не выполнено'}`), r.ok ? 'ok' : 'warn');
  });

  $('btnStartTg').onclick = () => withBusy($('btnStartTg'), 'Запуск…', async () => { await saveAndRefresh(); const r = await window.api.startTg(); if (r.status) renderStatus(r.status); await refreshLogs(); setBanner(r.ok ? 'TgWsProxy запущен' : 'Не удалось запустить TgWsProxy', r.ok ? 'ok' : 'error'); });
  $('btnStopTg').onclick = () => withBusy($('btnStopTg'), 'Остановка…', async () => { const r = await window.api.stopTg(); if (r.status) renderStatus(r.status); await refreshLogs(); setBanner('TgWsProxy остановлен', 'ok'); });
  $('btnSaveTg').onclick = () => withBusy($('btnSaveTg'), 'Сохранение…', async () => { await saveAndRefresh(); setBanner('Настройки Telegram сохранены', 'ok'); });
  $('btnSaveMon').onclick = () => withBusy($('btnSaveMon'), 'Сохранение…', async () => { await saveAndRefresh(); setBanner('Настройки мониторинга сохранены', 'ok'); });
  $('btnReloadLogs').onclick = () => refreshLogs();

  ['monInterval','monTimeout','monFail','monCooldown','chkAutoSwitch','chkAutoSelect','chkTgAuto','tgHost','tgPort','tgSecret'].forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', scheduleSettingsSave);
  });

  window.api.on('check', (check) => { renderCheck(check); refresh(); });
  window.api.on('status', (data) => { if (data && data.message) setBanner(data.message, 'info'); refresh(); });

  refresh(); refreshLogs();
  setInterval(refresh, 12000);
  setInterval(refreshLogs, 10000);
});