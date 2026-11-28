const $ = (id) => document.getElementById(id);

let currentStatus = null;
let pendingSettingsTimer = null;
let diagFilter = 'all';
let lastBannerKind = 'info';
let pendingClickMeta = null;
let runActive = false;
let unsubscribeRunProgress = null;

function sendClickTelemetry() {
  if (!pendingClickMeta || !window.api || !window.api.trackUi) return;
  const meta = pendingClickMeta;
  pendingClickMeta = null;
  try { window.api.trackUi({ ...meta, action: 'click', bannerKind: lastBannerKind }); } catch {}
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(s) {
  return String(s == null ? '' : s).replace(/([?&](?:secret|token|password|authorization|cookie)=)[^&]*/gi, '$1[REDACTED]');
}
function setBanner(msg, kind = 'info') {
  const b = $('banner');
  b.textContent = msg;
  const bannerKind = kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'info';
  b.className = `banner ${bannerKind}`;
  lastBannerKind = bannerKind;
  sendClickTelemetry();
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
    telemetryEnabled: $('chkTelemetry') ? $('chkTelemetry').checked : true,
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

function diagType(kind) {
  const k = String(kind || 'event');
  if (k.startsWith('check')) return 'target';
  if (k.startsWith('profile_')) return 'profile';
  return 'event';
}

function diagDetail(row) {
  const parts = [];
  if (row.status != null) parts.push(`HTTP ${row.status}`);
  if (row.ms != null) parts.push(`${row.ms} мс`);
  if (row.errorCode) parts.push(row.errorCode);
  if (row.error) parts.push(row.error);
  if (row.bytes != null) parts.push(`${row.bytes} B`);
  if (row.url) parts.push(safeUrl(row.url));
  if (row.reason) parts.push(`причина: ${row.reason}`);
  if (row.decision) parts.push(row.decision);
  if (row.from || row.to) parts.push(`${row.from || '—'} → ${row.to || '—'}`);
  if (row.okCount != null && row.total != null) parts.push(`${row.okCount}/${row.total}`);
  if (row.overallOk != null) parts.push(row.overallOk ? 'стабильно' : 'деградация');
  if (row.applyMs != null) parts.push(`apply ${row.applyMs} мс`);
  if (row.probeMs != null) parts.push(`probe ${row.probeMs} мс`);
  if (row.postCheckCount) parts.push(`после: ${row.postCheckCount}`);
  if (row.candidates) {
    const names = Array.isArray(row.candidates)
      ? row.candidates.map(c => typeof c === 'string' ? c : `${c.name || '?'} (${c.score != null ? c.score : '—'})`).join(', ')
      : String(row.candidates);
    parts.push(`кандидаты: ${names}`.slice(0, 180));
  }
  if (row.applyResult && (row.applyResult.code || row.applyResult.message)) {
    parts.push(`apply: ${row.applyResult.code || ''} ${row.applyResult.message || ''}`.trim());
  }
  const known = ['ts','kind','target','profile','mode','admin','voiceActive','status','ms','errorCode','error','bytes','url','reason','decision','from','to','okCount','total','overallOk','applyMs','probeMs','postCheckCount','candidates','applyResult','ok','detail'];
  const extra = Object.entries(row).filter(([key]) => !known.includes(key));
  if (extra.length) parts.push(extra.slice(0, 4).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' '));
  return parts.join(' · ').slice(0, 500);
}

function diagResult(row) {
  if (row.kind === 'profile_decision') {
    const classes = {
      applied: 'ok', 'deferred-voice': 'warn', 'skipped-manual-lock': 'warn',
      'skipped-cooldown': 'warn', 'skipped-disabled': 'warn', 'skipped-event': 'warn',
      'admin-required': 'bad', 'no-candidates': 'bad', 'no-candidate-passed': 'bad', 'rolled-back': 'bad',
    };
    const cls = classes[row.decision] || 'warn';
    return `<span class="badge ${cls}">${esc(row.decision || '—')}</span>`;
  }
  if (row.ok === true || row.overallOk === true) return '<span class="badge ok">OK</span>';
  if (row.ok === false || row.overallOk === false) return '<span class="badge bad">FAIL</span>';
  return `<span class="badge warn">${esc(row.kind || 'событие')}</span>`;
}

function renderDiagnostics(s) {
  const body = $('diagRows');
  if (!body) return;
  let rows = Array.isArray(s.diagnostics) ? s.diagnostics.slice() : [];
  if (!rows.length) {
    const last = s.monitor && s.monitor.lastCheck;
    if (last) {
      rows = (last.results || []).map(r => ({
        ts: last.ts, kind: 'check', target: r.name, url: r.url, ok: r.ok,
        status: r.status, ms: r.ms, error: r.error, errorCode: r.errorCode,
        bytes: r.bytes, reason: last.reason,
      }));
      rows.push({ ts: last.ts, kind: 'check_summary', ok: last.overallOk, overallOk: last.overallOk, okCount: last.okCount, total: last.total, reason: last.reason });
    }
  }
  rows = rows.filter(r => diagFilter === 'all' || diagType(r.kind) === diagFilter);
  rows.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  rows = rows.slice(0, 300);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="diag-empty">Нет данных для выбранного фильтра</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const name = r.target || r.profile || r.to || r.from || r.kind || '—';
    const detail = diagDetail(r);
    return `<tr>
      <td class="diag-time">${esc(r.ts ? new Date(r.ts).toLocaleTimeString() : '—')}</td>
      <td>${esc(r.kind || '—')}</td>
      <td title="${esc(name)}">${esc(name)}</td>
      <td>${diagResult(r)}</td>
      <td class="diag-detail" title="${esc(detail)}">${esc(detail)}</td>
    </tr>`;
  }).join('');
}

function renderMatrixCell(cell) {
  if (!cell) return '<span class="matrix-untested">—</span>';
  const cls = cell.ok ? 'matrix-ok' : 'matrix-fail';
  const label = cell.status != null ? `HTTP ${cell.status}` : (cell.errorCode || 'ошибка');
  const detail = [
    label,
    cell.ms != null ? `${cell.ms} мс` : null,
    cell.okCount != null && cell.failCount != null && cell.okCount + cell.failCount > 1
      ? `${cell.okCount}/${cell.okCount + cell.failCount}` : null,
    cell.error ? String(cell.error).slice(0, 120) : null,
  ].filter(Boolean).join(' · ');
  return `<span class="${cls}" title="${esc(detail)}">${esc(label)}</span>`;
}

function renderMatrix(s) {
  const body = $('matrixBody');
  const head = $('matrixHead');
  if (!body || !head) return;
  const matrix = s && s.profileMatrix;
  const targets = (matrix && matrix.targets) || [];
  const profiles = (matrix && matrix.profiles) || [];
  head.innerHTML = '<th>Профиль</th>' + targets.map(t => `<th title="${esc(t)}">${esc(t)}</th>`).join('');
  if (!profiles.length) {
    body.innerHTML = `<tr><td class="diag-empty" colspan="${targets.length + 1}">Нет данных</td></tr>`;
  } else {
    const active = s.settings && s.settings.activeProfile;
    const invalid = new Set(Array.isArray(s.invalidProfiles) ? s.invalidProfiles : []);
    body.innerHTML = profiles.map(p => {
      const mark = p.name === active ? ' ★' : '';
      const bad = invalid.has(p.name);
      const invalidMark = bad ? ' <span class="matrix-invalid" title="Ошибка запуска: профиль исключён из авто-подбора">⚠ невалиден</span>' : '';
      const cells = targets.map(t => `<td>${renderMatrixCell(p.cells && p.cells[t])}</td>`).join('');
      return `<tr${bad ? ' class="matrix-row-invalid"' : ''}><td class="matrix-profile">${esc(p.name || '—')}${mark}${invalidMark}</td>${cells}</tr>`;
    }).join('');
  }
  const tested = $('matrixTested'); if (tested) tested.textContent = matrix ? matrix.testedCount : 0;
  const total = $('matrixTotal'); if (total) total.textContent = profiles.length;
}

function setRunProgress(data) {
  const el = $('runProgress');
  const runBtn = $('btnRunAll');
  const cancelBtn = $('btnCancelRunAll');
  if (!data) {
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
    runActive = false;
    if (runBtn) runBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;
    return;
  }
  runActive = true;
  if (runBtn) runBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = false;
  if (!el) return;
  const step = (data.index != null && data.total != null) ? `${data.index + 1}/${data.total}` : '';
  const result = data.result || {};
  const outcome = data.result ? (result.decision === 'applied' ? `OK ${result.okCount}/${result.total}` : result.decision) : 'старт';
  el.classList.remove('hidden');
  el.textContent = `Прогон ${data.runId || ''} · ${step} · ${data.profile || '—'} · ${outcome}`;
}

function renderCheck(check) {
  const meta = $('lastCheckMeta');
  if (!meta) return;
  if (!check) {
    meta.textContent = 'Проверка ещё не выполнялась';
    return;
  }
  meta.textContent = `${new Date(check.ts).toLocaleString()} · ${check.okCount}/${check.total} OK · ${check.overallOk ? 'стабильно' : 'деградация'} · ${esc(check.reason || '')}`;
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

  const voice = s.voice || {};
  setDot('dotVoice', voice.active ? 'warn' : 'ok');
  $('sideVoice').textContent = voice.active
    ? `Активен (${voice.endpointCount || 0} UDP)`
    : 'Нет';
  $('voiceBanner').classList.toggle('hidden', !voice.active);

  const invalidProfiles = Array.isArray(s.invalidProfiles) ? s.invalidProfiles : [];
  const blockedBanner = $('blockedBanner');
  if (blockedBanner) {
    blockedBanner.classList.toggle('hidden', invalidProfiles.length === 0);
    blockedBanner.textContent = invalidProfiles.length
      ? `Профили с ошибкой запуска исключены из авто-подбора: ${invalidProfiles.join(', ')}. Их можно применить вручную.`
      : '';
  }

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
  $('sideTg').textContent = tgOk ? 'Доступен' : (tg.running ? 'Запущен, нет TCP' : 'Остановлен');

  const mon = s.monitor || {};
  setDot('dotMon', mon.running ? 'ok' : 'warn');
    $('sideMon').textContent = (s.monitor && s.monitor.running) ? 'Активен' : 'Остановлен';
  const lock = !!(s.settings && s.settings.manualProfileLock);
  const lockBtn = $('btnManualLock'); if (lockBtn) { lockBtn.textContent = lock ? 'Ручной lock: ВКЛ' : 'Ручной lock: ВЫКЛ'; lockBtn.classList.toggle('warn', lock); }
  const lockInfo = $('manualLockInfo'); if (lockInfo) lockInfo.textContent = lock ? `Зафиксирован: ${s.settings.manualProfile || s.settings.activeProfile || '—'}. Автопереключение по деградации пропускается.` : 'Автопереключение разрешено (если включено в настройках).';
  renderDiagnostics(s);
  renderMatrix(s);

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
  const telemetryBox = $('chkTelemetry'); if (telemetryBox) telemetryBox.checked = s.telemetry?.enabled !== false;
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

  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, .seg') : null;
    if (!el || !window.api || !window.api.trackUi) return;
    pendingClickMeta = { id: el.id || el.dataset.mode || el.className, action: 'click' };
    setTimeout(sendClickTelemetry, 2000);
  }, true);

  document.querySelectorAll('#diagFilter [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      diagFilter = btn.dataset.filter;
      document.querySelectorAll('#diagFilter [data-filter]').forEach(b => b.classList.toggle('active', b === btn));
      if (currentStatus) renderDiagnostics(currentStatus);
    });
  });
  const btnDiagRows = $('btnDiagRefresh');
  if (btnDiagRows) btnDiagRows.onclick = () => withBusy(btnDiagRows, 'Обновление…', async () => {
    const d = await window.api.getDiagnostics(300);
    if (currentStatus) {
      currentStatus.diagnostics = d.diagnostics || [];
      renderDiagnostics(currentStatus);
    }
    setBanner('Таблица диагностики обновлена', 'ok');
  });

  const btnRunAll = $('btnRunAll');
  if (btnRunAll) btnRunAll.onclick = () => withBusy(btnRunAll, 'Проверка…', async () => {
    if (runActive) { setBanner('Прогон уже идёт', 'warn'); return; }
    setRunProgress({ index: 0, total: 0, profile: 'запуск' });
    try {
      const r = await window.api.runAllProfiles();
      if (!r || r.ok === false) {
        setBanner(r && r.reason === 'voice-active' ? 'Прогон отложен: активен голос Discord' : `Прогон не запущен: ${(r && r.reason) || 'неизвестно'}`, 'warn');
      } else if (r.aborted) {
        setBanner(`Прогон прерван: ${r.reason}`, 'warn');
      } else {
        setBanner(r.winner ? `Лучший профиль применён: ${r.winner}` : 'Прогон завершён, победитель не найден', r.winner ? 'ok' : 'warn');
      }
      await refresh(); await refreshLogs();
    } finally { setRunProgress(null); }
  });
  const btnCancelRunAll = $('btnCancelRunAll');
  if (btnCancelRunAll) btnCancelRunAll.onclick = () => withBusy(btnCancelRunAll, 'Отмена…', async () => {
    const r = await window.api.cancelRunAllProfiles();
    setBanner(r && r.ok ? 'Отмена отправлена' : 'Активного прогона нет', r && r.ok ? 'warn' : 'info');
  });
  const btnMatrixRefresh = $('btnMatrixRefresh');
  if (btnMatrixRefresh) btnMatrixRefresh.onclick = () => withBusy(btnMatrixRefresh, 'Обновление…', async () => {
    const m = await window.api.getProfileMatrix(300);
    if (currentStatus && m) { currentStatus.profileMatrix = m; renderMatrix(currentStatus); }
    setBanner('Матрица профилей обновлена', 'ok');
  });
  if (window.api.onRunProgress) unsubscribeRunProgress = window.api.onRunProgress((data) => {
    setRunProgress(data);
    if (data && data.result && currentStatus) refresh();
  });
  window.addEventListener('beforeunload', () => {
    if (unsubscribeRunProgress) { try { unsubscribeRunProgress(); } catch {} }
    unsubscribeRunProgress = null;
  });

  $('btnRefresh').onclick = () => withBusy($('btnRefresh'), 'Обновление…', async () => { await refresh(); await refreshLogs(); setBanner('Статус обновлён', 'ok'); });
  const btnDiag = $('btnExportDiag'); if (btnDiag) btnDiag.onclick = () => withBusy(btnDiag, 'Экспорт...', async () => { const r = await window.api.exportDiagnostics(); if (r && r.ok) setBanner('Диагностика сохранена: ' + r.path, 'ok'); else if (r && !r.canceled) setBanner('Не удалось экспортировать диагностику', 'error'); });
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

  ['monInterval','monTimeout','monFail','monCooldown','chkAutoSwitch','chkAutoSelect','chkTgAuto','chkTelemetry','tgHost','tgPort','tgSecret'].forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', scheduleSettingsSave);
  });

  window.api.on('check', (check) => { renderCheck(check); refresh(); });
  window.api.on('status', (data) => {
    if (data && data.message) {
      const blocked = /провал|заблокир/i.test(data.message);
      const deferred = !blocked && /discord|голос/i.test(data.message);
      setBanner(data.message, blocked ? 'error' : deferred ? 'warn' : 'info');
    }
    refresh();
  });

  refresh(); refreshLogs();
  setInterval(refresh, 12000);
  setInterval(refreshLogs, 10000);
});
