/* CNC 프로그램 도구 — UI 로직 (탭, 파일 입출력, 변환/생성/비교) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  /* ───── 탭 ───── */
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
      $('panel-' + btn.dataset.tab).classList.add('active');
      // 형상 비교 탭: 처음 열릴 때만 iframe 로드 (성능)
      if (btn.dataset.tab === 'shape') {
        const fr = $('shapeFrame');
        if (fr && !fr.src) fr.src = 'shape-checker.html';
      }
    });
  });

  /* QR 모달 */
  (function () {
    const modal = $('qrModal'), btn = $('qrBtn'), close = $('qrClose');
    if (!modal || !btn) return;
    const open = () => { modal.hidden = false; };
    const hide = () => { modal.hidden = true; };
    btn.addEventListener('click', open);
    close.addEventListener('click', hide);
    modal.addEventListener('click', e => { if (e.target === modal) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) hide(); });
  })();

  /* 히어로 기능 카드 → 해당 탭으로 이동 */
  document.querySelectorAll('.feat[data-goto]').forEach(card => {
    card.addEventListener('click', () => {
      const btn = document.querySelector('.tabs button[data-tab="' + card.dataset.goto + '"]');
      if (btn) btn.click();
      const tool = document.getElementById('tool');
      if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ───── 공용 유틸 ───── */
  function readFileText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsText(file);
    });
  }
  async function download(filename, text) {
    const payload = text.replace(/\n/g, '\r\n');
    // claude.ai 아티팩트 뷰어: downloads 능력으로 저장 (확장자 필수 → .txt 부여)
    if (typeof window !== 'undefined' && window.claude && window.claude.use) {
      try {
        const dl = await window.claude.use('downloads');
        if (dl) {
          const fname = /\.(txt|json|csv|md|html)$/i.test(filename) ? filename : filename + '.txt';
          try { await dl.save({ filename: fname, data: payload }); }
          catch (err) { /* 뷰어가 거절했거나 저장 불가 — 조용히 종료 */ }
          return;
        }
      } catch (e) { /* 능력 조회 실패 시 일반 다운로드로 폴백 */ }
    }
    const blob = new Blob([payload], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = old; }, 1200);
    });
  }
  // 텍스트영역에 파일 드래그앤드롭 붙이기 (첫 파일 내용을 채움)
  function enableTextareaDrop(textarea, onDrop) {
    if (!textarea) return;
    ['dragenter', 'dragover'].forEach(ev => textarea.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); textarea.classList.add('drag');
    }));
    ['dragleave', 'dragend'].forEach(ev => textarea.addEventListener(ev, e => {
      e.preventDefault(); textarea.classList.remove('drag');
    }));
    textarea.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); textarea.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (!f) return;
      const text = await readFileText(f);
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
      if (onDrop) onDrop(f, text);
    });
  }

  const MACRO_RE = /^(#\d|WHILE\[|IF\[|END\d|G0U-#|G1Z#|G0X#|G4U0\.5)/;
  function renderCode(el, text, opts) {
    opts = opts || {};
    el.textContent = '';
    const frag = document.createDocumentFragment();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const div = document.createElement('div');
      div.className = 'ln';
      if (opts.highlightMacro && MACRO_RE.test(lines[i].trim())) div.classList.add('hl');
      const no = document.createElement('span'); no.className = 'no'; no.textContent = String(i + 1);
      const tx = document.createElement('span'); tx.textContent = lines[i] || ' ';
      div.appendChild(no); div.appendChild(tx);
      frag.appendChild(div);
    }
    el.appendChild(frag);
    // 결과 카드 강조: 반짝임 + 좁은 화면에선 결과로 스크롤
    const card = el.closest('.result-card');
    if (card) {
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      if (window.matchMedia('(max-width:900px)').matches) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }
  function reportLine(el, cls, text) {
    const d = document.createElement('div'); d.className = 'item ' + cls;
    d.textContent = (cls === 'ok' ? '✓ ' : cls === 'warn' ? '⚠ ' : '✕ ') + text;
    el.appendChild(d);
  }

  /* ═════════ 탭 1: 매크로 변환 ═════════ */
  const subs = {};        // {이름: 텍스트} — 서브프로그램
  let mainFromFile = null; // 파일로 올린 메인 { name, text }
  let convResult = null;

  // 프로그램 종류 판별: 첫 O번호로 메인/서브 구분
  function classifyProgram(name, text) {
    const m = text.match(/O(\d+)/);
    const oNo = m ? m[1] : (name.match(/\d+/) || [''])[0];
    // O35xx = 메인, O01xx(0120~0123 등) = 서브, 그 외는 크기로 추정
    if (/^35/.test(oNo)) return { role: 'main', oNo };
    if (/^0?1[0-9]{2}$/.test(oNo)) return { role: 'sub', oNo, key: 'O' + oNo.replace(/^O/, '').padStart(4, '0') };
    // 짧으면(나사 블록) 서브, 길면 메인으로 추정
    return text.split('\n').length > 60 ? { role: 'main', oNo } : { role: 'sub', oNo, key: 'O' + oNo };
  }

  async function addConvFiles(fileList) {
    const rep = $('convReport'); rep.textContent = '';
    for (const f of fileList) {
      const text = await readFileText(f);
      const c = classifyProgram(f.name, text);
      if (c.role === 'main') {
        mainFromFile = { name: f.name, text };
        $('mainInput').value = text;
      } else {
        const key = f.name && /^O?\d/.test(f.name) ? (f.name.startsWith('O') ? f.name : 'O' + f.name.replace(/[^\d]/g, '')) : (c.key || f.name);
        subs[key] = text;
      }
    }
    renderConvFileList();
    renderSubList();
  }

  function renderConvFileList() {
    const el = $('convFileList'); el.textContent = '';
    const rows = [];
    if (mainFromFile) rows.push({ role: 'main', label: '메인', name: mainFromFile.name, text: mainFromFile.text, onDel: () => { mainFromFile = null; $('mainInput').value = ''; } });
    for (const key of Object.keys(subs)) rows.push({ role: 'sub', label: '서브', name: key, text: subs[key], onDel: () => { delete subs[key]; } });
    if (!rows.length) return;
    for (const r of rows) {
      const div = document.createElement('div'); div.className = 'filerow';
      const role = document.createElement('span'); role.className = 'role ' + r.role; role.textContent = r.label;
      const name = document.createElement('span'); name.className = 'fname'; name.textContent = r.name;
      const meta = document.createElement('span'); meta.className = 'fmeta'; meta.textContent = r.text.split('\n').length + '줄';
      const del = document.createElement('button'); del.textContent = '✕'; del.title = '제거';
      del.addEventListener('click', () => { r.onDel(); renderConvFileList(); renderSubList(); });
      div.appendChild(role); div.appendChild(name); div.appendChild(meta); div.appendChild(del);
      el.appendChild(div);
    }
  }
  function renderSubList() { renderConvFileList(); }

  // 드롭존 이벤트
  const dz = $('convDrop');
  dz.addEventListener('click', () => $('convFiles').click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('convFiles').click(); } });
  $('convFiles').addEventListener('change', e => { addConvFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return; dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) addConvFiles(e.dataTransfer.files); });

  // 붙여넣기로 메인을 직접 편집하면 파일 메인 대신 그 내용을 사용
  $('mainInput').addEventListener('input', () => {
    if (mainFromFile && $('mainInput').value !== mainFromFile.text) { mainFromFile = null; renderConvFileList(); }
  });

  $('btnConvert').addEventListener('click', () => {
    const main = mainFromFile ? mainFromFile.text : $('mainInput').value;
    const rep = $('convReport'); rep.textContent = '';
    if (!main.trim()) { reportLine(rep, 'err', '메인 프로그램 파일을 올리거나 붙여넣어 주세요.'); return; }
    const subCount = Object.keys(subs).length;
    if (subCount) reportLine(rep, 'ok', '파일 인식: 메인 1개 + 서브 ' + subCount + '개(' + Object.keys(subs).join(', ') + ')');
    convResult = NCConvert.convertProgram(main, subs, { addDwell: $('optDwell').checked });
    const r = convResult.report;
    reportLine(rep, 'ok', '나사 블록 ' + r.threadBlocks + '개를 WHILE 매크로로 변환했습니다.');
    if (r.turningLoops) reportLine(rep, 'ok', '선삭 ' + r.turningLoops + '개 구간에 칩브레이크 펙 루프를 넣었습니다.');
    if (r.subsUsed.length) reportLine(rep, 'ok', '서브 인라인 완료: ' + r.subsUsed.join(', '));
    r.warnings.forEach(w => reportLine(rep, 'warn', w));
    renderCode($('convOutput'), convResult.text, { highlightMacro: true });
    $('btnConvDownload').disabled = false;
    $('btnConvCopy').disabled = false;
  });
  $('btnConvDownload').addEventListener('click', () => {
    if (!convResult) return;
    const m = convResult.text.match(/^(O\d+)/m);
    download((m ? m[1] : 'CONVERTED') + '_MACRO', convResult.text);
  });
  $('btnConvCopy').addEventListener('click', e => convResult && copyText(convResult.text, e.target));

  /* ═════════ 탭 2: 기종 변환 ═════════ */
  let mcResult = null;
  $('btnMcFile').addEventListener('click', () => $('mcFile').click());
  $('mcFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('mcInput').value = await readFileText(f);
    $('mcFileName').textContent = f.name;
  });
  enableTextareaDrop($('mcInput'), f => { $('mcFileName').textContent = f.name; });
  let mcChoices = {};
  function runMachineConvert() {
    const rep = $('mcReport'); rep.textContent = '';
    const src = $('mcInput').value;
    if (!src.trim()) { reportLine(rep, 'err', '변환할 프로그램을 붙여넣거나 파일을 열어주세요.'); return; }
    const lenIn = parseFloat($('mcLen').value);
    const res = NCMachine.convertMachine(src, $('mcDir').value, {
      millMode: $('mcMillMode').value,
      millChoices: mcChoices,
      length: isFinite(lenIn) ? lenIn : null
    });
    mcResult = res;
    if (res.report.length) reportLine(rep, 'ok', '제품 길이 인식: ' + res.report.length + 'mm');
    res.report.changes.forEach(c => reportLine(rep, c.includes('⚠') ? 'warn' : 'ok', c));
    res.report.warnings.forEach(w => reportLine(rep, 'warn', w));
    renderCode($('mcOutput'), res.text, { highlightMacro: true });
    renderMillReview(res.report.millReview || []);
    $('btnMcDownload').disabled = false;
    $('btnMcCopy').disabled = false;
    $('btnMcToCompare').disabled = false;
  }
  $('btnMachine').addEventListener('click', () => { mcChoices = {}; runMachineConvert(); });

  /* 밀링 치환 검증 화면: 구간별 원본↔적용 비교 + 선택 버튼 */
  function renderMillReview(review) {
    const card = $('mcReviewCard');
    const box = $('mcReview'); box.textContent = '';
    if (!review.length) { card.hidden = true; return; }
    card.hidden = false;
    for (const m of review) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:12px';

      const head = document.createElement('div');
      head.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px';
      const title = document.createElement('b');
      title.textContent = m.title;
      title.style.cssText = 'font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--accent)';
      head.appendChild(title);
      const status = document.createElement('span');
      status.style.fontSize = '12px';
      if (m.swapEqualsLibrary === true) { status.textContent = '치환 결과 = 검증 블록 일치 ✓'; status.style.color = 'var(--ok)'; }
      else if (m.swapEqualsLibrary === false) { status.textContent = '⚠ 치환 결과가 검증 블록("' + m.libraryName + '")과 다름'; status.style.color = 'var(--warn)'; }
      else { status.textContent = '등록된 검증 블록 없음 — 좌표 직접 확인'; status.style.color = 'var(--ink-faint)'; }
      head.appendChild(status);
      wrapper.appendChild(head);

      // 선택 버튼
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px';
      const mkBtn = (label, value, exists) => {
        const b = document.createElement('button');
        b.className = m.chosen === value ? 'primary' : 'ghost';
        b.style.cssText = 'margin-top:0;padding:5px 12px;font-size:12.5px';
        b.textContent = label + (m.chosen === value ? ' ✓' : '');
        b.disabled = !exists;
        b.addEventListener('click', () => { mcChoices[m.index] = value; runMachineConvert(); });
        btns.appendChild(b);
      };
      mkBtn('치환 결과 사용', 'swap', true);
      mkBtn(m.libraryName ? '검증 블록 사용 (' + m.libraryName + ')' : '검증 블록 없음', 'library', !!m.library);
      mkBtn('원문 유지', 'orig', true);
      wrapper.appendChild(btns);

      // 원본 ↔ 적용 결과 나란히 비교 (다른 줄 강조)
      const applied = m.chosen === 'swap' ? m.swap : m.chosen === 'library' ? m.library : m.before;
      const grid = document.createElement('div');
      grid.className = 'pairgrid';
      const mkCol = (label, lines, other) => {
        const col = document.createElement('div');
        const cap = document.createElement('div');
        cap.textContent = label;
        cap.style.cssText = 'font-size:11.5px;color:var(--ink-faint);margin-bottom:4px;letter-spacing:.06em';
        col.appendChild(cap);
        const cv = document.createElement('div');
        cv.className = 'codeview';
        cv.style.cssText = 'max-height:300px;margin-top:0';
        const maxN = Math.max(lines.length, other.length);
        for (let i = 0; i < lines.length; i++) {
          const div = document.createElement('div');
          div.className = 'ln' + ((lines[i] || '').trim() !== (other[i] || '').trim() ? ' hl' : '');
          const no = document.createElement('span'); no.className = 'no'; no.textContent = String(i + 1);
          const tx = document.createElement('span'); tx.textContent = lines[i] || ' ';
          div.appendChild(no); div.appendChild(tx);
          cv.appendChild(div);
        }
        col.appendChild(cv);
        return col;
      };
      grid.appendChild(mkCol('원본', m.before, applied));
      grid.appendChild(mkCol('적용 결과 (' + (m.chosen === 'swap' ? '축·부호 치환' : m.chosen === 'library' ? '검증 블록' : '원문 유지') + ')', applied, m.before));
      wrapper.appendChild(grid);
      box.appendChild(wrapper);
    }
  }
  $('btnMcDownload').addEventListener('click', () => {
    if (!mcResult) return;
    const m = mcResult.text.match(/^(O\d+)/m);
    const tag = $('mcDir').value === 'R2J' ? '_J' : '_R';
    download((m ? m[1] : 'CONVERTED') + tag, mcResult.text);
  });
  $('btnMcCopy').addEventListener('click', e => mcResult && copyText(mcResult.text, e.target));
  $('btnMcToCompare').addEventListener('click', () => {
    if (!mcResult) return;
    $('cmpB').value = mcResult.text;
    $('cmpBName').textContent = '(기종 변환 결과)';
    document.querySelector('.tabs button[data-tab="compare"]').click();
  });

  /* ── 밀링 블록 관리 ── */
  function renderBlockList() {
    const el = $('blockList'); el.textContent = '';
    const user = NCMachine.loadUserBlocks();
    const rows = NCMachine.builtinBlocks.map(b => ({ b, builtin: true }))
      .concat(user.map((b, i) => ({ b, builtin: false, idx: i })));
    for (const row of rows) {
      const d = document.createElement('div'); d.className = 'subitem';
      const s1 = document.createElement('span'); s1.className = 'sname';
      s1.textContent = row.builtin ? '기본' : '사용자';
      const s2 = document.createElement('span'); s2.textContent = row.b.name;
      d.appendChild(s1); d.appendChild(s2);
      if (!row.builtin) {
        const del = document.createElement('button'); del.textContent = '✕'; del.title = '삭제';
        del.addEventListener('click', () => {
          const arr = NCMachine.loadUserBlocks(); arr.splice(row.idx, 1);
          NCMachine.saveUserBlocks(arr); renderBlockList();
        });
        d.appendChild(del);
      }
      el.appendChild(d);
    }
  }
  renderBlockList();

  $('btnAddBlock').addEventListener('click', () => {
    const name = $('nbName').value.trim();
    const R = $('nbR').value.trim();
    const J = $('nbJ').value.trim();
    if (!name || !R || !J) { alert('이름, R 블록, J 블록을 모두 입력해주세요.'); return; }
    if (!/\bM9\b/.test(R) || !/\bM9\b/.test(J)) { alert('블록은 M9까지 포함해서 붙여넣어주세요.'); return; }
    const arr = NCMachine.loadUserBlocks();
    arr.push({ name, R, J });
    if (!NCMachine.saveUserBlocks(arr)) { alert('브라우저 저장에 실패했습니다.'); return; }
    $('nbName').value = ''; $('nbR').value = ''; $('nbJ').value = '';
    renderBlockList();
  });

  $('btnExportBlocks').addEventListener('click', () => {
    const arr = NCMachine.loadUserBlocks();
    download('밀링블록.json', JSON.stringify(arr, null, 1));
  });
  $('btnImportBlocks').addEventListener('click', () => $('importBlocksFile').click());
  $('importBlocksFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const arr = JSON.parse(await readFileText(f));
      if (!Array.isArray(arr)) throw new Error('형식 오류');
      const cur = NCMachine.loadUserBlocks();
      for (const b of arr) if (b && b.name && b.R && b.J) cur.push(b);
      NCMachine.saveUserBlocks(cur); renderBlockList();
    } catch (err) { alert('JSON을 읽지 못했습니다: ' + err.message); }
    e.target.value = '';
  });

  /* ═════════ 탭 3: 프로그램 생성 ═════════ */
  let genResult = null;
  let lastWUserEdited = false;

  // 기본 마지막 W 계산: 나사 Z = -2, 2, 8, ... / W = L-6-zLast, [3,8] 범위
  function defaultLastW(L) {
    let z = 2;
    if (L - 6 - z < 3) return { w: null, z: -2, note: '이 길이는 나사 1회(TH1)로 끝 — 마지막 세그먼트 없음' };
    while (L - 6 - z > 8) z += 6;
    const w = +(L - 6 - z).toFixed(2);
    return { w, z, note: '기본값 = L − 6 − 마지막나사Z(' + z + ') = ' + w };
  }
  function refreshGenDefaults() {
    const L = parseFloat($('genLen').value);
    if (!isFinite(L)) return;
    $('genONo').placeholder = 'O' + (L >= 100 ? 3510 : 3500 + Math.round(L));
    const d = defaultLastW(L);
    if (!lastWUserEdited) $('genLastW').value = d.w === null ? '' : d.w;
    $('genLastWHint').textContent = d.note + ' (직접 수정 가능)';
  }
  $('genLen').addEventListener('input', () => { lastWUserEdited = false; refreshGenDefaults(); });
  $('genLastW').addEventListener('input', () => { lastWUserEdited = true; });
  refreshGenDefaults();

  $('btnGenerate').addEventListener('click', () => {
    const rep = $('genReport'); rep.textContent = '';
    if (typeof NCGen === 'undefined' || !NCGen.generate) {
      reportLine(rep, 'err', '생성 엔진(js/generator.js)이 아직 없습니다. 페이지를 새로고침하거나 파일을 확인해주세요.');
      return;
    }
    const L = parseFloat($('genLen').value);
    if (!isFinite(L) || L < 10 || L > 100) { reportLine(rep, 'err', '길이는 10~100mm 범위로 입력해주세요.'); return; }
    const opts = {
      length: L,
      dwell: $('genDwell').checked,
      lastThreadStyle: $('genThreadStyle').value
    };
    const oNo = $('genONo').value.trim();
    if (oNo) opts.oNumber = oNo.replace(/^O/i, '');
    if (lastWUserEdited && $('genLastW').value !== '') opts.lastW = parseFloat($('genLastW').value);

    let res;
    try { res = NCGen.generate(opts); }
    catch (err) { reportLine(rep, 'err', '생성 실패: ' + err.message); return; }
    genResult = res;

    const meta = $('genMeta'); meta.textContent = '';
    const mk = (k, v) => { const s = document.createElement('span'); s.innerHTML = ''; s.append(k + ' '); const b = document.createElement('b'); b.textContent = v; s.appendChild(b); meta.appendChild(s); };
    mk('프로그램', 'O' + String(res.meta.oNumber).replace(/^O/, ''));
    mk('길이', L + 'mm');
    mk('선삭 세그먼트', String(res.meta.segments));
    mk('나사 횟수', String(res.meta.threadZs ? res.meta.threadZs.length : '-'));
    mk('마지막 W', String(res.meta.lastW ?? '없음'));
    mk('총 줄수', String(res.text.split('\n').length));
    reportLine(rep, 'ok', '생성 완료. ③ 비교 탭에서 기존 프로그램과 대조해볼 수 있습니다.');
    (res.warnings || []).forEach(w => reportLine(rep, 'warn', w));
    renderCode($('genOutput'), res.text, { highlightMacro: true });
    $('btnGenDownload').disabled = false;
    $('btnGenCopy').disabled = false;
    $('btnGenToCompare').disabled = false;
  });
  $('btnGenDownload').addEventListener('click', () => {
    if (genResult) download(genResult.filename || ('O' + genResult.meta.oNumber), genResult.text);
  });
  $('btnGenCopy').addEventListener('click', e => genResult && copyText(genResult.text, e.target));
  $('btnGenToCompare').addEventListener('click', () => {
    if (!genResult) return;
    $('cmpB').value = genResult.text;
    $('cmpBName').textContent = '(생성 결과)';
    document.querySelector('.tabs button[data-tab="compare"]').click();
  });

  /* ── 생성 방식 전환 (전용 / 범용) ── */
  function genUpdateMode() {
    const uni = $('genMode').value === 'universal';
    $('genDedicated').hidden = uni;
    $('genDedicatedInfo').hidden = uni;
    $('genUniversal').hidden = !uni;
    $('genModeHint').textContent = uni
      ? '범용: 제일 작은·큰 사이즈 프로그램 2개와 각 길이를 넣고, 만들 중간 사이즈를 입력하세요. 규칙을 자동 파악해 생성합니다.'
      : '전용: 3.5mm 나사 규칙으로 즉시 생성. 범용: 제일 작은·큰 사이즈 프로그램 2개를 올리면 규칙을 파악해 중간 사이즈를 만듭니다.';
  }
  $('genMode').addEventListener('change', genUpdateMode);
  genUpdateMode();

  // 텍스트영역 드롭 지원
  enableTextareaDrop($('uniA'));
  enableTextareaDrop($('uniB'));

  function renderRules(el, rules) {
    el.textContent = '';
    if (!rules || !rules.length) return;
    const box = document.createElement('div'); box.className = 'rules-box';
    const t = document.createElement('div'); t.className = 'rules-title';
    t.textContent = '📐 학습한 규칙 (' + rules.length + '개 값이 길이에 따라 변함)';
    el.appendChild(t);
    for (const r of rules.slice(0, 40)) {
      const d = document.createElement('div'); d.className = 'rule';
      // 규칙은 "vA → vB : 값 ≈ 공식" 형태의 문자열
      const str = typeof r === 'string' ? r : (r.formula || JSON.stringify(r));
      const parts = str.split(':');
      const v = document.createElement('span'); v.className = 'v'; v.textContent = parts[0] ? parts[0].trim() : '';
      const f = document.createElement('span'); f.className = 'f'; f.textContent = parts[1] ? parts[1].trim() : str;
      d.appendChild(f); d.appendChild(v); box.appendChild(d);
    }
    if (rules.length > 40) {
      const more = document.createElement('div'); more.className = 'rule';
      more.style.color = 'var(--ink-faint)';
      more.textContent = '… 외 ' + (rules.length - 40) + '개';
      box.appendChild(more);
    }
    el.appendChild(box);
  }

  function runUniversal() {
    const rep = $('uniReport'); rep.textContent = ''; $('uniRules').textContent = '';
    if (typeof NCInterp === 'undefined' || !NCInterp.learn) { reportLine(rep, 'err', '보간 엔진을 불러오지 못했습니다.'); return; }
    const a = $('uniA').value, b = $('uniB').value;
    const la = parseFloat($('uniLenA').value), lb = parseFloat($('uniLenB').value), tg = parseFloat($('uniTarget').value);
    if (!a.trim() || !b.trim()) { reportLine(rep, 'err', '작은 사이즈·큰 사이즈 프로그램을 모두 넣어주세요.'); return; }
    if (!isFinite(la) || !isFinite(lb)) { reportLine(rep, 'err', '두 프로그램의 길이(mm)를 입력해주세요.'); return; }
    if (la === lb) { reportLine(rep, 'err', '두 길이가 같습니다. 서로 다른 사이즈를 넣어주세요.'); return; }
    if (!isFinite(tg)) { reportLine(rep, 'err', '만들 중간 사이즈를 입력해주세요.'); return; }
    let model, out;
    try {
      model = NCInterp.learn(a, la, b, lb);
      out = NCInterp.generate(model, tg);
    } catch (err) { reportLine(rep, 'err', '학습/생성 실패: ' + err.message); return; }

    genResult = { text: out.text, filename: 'O_' + tg + 'mm', meta: { oNumber: tg + 'mm' } };
    const nRules = (model.rules || out.rules || []).length;
    if (model.structureMatch) reportLine(rep, 'ok', '두 프로그램의 구조가 일치합니다. ' + nRules + '개 값의 변화 규칙을 학습해 ' + tg + 'mm를 생성했습니다.');
    else reportLine(rep, 'warn', '두 프로그램의 구조(공정 수)가 달라 정확한 보간이 어렵습니다. 구조가 같은 사이즈 2개를 올리거나 중간 샘플을 추가하세요. (참고용으로 생성함)');
    (out.warnings || []).forEach(w => { if (!/구조/.test(w)) reportLine(rep, 'warn', w); });
    renderRules($('uniRules'), model.rules || out.rules);

    renderCode($('genOutput'), out.text, { highlightMacro: true });
    $('btnGenDownload').disabled = false;
    $('btnGenCopy').disabled = false;
    $('btnGenToCompare').disabled = false;
  }
  $('btnUniLearn').addEventListener('click', runUniversal);

  // 범용 예제: 18mm↔22mm로 학습 → 20mm 생성
  const exU = $('exUniversal');
  if (exU) exU.addEventListener('click', () => {
    if (typeof NCExamples === 'undefined' || !NCExamples.universal) { toast('예제 데이터를 불러오지 못했습니다.'); return; }
    const u = NCExamples.universal;
    $('uniA').value = u.progA; $('uniLenA').value = u.lenA;
    $('uniB').value = u.progB; $('uniLenB').value = u.lenB;
    $('uniTarget').value = u.target;
    runUniversal();
    toast('예제: 18mm·22mm에서 규칙을 학습해 20mm를 생성했습니다.');
  });

  /* ═════════ 탭 4: 사이클 생성 ═════════ */
  let cycResult = null;
  // O번호에서 사이즈(mm) 추출: O3524 → 24, O3510(100mm 예외는 프로그램 주석 기준이라 여기선 10)
  function sizeFromProg(prog) {
    const oNo = String(prog).replace(/^O/i, '').trim();
    const m = oNo.match(/^35(\d{2})$/);
    if (m) { const s = parseInt(m[1], 10); return s === 10 ? null : s; } // O3510은 10 또는 100 모두라 자동주석 생략
    return null;
  }
  (function buildCycleRows() {
    const tbody = $('cycSlots');
    for (let n = 1; n <= 9; n++) {
      const tr = document.createElement('tr');
      const tdN = document.createElement('td');
      tdN.textContent = n;
      tdN.style.cssText = 'padding:4px 8px;color:var(--accent);font-family:"IBM Plex Mono",monospace';
      const mkTd = (input) => { const td = document.createElement('td'); td.style.padding = '3px 6px'; td.appendChild(input); return td; };
      const prog = document.createElement('input'); prog.type = 'text'; prog.id = 'cycProg' + n; prog.placeholder = 'O3524'; prog.style.width = '100%';
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = '0'; qty.id = 'cycQty' + n; qty.style.width = '100%';
      tr.appendChild(tdN); tr.appendChild(mkTd(prog)); tr.appendChild(mkTd(qty));
      tbody.appendChild(tr);
    }
  })();

  let cycResults = { sample: null, prod: null, current: null };

  function cycUpdateModeUI() {
    const mode = $('cycMode').value;
    $('cycSampleNoWrap').style.display = mode === 'prod' ? 'none' : '';
    $('cycProdNoWrap').style.display = mode === 'sample' ? 'none' : '';
    $('cycDlHint').hidden = mode !== 'both';
  }
  $('cycMode').addEventListener('change', cycUpdateModeUI);
  cycUpdateModeUI();

  function cycShow(which) {
    const res = cycResults[which];
    if (!res) return;
    cycResults.current = which;
    renderCode($('cycOutput'), res.text, { highlightMacro: true });
    $('btnCycViewSample').className = which === 'sample' ? 'primary' : 'ghost';
    $('btnCycViewProd').className = which === 'prod' ? 'primary' : 'ghost';
    $('btnCycViewSample').style.padding = '5px 14px';
    $('btnCycViewProd').style.padding = '5px 14px';
  }
  $('btnCycViewSample').addEventListener('click', () => cycShow('sample'));
  $('btnCycViewProd').addEventListener('click', () => cycShow('prod'));

  $('btnCycle').addEventListener('click', () => {
    const rep = $('cycReport'); rep.textContent = '';
    const mode = $('cycMode').value;
    const machine = $('cycMachine').value;
    const slots = [];
    for (let n = 1; n <= 9; n++) {
      const prog = $('cycProg' + n).value.trim().replace(/^O/i, '');
      const qty = parseFloat($('cycQty' + n).value);
      if (prog && (qty > 0 || mode === 'sample')) {
        const size = sizeFromProg(prog);
        slots.push({ program: prog, qty: qty > 0 ? qty : 1, label: size ? size + 'mm' : '' });
      } else {
        slots.push(null);
      }
    }
    cycResults = { sample: null, prod: null, current: null };
    try {
      if (mode !== 'prod') {
        cycResults.sample = NCCycle.generateSampleCycle({
          machine, slots,
          oNumber: $('cycSampleONo').value.trim().replace(/^O/i, '') || '4393'
        });
      }
      if (mode !== 'sample') {
        cycResults.prod = NCCycle.generateCycle({
          machine, slots,
          oNumber: $('cycONo').value.trim().replace(/^O/i, '') || '5582'
        });
      }
    } catch (err) { reportLine(rep, 'err', err.message); return; }

    const meta = $('cycMeta'); meta.textContent = '';
    const mk = (k, v) => { const s = document.createElement('span'); s.append(k + ' '); const b = document.createElement('b'); b.textContent = v; s.appendChild(b); meta.appendChild(s); };
    if (cycResults.sample) mk('샘플', 'O' + cycResults.sample.meta.oNumber + ' (' + cycResults.sample.meta.usedSlots + '사이즈 × 1개)');
    if (cycResults.prod) mk('양산', 'O' + cycResults.prod.meta.oNumber + ' (합계 ' + cycResults.prod.meta.totalQty + '개)');
    mk('기종', machine === 'J' ? 'J (20J)' : 'R (20R-IV)');

    reportLine(rep, 'ok',
      mode === 'both' ? '샘플·양산 프로그램 2개 생성 완료 — 샘플 가공·검사 후 양산 프로그램을 돌리세요.'
        : mode === 'sample' ? '샘플(Q/A) 프로그램 생성 완료 — 각 사이즈 1개씩 가공합니다.'
          : '양산 프로그램 생성 완료.');
    const seen = new Set();
    [cycResults.sample, cycResults.prod].forEach(r => (r ? r.warnings : []).forEach(w => {
      if (!seen.has(w)) { seen.add(w); reportLine(rep, 'warn', w); }
    }));

    $('cycViewTabs').style.display = mode === 'both' ? 'flex' : 'none';
    cycShow(cycResults.sample ? 'sample' : 'prod');
    $('btnCycDownload').disabled = false;
    $('btnCycCopy').disabled = false;
    $('btnCycToCompare').disabled = false;
  });

  $('btnCycDownload').addEventListener('click', async () => {
    if (cycResults.sample) await download(cycResults.sample.filename, cycResults.sample.text);
    if (cycResults.sample && cycResults.prod) await new Promise(r => setTimeout(r, 400));
    if (cycResults.prod) await download(cycResults.prod.filename, cycResults.prod.text);
  });
  $('btnCycCopy').addEventListener('click', e => {
    const res = cycResults[cycResults.current];
    if (res) copyText(res.text, e.target);
  });
  $('btnCycToCompare').addEventListener('click', () => {
    const res = cycResults[cycResults.current];
    if (!res) return;
    $('cmpB').value = res.text;
    $('cmpBName').textContent = '(사이클 ' + (cycResults.current === 'sample' ? '샘플' : '양산') + ' 생성 결과)';
    document.querySelector('.tabs button[data-tab="compare"]').click();
  });

  /* ═════════ 탭 5: 비교 ═════════ */
  $('btnCmpAFile').addEventListener('click', () => $('cmpAFile').click());
  $('btnCmpBFile').addEventListener('click', () => $('cmpBFile').click());
  $('cmpAFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('cmpA').value = await readFileText(f); $('cmpAName').textContent = f.name;
  });
  $('cmpBFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('cmpB').value = await readFileText(f); $('cmpBName').textContent = f.name;
  });
  enableTextareaDrop($('cmpA'), f => { $('cmpAName').textContent = f.name; });
  enableTextareaDrop($('cmpB'), f => { $('cmpBName').textContent = f.name; });

  const DATE_COMMENT_RE = /^\(20\d\d[.\-]\d{1,2}[.\-]\d{1,2}(\s*\/[^)]*)?\)$/;
  function normalizeLines(text, norm) {
    let lines = text.replace(/\r/g, '').split('\n').map(l => norm ? l.trim() : l);
    if (norm) {
      lines = lines.filter(l => l !== '');
      lines = lines.filter(l => !DATE_COMMENT_RE.test(l));
    }
    return lines;
  }
  function diffLines(a, b) { // LCS 기반 라인 diff → [{t:'=,-,+', line}]
    const n = a.length, m = b.length;
    const dp = new Int32Array((n + 1) * (m + 1));
    const idx = (i, j) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: '=', line: a[i] }); i++; j++; }
      else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) { out.push({ t: '-', line: a[i] }); i++; }
      else { out.push({ t: '+', line: b[j] }); j++; }
    }
    while (i < n) { out.push({ t: '-', line: a[i++] }); }
    while (j < m) { out.push({ t: '+', line: b[j++] }); }
    return out;
  }
  $('btnCompare').addEventListener('click', () => {
    const rep = $('cmpReport'); rep.textContent = '';
    const A = normalizeLines($('cmpA').value, $('cmpNorm').checked);
    const B = normalizeLines($('cmpB').value, $('cmpNorm').checked);
    if (!A.length || !B.length) { reportLine(rep, 'err', '양쪽 모두 프로그램을 넣어주세요.'); return; }
    if (A.length * B.length > 16000000) { reportLine(rep, 'err', '파일이 너무 큽니다 (비교 한도 초과).'); return; }
    const d = diffLines(A, B);
    const diffs = d.filter(x => x.t !== '=').length;
    const minus = d.filter(x => x.t === '-').length, plus = d.filter(x => x.t === '+').length;
    // 총 개수 요약 배지
    const sum = document.createElement('div'); sum.className = 'diff-summary';
    if (diffs === 0) {
      sum.innerHTML = '<span class="ds-ok">✓ 두 프로그램이 완전히 일치합니다' +
        ($('cmpNorm').checked ? ' (공백·주석 정규화 기준)' : '') + '</span>';
    } else {
      sum.innerHTML =
        '<span class="ds-del">− 빠진 줄 (A에만 있음) <b>' + minus + '</b>개</span>' +
        '<span class="ds-add">+ 들어온 줄 (B에만 있음) <b>' + plus + '</b>개</span>' +
        '<span class="ds-tot">총 차이 <b>' + diffs + '</b>줄</span>';
    }
    rep.appendChild(sum);
    const el = $('cmpOutput'); el.textContent = '';
    el.classList.toggle('has-diff', diffs > 0);
    const frag = document.createDocumentFragment();
    let no = 0;
    for (const x of d) {
      no++;
      const isDiff = x.t !== '=';
      const div = document.createElement('div');
      div.className = 'ln' + (x.t === '-' ? ' del' : x.t === '+' ? ' add' : '');
      // 차이 줄에는 확인 체크박스
      const ck = document.createElement('span'); ck.className = 'ck';
      if (isDiff) {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'linechk';
        cb.title = '이 줄 확인';
        cb.addEventListener('change', () => {
          div.classList.toggle('checked', cb.checked);
          updateDiffProgress();
        });
        ck.appendChild(cb);
        // 줄 아무 데나 클릭해도 토글 (텍스트 드래그 제외)
        div.addEventListener('click', e => {
          if (e.target === cb || window.getSelection().toString()) return;
          cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
        });
      }
      const nn = document.createElement('span'); nn.className = 'no';
      nn.textContent = x.t === '=' ? String(no) : x.t;
      const tx = document.createElement('span'); tx.textContent = x.line || ' ';
      div.appendChild(ck); div.appendChild(nn); div.appendChild(tx);
      frag.appendChild(div);
    }
    el.appendChild(frag);
    showSignoff(diffs, minus, plus);
    updateDiffProgress();
  });

  // 줄별 확인 진행률
  function updateDiffProgress() {
    const boxes = document.querySelectorAll('#cmpOutput .linechk');
    const total = boxes.length;
    const done = [...boxes].filter(b => b.checked).length;
    const bar = $('diffProgress');
    if (bar) {
      if (total === 0) { bar.hidden = true; }
      else {
        bar.hidden = false;
        const pct = Math.round(done / total * 100);
        bar.querySelector('.dp-text').innerHTML =
          '줄별 확인 <b>' + done + ' / ' + total + '</b>개' + (done === total ? ' — 모두 확인됨 ✓' : '');
        bar.querySelector('.dp-fill').style.width = pct + '%';
        bar.classList.toggle('done', done === total);
      }
    }
    // 서명 체크박스는 모든 줄 확인 시에만 활성
    const seen = $('signoffSeen');
    if (seen) {
      const allDone = total === 0 || done === total;
      seen.disabled = !allDone;
      const lbl = $('signoffSeenLabel');
      if (lbl) lbl.classList.toggle('locked', !allDone);
      if (!allDone && seen.checked) { seen.checked = false; }
      updateSignoffBtn();
    }
  }

  // 전체 확인 / 해제
  const _btnCheckAll = $('btnCheckAll');
  if (_btnCheckAll) _btnCheckAll.addEventListener('click', () => {
    document.querySelectorAll('#cmpOutput .linechk').forEach(b => { b.checked = true; b.dispatchEvent(new Event('change')); });
  });
  const _btnUncheckAll = $('btnUncheckAll');
  if (_btnUncheckAll) _btnUncheckAll.addEventListener('click', () => {
    document.querySelectorAll('#cmpOutput .linechk').forEach(b => { b.checked = false; b.dispatchEvent(new Event('change')); });
  });

  /* ── 작업자 최종 확인 (sign-off) ── */
  function showSignoff(diffs, minus, plus) {
    const box = $('cmpSignoff'); box.hidden = false;
    $('signoffForm').hidden = false;
    $('signoffStamp').hidden = true;
    $('signoffSeen').checked = false;
    $('btnSignoff').disabled = true;
    box._diffs = diffs; box._minus = minus; box._plus = plus;
    $('signoffGuide').innerHTML = diffs === 0
      ? '두 프로그램이 <b>완전히 일치</b>합니다. 확인 후 서명해 주세요.'
      : '<b>빨간 줄 ' + minus + '개(빠짐)</b>와 <b>초록 줄 ' + plus + '개(들어옴)</b>가 있습니다. 각 줄이 의도한 변경인지 직접 확인하세요.';
  }
  function updateSignoffBtn() {
    $('btnSignoff').disabled = !($('signoffSeen').checked && $('signoffName').value.trim());
  }
  $('signoffSeen').addEventListener('change', updateSignoffBtn);
  $('signoffName').addEventListener('input', updateSignoffBtn);
  $('btnSignoff').addEventListener('click', () => {
    const box = $('cmpSignoff');
    const name = $('signoffName').value.trim();
    const now = new Date();
    const ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
      + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const diffs = box._diffs || 0, minus = box._minus || 0, plus = box._plus || 0;
    const stamp = $('signoffStamp');
    stamp.innerHTML =
      '<div class="seal">확인<br>완료</div>' +
      '<div class="info">' +
        '<div><b>' + name + '</b> 님이 검증 결과를 직접 확인했습니다.</div>' +
        '<div>' + ts + ' · ' + (diffs === 0 ? '완전 일치' : ('빠짐 ' + minus + '줄 · 들어옴 ' + plus + '줄 (총 ' + diffs + '줄) 확인')) + '</div>' +
        (diffs > 0 ? '<div class="warnrow">⚠ 기계에서 싱글블록·낮은 이송으로 첫 가공을 검증하세요.</div>' : '') +
      '</div>' +
      '<button class="signoff-redo" id="btnSignoffRedo">다시 확인</button>';
    $('signoffForm').hidden = true;
    stamp.hidden = false;
    stamp.querySelector('#btnSignoffRedo').addEventListener('click', () => {
      stamp.hidden = true; $('signoffForm').hidden = false;
      $('signoffSeen').checked = false; $('btnSignoff').disabled = true;
    });
    // 확인 이력 누적 저장
    addSignoffRecord({
      name: name, ts: ts,
      diffs: diffs, minus: minus, plus: plus,
      progA: ($('cmpAName').textContent || '').trim() || '프로그램 A',
      progB: ($('cmpBName').textContent || '').trim() || '프로그램 B',
    });
    toast('검증 확인 완료 — ' + name + ' · ' + ts);
  });

  /* ── 확인 이력 (누가·언제 확인했는지 기록, 브라우저에 저장) ── */
  const SIGNOFF_KEY = 'ncSignoffLog';
  function loadSignoffLog() {
    try { const r = localStorage.getItem(SIGNOFF_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveSignoffLog(arr) { try { localStorage.setItem(SIGNOFF_KEY, JSON.stringify(arr)); } catch (e) {} }
  function addSignoffRecord(rec) {
    const log = loadSignoffLog();
    log.unshift(rec);              // 최신이 위로
    if (log.length > 200) log.length = 200;
    saveSignoffLog(log);
    renderSignoffLog();
  }
  function renderSignoffLog() {
    const box = $('signoffLog'); if (!box) return;
    const log = loadSignoffLog();
    const wrap = $('signoffLogWrap');
    if (wrap) wrap.hidden = log.length === 0;
    box.textContent = '';
    log.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'log-row';
      const result = r.diffs === 0 ? '완전 일치'
        : ('차이 ' + r.diffs + '줄 (빠짐 ' + r.minus + ' · 들어옴 ' + r.plus + ')');
      const c1 = document.createElement('span'); c1.className = 'log-when'; c1.textContent = r.ts;
      const c2 = document.createElement('span'); c2.className = 'log-who'; c2.textContent = r.name;
      const c3 = document.createElement('span'); c3.className = 'log-what';
      c3.textContent = (r.progA || '') + ' ↔ ' + (r.progB || '') + ' · ' + result;
      const del = document.createElement('button'); del.className = 'log-del'; del.textContent = '✕'; del.title = '이 기록 삭제';
      del.addEventListener('click', () => { const a = loadSignoffLog(); a.splice(i, 1); saveSignoffLog(a); renderSignoffLog(); });
      row.appendChild(c1); row.appendChild(c2); row.appendChild(c3); row.appendChild(del);
      box.appendChild(row);
    });
  }
  // 이력 내보내기(CSV) / 전체 지우기
  const _btnLogExport = $('btnLogExport');
  if (_btnLogExport) _btnLogExport.addEventListener('click', () => {
    const log = loadSignoffLog();
    if (!log.length) { toast('저장된 확인 이력이 없습니다.'); return; }
    const head = '확인일시,확인자,프로그램A,프로그램B,결과,차이줄,빠짐,들어옴';
    const rows = log.map(r => [r.ts, r.name, r.progA, r.progB,
      (r.diffs === 0 ? '완전일치' : '차이있음'), r.diffs, r.minus, r.plus]
      .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    download('검증확인이력.csv', '﻿' + head + '\n' + rows.join('\n'));
  });
  const _btnLogClear = $('btnLogClear');
  if (_btnLogClear) _btnLogClear.addEventListener('click', () => {
    if (!loadSignoffLog().length) return;
    if (confirm('확인 이력을 모두 지울까요? 되돌릴 수 없습니다.')) { saveSignoffLog([]); renderSignoffLog(); }
  });
  renderSignoffLog(); // 초기 로드

  /* ═════════ 예제 불러오기 (심사위원 체험용) ═════════ */
  function toast(msg) {
    let t = document.getElementById('nc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'nc-toast'; t.className = 'nc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ① 매크로 변환: 내장 원본(20R-IV) + 서브를 채우고 변환 실행
  const exC = $('exConvert');
  if (exC) exC.addEventListener('click', () => {
    if (typeof NCExamples === 'undefined') { toast('예제 데이터를 불러오지 못했습니다.'); return; }
    const ex = NCExamples.macro;
    mainFromFile = { name: ex.mainName, text: ex.main };
    $('mainInput').value = ex.main;
    for (const k of Object.keys(subs)) delete subs[k];
    Object.assign(subs, ex.subs);
    renderConvFileList();
    $('optDwell').checked = true;
    $('btnConvert').click();
    toast('예제(20R-IV 원본 + 서브 2개)를 불러와 변환했습니다.');
  });

  // ② 기종 변환: 엔진으로 40mm J 프로그램을 만들어 넣고 J→R 변환
  const exM = $('exMachine');
  if (exM) exM.addEventListener('click', () => {
    if (typeof NCGen === 'undefined') { toast('생성 엔진을 불러오지 못했습니다.'); return; }
    const j = NCGen.generate({ length: 40, dwell: true });
    $('mcInput').value = j.text;
    $('mcFileName').textContent = '(예제: 40mm J 프로그램)';
    $('mcDir').value = 'J2R';
    $('mcLen').value = '';
    mcChoices = {};
    runMachineConvert();
    toast('예제 J 프로그램(40mm)을 R 기종으로 변환했습니다.');
  });

  // ③ AI 사이즈 생성: 42mm로 채우고 생성
  const exG = $('exGenerate');
  if (exG) exG.addEventListener('click', () => {
    lastWUserEdited = false;
    $('genLen').value = '42';
    $('genLen').dispatchEvent(new Event('input'));
    $('genDwell').checked = true;
    $('btnGenerate').click();
    toast('예제로 42mm 프로그램을 생성했습니다. 길이를 바꿔 다시 눌러보세요.');
  });

  // ④ 사이클 생성: 24mm×520, 18mm×1030, 26mm×520 스케줄로 샘플+양산 생성
  const exCy = $('exCycle');
  if (exCy) exCy.addEventListener('click', () => {
    const demo = [['3524', '520'], ['3518', '1030'], ['3526', '520']];
    for (let n = 1; n <= 9; n++) {
      $('cycProg' + n).value = demo[n - 1] ? 'O' + demo[n - 1][0] : '';
      $('cycQty' + n).value = demo[n - 1] ? demo[n - 1][1] : '';
    }
    $('cycMode').value = 'both';
    $('cycMode').dispatchEvent(new Event('change'));
    $('btnCycle').click();
    toast('예제 스케줄(3종 사이즈)로 샘플·양산 프로그램을 생성했습니다.');
  });

  // ⑤ 비교: 40mm와 42mm 생성 프로그램을 A/B에 넣고 비교
  const exCmp = $('exCompare');
  if (exCmp) exCmp.addEventListener('click', () => {
    if (typeof NCGen === 'undefined') { toast('생성 엔진을 불러오지 못했습니다.'); return; }
    $('cmpA').value = NCGen.generate({ length: 40, dwell: true }).text;
    $('cmpAName').textContent = '(예제: 40mm)';
    $('cmpB').value = NCGen.generate({ length: 42, dwell: true }).text;
    $('cmpBName').textContent = '(예제: 42mm)';
    $('btnCompare').click();
    toast('40mm와 42mm 프로그램의 차이를 비교했습니다.');
  });
})();
