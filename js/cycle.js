/* 사이클 프로그램 생성 엔진 — O5582 (MACRO AUTO SIZE CYCLE) 형식
   구조 출처: samples/cycle/O5582 (2026.07.09 / JYH) — 구조 그대로 유지:
   - #51n(영구 카운터) / #50n(목표 수량) / #10n(프로그램 번호), 슬롯 9개
   - 각 슬롯: IF 스킵(재시작 대응) → WHILE 수량 가공 → 다음 프로그램 1회 선가공(사이즈 전환 첫 개) → M98 P1000
   - 슬롯9는 다음이 없어 자기 자신 1회 호출 (원본 유지)
   - 미사용 슬롯: 수량 0.0 / 프로그램 1000
   - 기종: R = G125Z0, J = G120Z0 (종료 블록만 차이) */
(function (root) {
  'use strict';

  function fmtQty(q) {
    const n = Number(q) || 0;
    return n.toFixed(1);
  }

  /* opts: {
       machine: 'R' | 'J',
       oNumber: 5582,
       title: 'MACRO AUTO SIZE CYCLE',
       author: 'JYH',
       slots: [ { program: 3524, qty: 520, label: '24mm' }, ... 최대 9개 ]
     } */
  function generateCycle(opts) {
    opts = Object.assign({ machine: 'R', oNumber: 5582, title: 'MACRO AUTO SIZE CYCLE', author: 'JYH', slots: [] }, opts || {});
    const warnings = [];
    const slots = [];
    for (let i = 0; i < 9; i++) {
      const s = opts.slots[i];
      if (s && s.program && Number(s.qty) > 0) {
        slots.push({ program: String(s.program).replace(/^O/i, ''), qty: Number(s.qty), label: s.label || '' });
      } else {
        slots.push(null);
      }
    }
    const usedCount = slots.filter(Boolean).length;
    if (usedCount === 0) throw new Error('사용할 슬롯이 없습니다 — 프로그램 번호와 수량을 1개 이상 입력하세요.');
    // 사용 슬롯이 앞에서부터 연속인지 확인 (중간 빈 슬롯이 있어도 IF문이 스킵하므로 동작은 하지만 경고)
    let seenEmpty = false;
    slots.forEach((s, i) => {
      if (!s) seenEmpty = true;
      else if (seenEmpty) warnings.push('슬롯 ' + (i + 1) + ' 앞에 빈 슬롯이 있습니다 — 동작은 하지만 앞에서부터 채우는 것을 권장합니다.');
    });

    const today = new Date();
    const dateStr = today.getFullYear() + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' + String(today.getDate()).padStart(2, '0');

    const L = [];
    L.push('%');
    L.push('O' + opts.oNumber + '(' + opts.title + ')');
    L.push('(' + dateStr + ' / ' + opts.author + ')');
    L.push('');
    L.push('M20');
    L.push('M1 ');
    L.push('M601');
    L.push('M20');
    L.push('M1 ');
    L.push('');
    L.push('N1');
    L.push('');
    for (let n = 1; n <= 9; n++) L.push('#51' + n + '=0.0');
    L.push('');
    L.push('');
    L.push('');
    for (let n = 1; n <= 9; n++) {
      const s = slots[n - 1];
      L.push('#50' + n + '=' + (s ? fmtQty(s.qty) : '0.0') + '   (' + (s ? s.label : '') + ')');
    }
    L.push('');
    L.push('');
    L.push('M20');
    L.push('M1 ');
    L.push('M20');
    L.push('M1 ');
    L.push('');
    L.push('(START)');
    L.push('');
    L.push('N2');
    L.push('');
    for (let n = 1; n <= 9; n++) {
      const s = slots[n - 1];
      L.push('#10' + n + '=' + (s ? s.program : '1000'));
    }
    L.push('');
    L.push('');
    L.push('M98 P1000 ');
    L.push('');

    for (let n = 1; n <= 9; n++) {
      const nextVar = n < 9 ? '#10' + (n + 1) : '#109'; // 슬롯9는 자기 자신 (원본 유지)
      L.push('(' + n + '- START)');
      L.push('');
      L.push('IF [#51' + n + ' GE #50' + n + '] GOTO ' + (n * 10));
      L.push('');
      L.push('WHILE[#51' + n + 'LT#50' + n + ']DO1 ');
      L.push(' #51' + n + '=#51' + n + '+1.0');
      L.push(' M98 P#10' + n);
      L.push('END1');
      L.push('');
      L.push('M98 P' + nextVar);
      L.push('M98 P1000 ');
      L.push('');
      L.push('N' + (n * 10));
      L.push('');
      L.push('');
    }

    L.push('M601 ');
    L.push('');
    L.push('');
    L.push('');
    L.push('');
    L.push('M601 ');
    L.push('N0 ');
    L.push('M5 ');
    L.push('M11');
    L.push('G0T0 ');
    L.push('G28W0');
    L.push('G0W100.0 ');
    L.push('T100 ');
    L.push(opts.machine === 'J' ? 'G120Z0 ' : 'G125Z0 ');
    L.push('M99');
    L.push('');
    L.push('');
    L.push('N100(SHORT-CUT PROGRAM)');
    L.push('M9 ');
    L.push('G99M10 ');
    L.push('M3S2500');
    L.push('T200 ');
    L.push('T100 ');
    L.push('/M25 ');
    L.push('G0X21.0 ');
    L.push('G0W0.5 ');
    L.push('G99G1X-1.5F0.01');
    L.push('M5 ');
    L.push('M00');
    L.push('M99P100');
    L.push('%');

    const totalQty = slots.filter(Boolean).reduce((a, s) => a + s.qty, 0);
    const preRuns = usedCount; // 각 사용 슬롯 뒤 선가공 1개 (마지막은 자기 자신)
    warnings.push('사이즈 전환 선가공(각 슬롯 종료 후 1개)이 카운터에 잡히지 않으므로 실제 가공 수량은 목표 합계보다 최대 ' + preRuns + '개 많을 수 있습니다.');
    warnings.push('카운터(#511~519)는 영구 변수입니다 — 이어서 생산하려면 기계에서 N1 초기화를 건너뛰고 (START)부터 시작하세요.');

    return {
      text: L.join('\n'),
      filename: 'O' + opts.oNumber,
      meta: { oNumber: opts.oNumber, machine: opts.machine, usedSlots: usedCount, totalQty },
      warnings
    };
  }

  /* ── 샘플(Q/A) 사이클 — O4393 형식 ──
     각 사이즈를 1개씩만 가공해 검사. 슬롯 10개, 카운터 #511~520 / 수량 #501~510(사용=1.0).
     프로그램 번호는 변수 없이 M98 P{번호} 직접 호출 (원본 미사용 슬롯은 P1234 자리표시).
     IF 스킵 없음, 슬롯 사이마다 M98 P1000. */
  function generateSampleCycle(opts) {
    opts = Object.assign({ machine: 'R', oNumber: 4393, title: 'MACRO AUTO SIZE CYCLE', author: 'JYH', slots: [] }, opts || {});
    const warnings = [];
    const slots = [];
    for (let i = 0; i < 10; i++) {
      const s = opts.slots[i];
      if (s && s.program) slots.push({ program: String(s.program).replace(/^O/i, ''), label: s.label || '' });
      else slots.push(null);
    }
    const usedCount = slots.filter(Boolean).length;
    if (usedCount === 0) throw new Error('사용할 슬롯이 없습니다 — 프로그램 번호를 1개 이상 입력하세요.');

    const L = [];
    L.push('%');
    L.push('O' + opts.oNumber + '(' + opts.title + ')');
    L.push('(Q/A ' + opts.author + ')');
    L.push('');
    for (let k = 0; k < 4; k++) { L.push('M20'); L.push('M1 '); }
    L.push('');
    for (let n = 1; n <= 10; n++) L.push('#5' + (10 + n) + '=0.0');
    L.push('');
    L.push('');
    L.push('');
    for (let n = 1; n <= 10; n++) {
      const s = slots[n - 1];
      L.push('#' + (500 + n) + '=' + (s ? '1.0' : '0.0') + '   (' + (s ? s.label : '') + ')');
    }
    L.push('');
    L.push('');
    for (let k = 0; k < 5; k++) { L.push('M20'); L.push('M1 '); }
    L.push('');
    L.push('(START)');
    L.push('');
    L.push('');
    L.push('M98 P1000');
    L.push('');
    for (let n = 1; n <= 10; n++) {
      const s = slots[n - 1];
      L.push('(' + n + '- START)');
      L.push('');
      L.push('WHILE[#' + (510 + n) + 'LT#' + (500 + n) + ']DO1 ');
      L.push(' #' + (510 + n) + '=#' + (510 + n) + '+1.0');
      L.push(' M98 P' + (s ? s.program : '1234'));
      L.push('END1');
      L.push('');
      L.push('M98 P1000');
      L.push('');
    }
    L.push('M601 ');
    L.push('');
    L.push('');
    L.push('N0 ');
    L.push('M5 ');
    L.push('M11');
    L.push('G0T0 ');
    L.push('G28W0');
    L.push('G0W100.0 ');
    L.push('T100 ');
    L.push(opts.machine === 'J' ? 'G120Z0 ' : 'G125Z0 ');
    L.push('M99');
    L.push('');
    L.push('');
    L.push('N100(SHORT-CUT PROGRAM)');
    L.push('M9 ');
    L.push('G99M10 ');
    L.push('M3S2500');
    L.push('T200 ');
    L.push('T100 ');
    L.push('/M25 ');
    L.push('G0X21.0 ');
    L.push('G0W0.5 ');
    L.push('G99G1X-1.5F0.01');
    L.push('M5 ');
    L.push('M00');
    L.push('M99P100');
    L.push('%');

    warnings.push('샘플 사이클은 각 사이즈를 1개씩 가공합니다. 슬롯 사이의 O1000 호출 시점에 샘플을 회수·검사하세요.');
    warnings.push('카운터(#511~520)는 영구 변수입니다 — 재실행 전 프로그램 처음(N 없음, 카운터 초기화 구간)부터 시작해야 다시 1개씩 가공됩니다.');

    return {
      text: L.join('\n'),
      filename: 'O' + opts.oNumber,
      meta: { oNumber: opts.oNumber, machine: opts.machine, usedSlots: usedCount, totalQty: usedCount },
      warnings
    };
  }

  root.NCCycle = { generateCycle, generateSampleCycle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NCCycle;
})(typeof self !== 'undefined' ? self : globalThis);
