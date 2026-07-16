// Joanna's Health Journal — app logic
// Talks to a Google Apps Script "web app" URL (stored in Settings) which
// reads/writes a shared Google Sheet. Both phones point at the same URL,
// so both stay in sync. Entries are also cached in localStorage so the
// app has something to show offline.

(function () {
  'use strict';

  var STORAGE_KEYS = {
    settings: 'hj_settings',
    entries: 'hj_entries_cache',
    meds: 'hj_meds_catalog'
  };

  var DEFAULT_MEDS = ['Naltrexone (LDN) 0.5ml', 'Vitamin C'];

  var state = {
    settings: { scriptUrl: '' },
    entries: [],
    medsCatalog: [],
    currentView: 'log',
    trendRangeDays: 7,
    charts: {}
  };

  // ---------- utilities ----------

  function $(id) { return document.getElementById(id); }
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  // ---------- settings ----------

  function loadSettings() {
    state.settings = loadJSON(STORAGE_KEYS.settings, { scriptUrl: '' });
    $('scriptUrl').value = state.settings.scriptUrl || '';
  }
  function saveSettings() {
    saveJSON(STORAGE_KEYS.settings, state.settings);
  }

  // ---------- meds catalog ----------

  function loadMeds() {
    state.medsCatalog = loadJSON(STORAGE_KEYS.meds, DEFAULT_MEDS.slice());
    renderMedsList();
  }
  function saveMeds() {
    saveJSON(STORAGE_KEYS.meds, state.medsCatalog);
  }
  function renderMedsList() {
    var wrap = $('medsList');
    wrap.innerHTML = '';
    state.medsCatalog.forEach(function (name, idx) {
      var row = document.createElement('div');
      row.className = 'med-item';
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.medIndex = idx;
      cb.className = 'med-checkbox';
      var span = document.createElement('span');
      span.textContent = name;
      label.appendChild(cb);
      label.appendChild(span);
      row.appendChild(label);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'med-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () {
        state.medsCatalog.splice(idx, 1);
        saveMeds();
        renderMedsList();
      });
      row.appendChild(removeBtn);
      wrap.appendChild(row);
    });
  }

  // ---------- chips (tag selectors) ----------

  function initChipGroups() {
    document.querySelectorAll('.chip-row').forEach(function (group) {
      if (group.classList.contains('range-row')) return;
      var single = group.dataset.single === 'true';
      group.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          if (single) {
            group.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('selected'); });
            chip.classList.add('selected');
          } else {
            chip.classList.toggle('selected');
          }
        });
      });
    });
  }
  function getSelectedChips(groupId) {
    return Array.prototype.map.call(
      document.querySelectorAll('#' + groupId + ' .chip.selected'),
      function (c) { return c.dataset.value; }
    );
  }
  function getSelectedChipSingle(groupId) {
    var chips = getSelectedChips(groupId);
    return chips.length ? chips[0] : '';
  }
  function setChipsSelected(groupId, values) {
    var set = {};
    (values || []).forEach(function (v) { set[v] = true; });
    document.querySelectorAll('#' + groupId + ' .chip').forEach(function (c) {
      c.classList.toggle('selected', !!set[c.dataset.value]);
    });
  }
  function clearChips(groupId) {
    document.querySelectorAll('#' + groupId + ' .chip').forEach(function (c) {
      c.classList.remove('selected');
    });
  }

  // ---------- sliders ----------

  function initSliders() {
    document.querySelectorAll('input.slider').forEach(function (slider) {
      var out = $('val-' + slider.id);
      if (out) out.textContent = slider.value;
      slider.addEventListener('input', function () {
        if (out) out.textContent = slider.value;
      });
    });
  }

  // ---------- form ----------

  function resetForm() {
    $('entryDate').value = todayStr();
    ['sleep_quality', 'energy_level'].forEach(function (id) {
      $(id).value = 5;
      $('val-' + id).textContent = '5';
    });
    ['foot_pain_left', 'foot_pain_right', 'inflammation_severity', 'bloating_puffiness'].forEach(function (id) {
      $(id).value = 0;
      $('val-' + id).textContent = '0';
    });
    ['night_sweats', 'digestion_complete', 'foot_swelling', 'brain_fog', 'chemical_sensitivity', 'period'].forEach(function (id) {
      $(id).checked = id === 'digestion_complete';
    });
    ['sleep_notes', 'digestion_notes', 'foot_notes', 'energy_notes', 'inflammation_notes', 'other_symptoms', 'daily_notes'].forEach(function (id) {
      $(id).value = '';
    });
    clearChips('chips-digestion_consistency');
    clearChips('chips-foot_support');
    clearChips('chips-inflammation_locations');
    document.querySelectorAll('.med-checkbox').forEach(function (cb) { cb.checked = false; });
  }

  function collectFormData() {
    var meds = [];
    document.querySelectorAll('.med-checkbox').forEach(function (cb) {
      meds.push({ name: state.medsCatalog[cb.dataset.medIndex], taken: cb.checked });
    });

    return {
      timestamp: new Date().toISOString(),
      date: $('entryDate').value,
      sleep_quality: Number($('sleep_quality').value),
      night_sweats: $('night_sweats').checked,
      sleep_notes: $('sleep_notes').value.trim(),
      digestion_consistency: getSelectedChipSingle('chips-digestion_consistency'),
      digestion_complete: $('digestion_complete').checked,
      digestion_notes: $('digestion_notes').value.trim(),
      foot_pain_left: Number($('foot_pain_left').value),
      foot_pain_right: Number($('foot_pain_right').value),
      foot_support: getSelectedChips('chips-foot_support'),
      foot_swelling: $('foot_swelling').checked,
      foot_notes: $('foot_notes').value.trim(),
      energy_level: Number($('energy_level').value),
      brain_fog: $('brain_fog').checked,
      energy_notes: $('energy_notes').value.trim(),
      inflammation_severity: Number($('inflammation_severity').value),
      inflammation_locations: getSelectedChips('chips-inflammation_locations'),
      inflammation_notes: $('inflammation_notes').value.trim(),
      chemical_sensitivity: $('chemical_sensitivity').checked,
      bloating_puffiness: Number($('bloating_puffiness').value),
      period: $('period').checked,
      other_symptoms: $('other_symptoms').value.trim(),
      meds: meds,
      daily_notes: $('daily_notes').value.trim()
    };
  }

  // ---------- API ----------

  function apiUrl() {
    return (state.settings.scriptUrl || '').trim();
  }

  function fetchEntries() {
    var url = apiUrl();
    if (!url) return Promise.resolve(state.entries);

    setSyncing(true);
    return fetch(url, { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && Array.isArray(data.entries)) {
          state.entries = data.entries;
          saveJSON(STORAGE_KEYS.entries, state.entries);
        }
        return state.entries;
      })
      .catch(function (err) {
        console.error('fetchEntries failed', err);
        toast('Could not sync — showing cached data');
        return state.entries;
      })
      .finally(function () { setSyncing(false); });
  }

  function submitEntry(entry) {
    var url = apiUrl();
    if (!url) {
      toast('Add your sync URL in Settings first');
      return Promise.reject(new Error('no url'));
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify(entry)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || 'save failed');
        state.entries.push(entry);
        saveJSON(STORAGE_KEYS.entries, state.entries);
        return true;
      });
  }

  function setSyncing(on) {
    $('syncBtn').classList.toggle('spinning', !!on);
  }

  // ---------- history ----------

  function digestionComfortScore(consistency) {
    var map = { constipated: 2, watery: 2, loose: 4, soft: 6, normal: 9 };
    return map.hasOwnProperty(consistency) ? map[consistency] : null;
  }

  function renderHistory() {
    var list = $('historyList');
    var empty = $('historyEmpty');
    var entries = state.entries.slice().sort(function (a, b) {
      return (a.date < b.date) ? 1 : -1;
    });

    list.innerHTML = '';
    empty.classList.toggle('hidden', entries.length > 0);

    entries.forEach(function (e) {
      var card = document.createElement('div');
      card.className = 'day-card';

      var header = document.createElement('div');
      header.className = 'day-card-header';
      header.innerHTML =
        '<div class="day-card-date">' + fmtDate(e.date) + '</div>' +
        '<div class="day-card-summary">Sleep ' + safe(e.sleep_quality) + ' · Energy ' + safe(e.energy_level) + '</div>';
      card.appendChild(header);

      var badges = document.createElement('div');
      badges.className = 'badge-row';
      addBadge(badges, 'Feet L/R ' + safe(e.foot_pain_left) + '/' + safe(e.foot_pain_right), Number(e.foot_pain_left) >= 6 || Number(e.foot_pain_right) >= 6);
      addBadge(badges, 'Inflammation ' + safe(e.inflammation_severity), Number(e.inflammation_severity) >= 6);
      if (e.digestion_consistency) addBadge(badges, 'Digestion: ' + e.digestion_consistency, false);
      if (e.period === true || e.period === 'TRUE') addBadge(badges, 'Period', false);
      if (e.brain_fog === true || e.brain_fog === 'TRUE') addBadge(badges, 'Brain fog', false);
      card.appendChild(badges);

      var notes = document.createElement('div');
      notes.className = 'day-notes';
      notes.innerHTML = buildNotesHtml(e);
      card.appendChild(notes);

      card.addEventListener('click', function () {
        card.classList.toggle('expanded');
      });

      list.appendChild(card);
    });
  }

  function safe(v) { return (v === undefined || v === null || v === '') ? '–' : v; }

  function addBadge(container, text, warn) {
    var b = document.createElement('span');
    b.className = 'badge' + (warn ? ' warn' : '');
    b.textContent = text;
    container.appendChild(b);
  }

  function parseMaybeJSON(v) {
    if (Array.isArray(v) || (v && typeof v === 'object')) return v;
    if (typeof v === 'string' && v.trim().startsWith('[') || (typeof v === 'string' && v.trim().startsWith('{'))) {
      try { return JSON.parse(v); } catch (e) { return v; }
    }
    return v;
  }

  function buildNotesHtml(e) {
    var parts = [];
    if (e.sleep_notes) parts.push('<b>Sleep:</b> ' + escapeHtml(e.sleep_notes));
    if (e.digestion_notes) parts.push('<b>Digestion:</b> ' + escapeHtml(e.digestion_notes));
    if (e.foot_notes) parts.push('<b>Feet:</b> ' + escapeHtml(e.foot_notes));
    if (e.energy_notes) parts.push('<b>Energy:</b> ' + escapeHtml(e.energy_notes));
    if (e.inflammation_notes) parts.push('<b>Inflammation:</b> ' + escapeHtml(e.inflammation_notes));
    if (e.other_symptoms) parts.push('<b>Other:</b> ' + escapeHtml(e.other_symptoms));
    var meds = parseMaybeJSON(e.meds);
    if (Array.isArray(meds) && meds.length) {
      var takenNames = meds.filter(function (m) { return m && (m.taken === true || m.taken === 'true'); }).map(function (m) { return m.name; });
      if (takenNames.length) parts.push('<b>Meds taken:</b> ' + escapeHtml(takenNames.join(', ')));
    }
    if (e.daily_notes) parts.push('<b>Notes:</b> ' + escapeHtml(e.daily_notes));
    var support = parseMaybeJSON(e.foot_support);
    if (Array.isArray(support) && support.length) parts.push('<b>Foot support:</b> ' + escapeHtml(support.join(', ')));
    var locs = parseMaybeJSON(e.inflammation_locations);
    if (Array.isArray(locs) && locs.length) parts.push('<b>Inflammation sites:</b> ' + escapeHtml(locs.join(', ')));
    return parts.join('<br>') || '<i>No additional notes</i>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- trends ----------

  function filteredEntriesForRange(days) {
    var entries = state.entries.slice().sort(function (a, b) { return (a.date > b.date) ? 1 : -1; });
    if (!days) return entries;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffStr = cutoff.toISOString().slice(0, 10);
    return entries.filter(function (e) { return e.date >= cutoffStr; });
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  function lineChart(canvasId, key, labels, datasets) {
    destroyChart(key);
    var ctx = $(canvasId).getContext('2d');
    state.charts[key] = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } }
        },
        elements: { point: { radius: 3 }, line: { tension: 0.3 } }
      }
    });
    $(canvasId).parentElement.style.height = '200px';
  }

  function renderCharts() {
    var entries = filteredEntriesForRange(state.trendRangeDays);
    var labels = entries.map(function (e) { return fmtDate(e.date); });

    lineChart('chart-sleep', 'sleep', labels, [{
      label: 'Sleep quality', data: entries.map(function (e) { return numOrNull(e.sleep_quality); }),
      borderColor: '#4a9e9e', backgroundColor: '#4a9e9e33', fill: true
    }]);

    lineChart('chart-energy', 'energy', labels, [{
      label: 'Energy', data: entries.map(function (e) { return numOrNull(e.energy_level); }),
      borderColor: '#8b7abf', backgroundColor: '#8b7abf33', fill: true
    }]);

    lineChart('chart-feet', 'feet', labels, [
      { label: 'Left', data: entries.map(function (e) { return numOrNull(e.foot_pain_left); }), borderColor: '#d97757', backgroundColor: 'transparent' },
      { label: 'Right', data: entries.map(function (e) { return numOrNull(e.foot_pain_right); }), borderColor: '#c74e3b', backgroundColor: 'transparent' }
    ]);

    lineChart('chart-inflammation', 'inflammation', labels, [{
      label: 'Inflammation', data: entries.map(function (e) { return numOrNull(e.inflammation_severity); }),
      borderColor: '#d97757', backgroundColor: '#d9775733', fill: true
    }]);

    lineChart('chart-digestion', 'digestion', labels, [{
      label: 'Digestion comfort', data: entries.map(function (e) { return digestionComfortScore(e.digestion_consistency); }),
      borderColor: '#6aa66f', backgroundColor: '#6aa66f33', fill: true
    }]);

    lineChart('chart-bloating', 'bloating', labels, [{
      label: 'Bloating / puffiness', data: entries.map(function (e) { return numOrNull(e.bloating_puffiness); }),
      borderColor: '#c9a13b', backgroundColor: '#c9a13b33', fill: true
    }]);
  }

  function numOrNull(v) {
    if (v === '' || v === undefined || v === null) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // ---------- tabs ----------

  function switchView(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
    $('view-' + view).classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === view);
    });
    var titles = { log: 'Today', history: 'History', trends: 'Trends', settings: 'Settings' };
    $('topbarTitle').textContent = titles[view] || 'Health Journal';

    if (view === 'history') { renderHistory(); }
    if (view === 'trends') { renderCharts(); }
  }

  // ---------- init ----------

  function wireEvents() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });

    $('syncBtn').addEventListener('click', function () {
      fetchEntries().then(function () {
        if (state.currentView === 'history') renderHistory();
        if (state.currentView === 'trends') renderCharts();
        toast('Synced');
      });
    });

    $('addMedBtn').addEventListener('click', function () {
      var input = $('newMedName');
      var name = input.value.trim();
      if (!name) return;
      state.medsCatalog.push(name);
      saveMeds();
      renderMedsList();
      input.value = '';
    });

    $('logForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var entry = collectFormData();
      $('saveBtn').disabled = true;
      $('saveStatus').textContent = 'Saving…';
      submitEntry(entry)
        .then(function () {
          $('saveStatus').textContent = 'Saved ✓';
          toast('Entry saved');
          resetForm();
        })
        .catch(function (err) {
          console.error(err);
          $('saveStatus').textContent = 'Could not save — check Settings sync URL';
        })
        .finally(function () {
          $('saveBtn').disabled = false;
          setTimeout(function () { $('saveStatus').textContent = ''; }, 3000);
        });
    });

    $('saveUrlBtn').addEventListener('click', function () {
      var url = $('scriptUrl').value.trim();
      state.settings.scriptUrl = url;
      saveSettings();
      $('urlStatus').textContent = 'Testing connection…';
      fetchEntries().then(function (entries) {
        $('urlStatus').textContent = 'Connected — ' + entries.length + ' entries found';
        toast('Sync URL saved');
      });
    });

    document.querySelectorAll('.range-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.range-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        state.trendRangeDays = Number(chip.dataset.days);
        renderCharts();
      });
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('SW registration failed', e);
      });
    }
  }

  function init() {
    state.entries = loadJSON(STORAGE_KEYS.entries, []);
    loadSettings();
    loadMeds();
    initSliders();
    initChipGroups();
    resetForm();
    wireEvents();
    registerServiceWorker();

    if (apiUrl()) {
      fetchEntries();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
