/* 기종 변환 엔진 — 20R-IV ↔ 20J
   ── 규칙 구조 ──
   [1] 줄 단위 코드 치환: G97↔G99, G125Z0↔G120Z0, T700/T7↔T3200/T22, 공구 주석
   [2] 계산 삽입/삭제: R 헤더(G266은 W=길이+0.5, Z=183−길이), N200 숏컷
   [3] 밀링(E/M) 구간: "블록 라이브러리" 방식 —
       제품별로 등록된 R↔J 블록 쌍과 지문(F값 무시, 좌표·코드) 대조 후 상대 기종 블록으로 교체.
       BURR 여부·이송 F값은 원본에서 가져와 유지. 일치 블록이 없으면 원문 유지 + 경고
       (옵션: 실험적 축교환 변환 — X↔Y 교환, 절삭축 부호 반전).
   사용자 블록은 localStorage('ncMillBlocks')에 저장되어 이 PC 브라우저에 유지된다. */
(function (root) {
  'use strict';

  /* ── 내장 블록: 3.5mm Locking Screw E/M D4.0 (검증된 10mm 프로그램 쌍에서 추출) ── */
  const BUILTIN_BLOCKS = [
    {
      name: '3.5 Locking Screw E/M (본가공)', builtin: true,
      R: ['N7(E/M 4.0)', 'T700 ', 'M8 ', 'G0C0 ', 'G0X7.0Z-2.5M36S4000T7', 'M6 ', ' ',
        'G0X0.0 ', ' ', 'G0Y2.98', 'G1Y7.9Z5.07F0.01 ', 'G0Z-2.5', ' ',
        'M7 ', 'G0C120.0 ', 'M6 ', ' ', 'G0Y2.98', 'G1Y7.9Z5.07F0.01 ', 'G0Z-2.5', ' ',
        'M7 ', 'G0C240.0 ', 'M6 ', ' ', 'G0Y2.98', 'G1Y7.9Z5.07F0.01 ', 'G0Z-2.5', ' ',
        'G0X50.0', 'M38', 'G0T0 ', 'M9 '].join('\n'),
      J: ['N7(STS E/M 4.0X12mm_JJ)', '(SETTING Y-1.5)', 'T3200', 'M8 ',
        'G0Y7.0Z-2.5C0.0M36S3500T22 ', 'M6 ', ' ',
        'G0Y0.0 ', ' ', 'G0X-2.98 ', 'G1X-7.9Z5.07F0.01', 'G0Z-2.5', ' ',
        'M7 ', 'G0C120.0 ', 'M6 ', ' ', 'G0X-2.98 ', 'G1X-7.9Z5.07F0.01', 'G0Z-2.5', ' ',
        'M7 ', 'G0C240.0 ', 'M6 ', ' ', 'G0X-2.98 ', 'G1X-7.9Z5.07F0.01', 'G0Z-2.5', ' ',
        'G0Y50.0', 'M38', 'G0T0 ', 'M9 '].join('\n')
    },
    {
      name: '3.5 Locking Screw E/M (툴세팅)', builtin: true,
      R: ['(E/M D4.0) ', 'T700 ', 'M8 ', 'M36S3000 ', 'G0C0.0 ', 'G0X7.0Y12.0Z12.0T7 ', 'M6 ', ' ',
        'G0X3.0 ', 'G1Y-11.0F0.01', 'G0X7.0 ', 'G0Y12.0', ' ',
        'M7 ', 'G0C180.0 ', 'M6 ', ' ', 'G0X3.0 ', 'G1Y-11.0F0.01', 'G0X7.0 ', ' ',
        'M7 ', 'G0X30.0', 'M38', 'G0T0 ', 'M9 '].join('\n'),
      J: ['(STS E/M D4.0X12mm)', 'T3200', 'M8 ', 'G0Y7.0X12.0Z12.0C0.0M36S3500T22', 'M6 ', ' ',
        'G0Y3.5 ', 'G1X-9.0F0.01 ', 'G0Y7.0 ', 'G0X12.0', ' ',
        'M7 ', 'G0C180.0 ', 'M6 ', ' ', 'G0Y3.5 ', 'G1X-9.0F0.01 ', 'G0Y7.0 ', 'G0Z-3.0', ' ',
        'M7 ', 'G0Y40.0', 'M38', 'G0T0 ', 'M9 '].join('\n')
    }
  ];

  /* ── 사용자 블록 저장소 ── */
  function loadUserBlocks() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem('ncMillBlocks');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(b => b && b.name && b.R && b.J) : [];
    } catch (e) { return []; }
  }
  function saveUserBlocks(blocks) {
    try { localStorage.setItem('ncMillBlocks', JSON.stringify(blocks)); return true; }
    catch (e) { return false; }
  }
  function allBlocks() { return BUILTIN_BLOCKS.concat(loadUserBlocks()); }

  /* ── 지문(fingerprint): 주석·타이틀·빈 줄 제거, F값은 F#로 통일, BURR 표기 무시 ── */
  function fingerprint(text) {
    return text.replace(/\r/g, '').split('\n')
      .map(l => l.trim())
      .filter(l => l !== '')
      .filter(l => !l.startsWith('(') && !/^N\d+\(/.test(l))
      .map(l => l.replace(/F[\d.]+/g, 'F#'))
      .join('\n');
  }

  /* 밀링 구간 탐지: 'E/M' 포함 주석/타이틀 줄부터 첫 'M9'까지 */
  function findMillSections(lines) {
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const isTitle = /E\/M/i.test(t) && (t.startsWith('(') || /^N\d+\(/.test(t))
        && !/^\(T\d/.test(t); // 공구 목록 주석 "(T700 ...)" 제외
      if (!isTitle) continue;
      if (sections.length && i <= sections[sections.length - 1].end) continue;
      // 진짜 밀링 블록인지 확인: 타이틀 근처에 공구 호출 줄(T700/T3200 등)이 있어야 함
      let hasToolCall = false;
      for (let j = i + 1; j <= Math.min(i + 5, lines.length - 1); j++) {
        if (/^T\d{3,4}\s*$/.test(lines[j].trim())) { hasToolCall = true; break; }
      }
      if (!hasToolCall) continue;
      let end = -1;
      for (let j = i + 1; j < Math.min(i + 80, lines.length); j++) {
        if (lines[j].trim() === 'M9') { end = j; break; }
      }
      if (end === -1) continue;
      const bodyLines = lines.slice(i, end + 1);
      const body = bodyLines.join('\n');
      const isBurr = /BURR/i.test(lines[i]) || /BURR/i.test(body.split('\n')[0]);
      // 원본 절삭 이송(F): G1 줄의 첫 F값
      let feed = null;
      for (const bl of bodyLines) {
        const m = bl.trim().match(/^G1.*?(F[\d.]+)/);
        if (m) { feed = m[1]; break; }
      }
      sections.push({ start: i, end, body, isBurr, feed });
    }
    return sections;
  }

  /* 라이브러리에서 일치 블록 찾기: srcMachine('R'|'J') 쪽 지문과 비교 */
  function matchBlock(sectionBody, srcMachine, blocks) {
    const fp = fingerprint(sectionBody);
    for (const b of blocks) {
      if (fingerprint(b[srcMachine]) === fp) return b;
    }
    return null;
  }

  /* 교체 블록 생성: 대상 기종 텍스트 + 원본의 F값/BURR 유지 */
  function buildReplacement(block, targetMachine, sec) {
    let lines = block[targetMachine].replace(/\r/g, '').split('\n');
    // 원본이 BURR면 타이틀에 BURR 표기 (이미 없을 때만)
    if (sec.isBurr) {
      lines = lines.map((l, idx) => {
        if (idx === 0 && /^N\d+\(/.test(l.trim()) && !/BURR/i.test(l)) return l.replace(/\)\s*$/, ' BURR)');
        return l;
      });
    }
    // 원본 절삭 F값을 대상 블록의 G1 줄에 반영
    if (sec.feed) {
      lines = lines.map(l => (/^G1/.test(l.trim()) && /F[\d.]+/.test(l)) ? l.replace(/F[\d.]+/, sec.feed) : l);
    }
    return lines;
  }

  /* 실험적 축교환 변환 (일치 블록 없을 때 선택 사용)
     R→J: X→Y(부호 유지), Y→X(부호 반전), T7→T22, T700→T3200
     J→R: Y→X(부호 유지), X→Y(부호 반전), 반대 매핑
     ※ 본가공형 블록에서만 검증된 규칙 — 툴세팅형은 이 규칙과 다를 수 있음 */
  function axisSwapLine(line, dir) {
    return line.replace(/([XY])(-?[\d.]+)/g, (m, ax, val) => {
      if (dir === 'R2J') {
        if (ax === 'X') return 'Y' + val;                    // X→Y 부호 유지
        return 'X' + (val.startsWith('-') ? val.slice(1) : '-' + val); // Y→X 부호 반전
      } else {
        if (ax === 'Y') return 'X' + val;                    // Y→X 부호 유지
        return 'Y' + (val.startsWith('-') ? val.slice(1) : '-' + val); // X→Y 부호 반전
      }
    });
  }

  /* 공구 리스트 주석 대응표 */
  const TOOL_COMMENTS = [
    ['(T200 TURNING R0.2)', '(T200 TURNING 35, R0.2_JINSUNG)'],
    ['(T300 BACK TURNING R0.2)', '(T300 BACK TURNING 35, R0.2_JINSUNG)'],
    ['(T400 THREAD 3.5mm Locking Screw)', '(T400 THREAD 3.5mm Locking Screw_JINSUNG)'],
    ['(T500 THREAD 80, R0.1)', '(T500 THREAD 80, R0.1_JINSUNG)'],
    ['(T700 STS E/M D4.0)', '(T3200 STS E/M D4.0X12mm_JJ)']
  ];

  const N200_BLOCK = [
    'N200 ', 'M9 ', 'G99M10 ', 'T400 ', 'T300 ', '/M25 ', 'G0X25.0',
    'M3S2500', 'G0W0.5 ', 'G1X-0.5F0.02 ', 'G1W-0.2F0.05 ', 'G0X40.0', 'M5 ', 'M99P200'
  ];

  function detectLength(lines) {
    for (const l of lines) {
      const c = l.match(/O\d+\(([^)]*)\)/);
      if (!c) continue;
      const all = [...c[1].matchAll(/([\d.]+)\s*mm/gi)];
      if (all.length) return parseFloat(all[all.length - 1][1]);
    }
    return null;
  }

  /* 축교환 치환: 한 구간 전체 변환 (좌표 축·부호 + T코드) */
  function axisSwapSection(secLines, dir) {
    return secLines.map(l => {
      let nl = axisSwapLine(l, dir);
      return dir === 'R2J'
        ? nl.replace(/T700/g, 'T3200').replace(/T7(?!\d)/g, 'T22')
        : nl.replace(/T3200/g, 'T700').replace(/T22(?!\d)/g, 'T7');
    });
  }

  /* dir: 'R2J' | 'J2R'
     opts: {
       millMode: 'axisswap'(기본: 부호·축 치환) | 'library'(등록 블록만) | 'keep'(변환 안 함),
       millChoices: { 구간인덱스: 'swap'|'library'|'orig' }  ← 검증 단계에서 구간별 선택 덮어쓰기
       length, extraBlocks
     } */
  function convertMachine(text, dir, opts) {
    opts = Object.assign({ millMode: 'axisswap', millChoices: null, length: null, extraBlocks: null }, opts || {});
    const warnings = [];
    const changes = [];
    let lines = text.replace(/\r/g, '').split('\n');
    const L = opts.length || detectLength(lines);
    const src = dir === 'R2J' ? 'R' : 'J';
    const tgt = dir === 'R2J' ? 'J' : 'R';
    const blocks = (opts.extraBlocks || []).concat(allBlocks());
    const choices = opts.millChoices || {};

    /* [3] 밀링 구간 처리 — 후보(치환/검증블록/원문)를 모두 만들고 선택 적용, 검증용으로 전부 반환 */
    const millReview = [];
    const secs = findMillSections(lines);
    for (let s = secs.length - 1; s >= 0; s--) {
      const sec = secs[s];
      const before = lines.slice(sec.start, sec.end + 1);
      const swap = axisSwapSection(before, dir);
      const hit = matchBlock(sec.body, src, blocks);
      const library = hit ? buildReplacement(hit, tgt, sec) : null;
      const swapEqualsLibrary = library ? fingerprint(swap.join('\n')) === fingerprint(library.join('\n')) : null;

      let chosen = choices[s];
      if (!chosen) {
        if (opts.millMode === 'keep') chosen = 'orig';
        else if (opts.millMode === 'library') chosen = library ? 'library' : 'orig';
        else chosen = 'swap'; // axisswap 기본
      }
      if (chosen === 'library' && !library) chosen = 'orig';

      const after = chosen === 'swap' ? swap : chosen === 'library' ? library : before;
      lines.splice(sec.start, sec.end - sec.start + 1, ...after);

      millReview.unshift({
        index: s,
        title: before[0].trim(),
        isBurr: sec.isBurr,
        before, swap, library,
        libraryName: hit ? hit.name : null,
        swapEqualsLibrary,
        chosen
      });

      if (chosen === 'swap') {
        changes.push('밀링 구간 축·부호 치환: ' + before[0].trim() +
          (swapEqualsLibrary === true ? ' — 등록된 검증 블록과 일치 ✓'
            : swapEqualsLibrary === false ? ' — ⚠ 등록된 검증 블록과 다름! 검증 단계에서 확인'
              : ' — 등록 블록 없음, 검증 단계에서 좌표 확인 필요'));
      } else if (chosen === 'library') {
        changes.push('밀링 구간을 검증 블록으로 교체: "' + hit.name + '"' + (sec.feed ? ' — 이송 ' + sec.feed + ' 유지' : ''));
      } else {
        changes.push('밀링 구간 원문 유지: ' + before[0].trim());
      }
    }
    if (secs.length === 0) warnings.push('E/M(밀링) 구간을 찾지 못했습니다 — 밀링이 없는 프로그램이면 정상입니다.');
    if (millReview.some(m => m.chosen === 'swap' && m.swapEqualsLibrary === false)) {
      warnings.push('⚠ 축·부호 치환 결과가 등록된 검증 블록과 다른 구간이 있습니다 — 아래 "밀링 치환 검증"에서 비교 후 선택하세요.');
    }
    if (millReview.some(m => m.chosen === 'swap' && m.swapEqualsLibrary === null)) {
      warnings.push('축·부호 치환은 본가공형 밀링에서 검증된 규칙(X↔Y 교환, 절삭축 부호 반전)입니다. 툴세팅형 구간은 값이 다를 수 있으니 반드시 검증 단계에서 확인하세요.');
    }

    /* [1][2] 줄 단위 규칙 */
    const out = [];
    let removedHeader = 0;
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      const t = l.trim();

      if (dir === 'R2J') {
        if (/^G266[A-Z0-9.\-]/.test(t) || t === 'G125' || t === 'G0B90.0M38' || t === 'G300') { removedHeader++; continue; }
        if (t === 'G97G40M9') { out.push(l.replace('G97G40M9', 'G99G40M9')); changes.push('G97G40M9 → G99G40M9'); continue; }
        if (t === 'G99' && removedHeader > 0 && out.some(x => x.includes('G99G40M9'))) { changes.push('중복 G99 줄 제거'); continue; }
        if (t.startsWith('G125Z0')) { out.push(l.replace('G125Z0', 'G120Z0')); changes.push('G125Z0 → G120Z0'); continue; }
        if (t === 'N200') {
          let j = i;
          while (j < lines.length && lines[j].trim() !== 'M99P200') j++;
          if (j < lines.length) { i = j; changes.push('N200 숏컷 블록 제거 (J에는 없음)'); continue; }
        }
        const tc = TOOL_COMMENTS.find(p => t === p[0].trim());
        if (tc) { out.push(l.replace(tc[0].trim(), tc[1])); continue; }
        if (/T700/.test(t) || /T7(?!\d)/.test(t)) {
          const nl = l.replace(/T700/g, 'T3200').replace(/T7(?!\d)/g, 'T22');
          if (nl !== l) { warnings.push('밀링 외 구간에서 T700/T7 발견 → T3200/T22로 치환: "' + t + '"'); l = nl; }
        }
        out.push(l);
      } else { /* J2R */
        if (t === 'G25' && removedHeader === 0) {
          removedHeader = 1;
          if (L) {
            out.push('G266A6.0W' + (L + 0.5).toFixed(1) + 'S2500X-1.5F0.01Z' + (183 - L).toFixed(1) + 'B2.0 ');
          } else {
            out.push('G266A6.0W(길이+0.5)S2500X-1.5F0.01Z(183-길이)B2.0 ');
            warnings.push('제품 길이를 감지하지 못해 G266의 W/Z를 채우지 못했습니다 — 길이를 입력하거나 직접 수정하세요.');
          }
          out.push('G125 ');
          out.push('G0B90.0M38 ');
          out.push('G300 ');
          out.push(l);
          changes.push('R 헤더 삽입 (G266/G125/G0B90.0M38/G300)' + (L ? ' — W' + (L + 0.5).toFixed(1) + ' / Z' + (183 - L).toFixed(1) : ''));
          continue;
        }
        if (t === 'G99G40M9') { out.push(l.replace('G99G40M9', 'G97G40M9')); out.push('G99'); changes.push('G99G40M9 → G97G40M9 + G99'); continue; }
        if (t.startsWith('G120Z0')) { out.push(l.replace('G120Z0', 'G125Z0')); changes.push('G120Z0 → G125Z0'); continue; }
        if (t === 'M99P100') {
          out.push(l); out.push(' '); out.push(...N200_BLOCK);
          changes.push('N200 숏컷 블록 추가 (R 표준)');
          continue;
        }
        const tc = TOOL_COMMENTS.find(p => t === p[1].trim());
        if (tc) { out.push(l.replace(tc[1].trim(), tc[0])); continue; }
        if (/T3200/.test(t) || /T22(?!\d)/.test(t)) {
          const nl = l.replace(/T3200/g, 'T700').replace(/T22(?!\d)/g, 'T7');
          if (nl !== l) { warnings.push('밀링 외 구간에서 T3200/T22 발견 → T700/T7로 치환: "' + t + '"'); l = nl; }
        }
        out.push(l);
      }
    }

    if (dir === 'R2J' && removedHeader > 0) changes.push('R 헤더 ' + removedHeader + '줄 제거 (G266/G125/G0B90.0M38/G300)');
    if (dir === 'R2J' && removedHeader === 0) warnings.push('R 헤더(G266 등)를 찾지 못했습니다 — 이미 J 형식이거나 헤더가 다른 프로그램일 수 있습니다.');
    warnings.push('기종 변환 후에는 반드시 ④ 비교 탭과 실기 검증(싱글블록)을 거치세요.');

    return { text: out.join('\n'), report: { changes, warnings, length: L, millReview } };
  }

  root.NCMachine = {
    convertMachine, detectLength,
    loadUserBlocks, saveUserBlocks,
    builtinBlocks: BUILTIN_BLOCKS,
    fingerprint
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NCMachine;
})(typeof self !== 'undefined' ? self : globalThis);
