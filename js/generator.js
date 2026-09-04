/*
 * generator.js — 3.5mm Locking Screw 20J 스위스선반용 매크로 프로그램 자동 생성 엔진
 *
 * 브라우저/Node 겸용 (UMD). 공개 API:
 *   NCGen.generate({
 *     length,            // 필수: 제품 길이 L (mm)
 *     oNumber,           // 선택: 프로그램 번호 (기본 3500+L, 100mm는 3510)
 *     comment,           // 선택: O번호 주석 (기본 "3.5mm Locking Screw {L}mm")
 *     qty,               // 선택: 수량 — 헤더에 (QTY n) 줄 추가
 *     lastW,             // 선택: 마지막 나사 W 덮어쓰기 (기본 L-6-마지막나사Z, [3,8])
 *     lastThreadStyle,   // 선택: 'auto'(기본) | 'plain'(W형) | 'th1'(선단형 재사용)
 *     dwell,             // 선택: 나사 섹션 G4U0.5 드웰 (기본 true; 아카이브 대조 시 false)
 *     date,              // 선택: 헤더 날짜 주석 (기본 오늘, "YYYY.MM.DD")
 *     author,            // 선택: 헤더 작성자 (기본 없음 → 날짜만)
 *     archiveQuirks,     // 선택: 실제 아카이브의 사이즈별 사람 편차 재현 (기본 true)
 *   })
 *   → { filename, text, meta: { oNumber, lastW, segments, threadZs }, warnings: [] }
 *
 * 검증된 규칙 (28개 아카이브 전수 대조):
 *   최종 선삭 Z = L-3.56 / 로킹나사 Z = L-4.52 / 백터닝 Z = L-1.5
 *   절단 Z = L+12.5 / N0 복귀 W = 183-L
 *   선삭 종점 8, 14, 20, ... (6.0 등차), 나사 Z = -2, 2, 8, 14, ...
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NCGen = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---------- 숫자 포맷: 소수 2자리 반올림, 뒤 0 제거하되 소수점 1자리는 유지 ----------
  function fmt(v) {
    var r = Math.round(v * 100) / 100;
    var s = r.toFixed(2);
    if (s.slice(-1) === '0') s = s.slice(0, -1); // x.x0 → x.x
    return s;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // ---------- 아카이브 사람 편차(사이즈별 quirk) — archiveQuirks:true일 때 재현 ----------
  // (알려진 3대 편차인 90mm lastW=5, 14mm th1, 36mm ",Gold"는 옵션으로 별도 처리)
  var QUIRKS = {
    10: { exNoSpace: true },       // #4=10.8(E X) — 공백 없음
    12: { exNoSpace: true },
    24: { midTaper: true },        // 병합된 마지막 중간 선삭(TURNING-3)에 X5.5W2.93 테이퍼 포함
    32: { absorb: true },          // 마지막 중간 선삭이 26 대신 28.44까지 직행
    50: { lockG0Z: 36.0 },         // TURNING-LOCKING 시작 Z (공식값 38 대신)
    55: { absorb: true },          // 50 대신 51.44까지 직행
    60: { lockG0Z: 44.0 },         // 공식값 50 대신
    65: { endApp: 59.9 },          // TURNING-END 접근/루프 시작 (공식값 55.9 대신)
    75: { noBlankThreadK: 5 }      // THREAD-5의 Q0/Q180000 세트 사이 빈 줄 없음
  };

  // ---------- 나사 블록 3종 ----------
  function th1Block(q) { // 첫 나사(선단 형상). 두 번째 세트도 5행은 Q0.
    return [
      'G0U-1.92',
      'G32U-8.0W2.0Q' + q + 'F2.0',
      'G32U1.92W2.65Q' + q + 'F2.0',
      'G32W3.35Q' + q + 'F2.0',
      'G32U4.0W2.0Q' + q + 'F2.0',
      'G32U4.0Q0F2.0',
      'G0W-10.0'
    ];
  }
  function th2Block(q) { // 중간 나사 (직선 W8.0)
    return [
      'G32U-8.0W2.0Q' + q + 'F2.0',
      'G32W8.0Q' + q + 'F2.0',
      'G32U4.0W2.0Q' + q + 'F2.0',
      'G32U4.0Q' + q + 'F2.0',
      'G0W-12.0'
    ];
  }
  function thEndBlock(q, w) { // 마지막 나사 (W 가변)
    return [
      'G32U-8.0W2.0Q' + q + 'F2.0',
      'G32W' + fmt(w) + 'Q' + q + 'F2.0',
      'G32U4.0W2.0Q' + q + 'F2.0',
      'G32U4.0Q' + q + 'F2.0',
      'G0W-' + fmt(w + 4)
    ];
  }
  function lockBlock() { // 로킹나사 블록 (1세트)
    return [
      'G32U-4.0W1.0Q0F1.0',
      'G32U1.5W2.2Q0F1.0',
      'G32U2.5W1.0Q0F1.0',
      'G0W-4.2'
    ];
  }

  // ---------- 나사 매크로 섹션 ----------
  // opts: { header, tool:'T400'|'T500', sx, ex, exSpace, z, blocks:[...], burr, dwell }
  function threadSection(o) {
    var tcode = o.tool === 'T500' ? 'T5' : 'T4';
    var L = [
      o.header,
      o.tool,
      '#2=0.05',
      '#3=' + o.sx + ' (S X)',
      '#4=' + o.ex + (o.exSpace ? ' ' : '') + '(E X)',
      '#5=' + fmt(o.z) + ' (Z)',
      '#1=#4+0.05',
      '',
      'G0X#3Z#5M3S1000' + tcode
    ];
    if (o.dwell) L.push('G4U0.5');
    L.push(
      'WHILE[#3GT#4]DO1',
      '#3=#3-#2',
      '',
      'IF[#3LE#4]THEN#3=#4',
      'IF[#3LE#1]THEN#2=0.01',
      '',
      'G0U-#2',
      ''
    );
    var i;
    if (o.burr) {
      // 버 제거: 루프 안은 공절입만, 나사 블록은 END1 뒤 1회
      L.push('END1', '');
      for (i = 0; i < o.blocks.length; i++) L = L.concat(o.blocks[i], ['']);
    } else {
      for (i = 0; i < o.blocks.length; i++) {
        L = L.concat(o.blocks[i]);
        // noBlockGap: 블록 세트 사이 빈 줄 생략 (마지막 블록 뒤 빈 줄은 유지)
        if (!(o.noBlockGap && i < o.blocks.length - 1)) L.push('');
      }
      L.push('END1', '');
    }
    L.push('G0X30.0', 'G0T0', 'M5');
    return L;
  }

  // ---------- 선삭 펙 루프 ----------
  function peckLoop(startZ, limitZ) {
    return [
      '#1=' + fmt(startZ),
      'WHILE[#1LT' + fmt(limitZ) + ']DO1',
      '#1=#1+0.05',
      '',
      'G1Z#1F0.02',
      'G1W-0.05F0.1',
      'G1W0.045',
      '',
      'END1',
      ''
    ];
  }

  // ---------- E/M 밀링 섹션 ----------
  function emSection(burr) {
    var f = burr ? 'F0.05' : 'F0.01';
    return [
      burr ? 'N7(STS E/M 4.0X12mm_JJ BURR)' : 'N7(STS E/M 4.0X12mm_JJ)',
      '(SETTING Y-1.5)',
      'T3200',
      'M8',
      'G0Y7.0Z-2.5C0.0M36S3500T22',
      'M6',
      '',
      'G0Y0.0',
      '',
      'G0X-2.98',
      'G1X-7.9Z5.07' + f,
      'G0Z-2.5',
      '',
      'M7',
      'G0C120.0',
      'M6',
      '',
      'G0X-2.98',
      'G1X-7.9Z5.07' + f,
      'G0Z-2.5',
      '',
      'M7',
      'G0C240.0',
      'M6',
      '',
      'G0X-2.98',
      'G1X-7.9Z5.07' + f,
      'G0Z-2.5',
      '',
      'G0Y50.0',
      'M38',
      'G0T0',
      'M9'
    ];
  }

  // ---------- 메인 생성 ----------
  function generate(opts) {
    opts = opts || {};
    var warnings = [];
    var L = Number(opts.length);
    if (!isFinite(L) || L <= 0) throw new Error('length(제품 길이)가 필요합니다.');
    if (L < 10 || L > 100) warnings.push('길이 ' + L + 'mm는 검증 범위(10~100mm) 밖입니다.');

    var quirks = (opts.archiveQuirks === false) ? {} : (QUIRKS[L] || {});
    var dwell = opts.dwell !== false; // 기본 true
    var F = r2(L - 3.56);             // 최종 선삭 종점
    var lockZ = r2(L - 4.52);         // 로킹나사 Z
    var backZ = r2(L - 1.5);
    var cutZ = r2(L + 12.5);
    var n0W = r2(183 - L);

    // 프로그램 번호
    var oNumber = opts.oNumber != null ? Number(opts.oNumber) : (L === 100 ? 3510 : 3500 + L);
    var comment = opts.comment || ('3.5mm Locking Screw ' + fmt(L).replace(/\.0$/, '') + 'mm');
    var dateStr = opts.date;
    if (!dateStr) {
      var d = new Date();
      dateStr = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }
    var headComment = '(' + dateStr + (opts.author ? ' / ' + opts.author : '') + ')';

    // ----- 나사 Z 목록: -2, 2, 8, 14, ... / 마지막 W = L-6-Z ∈ [3,8] -----
    var threadZs = [-2];
    var zLast = null;
    for (var c = 2; c <= L; c += 6) {
      var w = r2(L - 6 - c);
      if (w <= 8) { // 첫 후보로 W<=8이 되는 지점이 마지막 나사
        if (w >= 3) { threadZs.push(c); zLast = c; }
        // w<3이면 이 후보는 버림(10mm처럼 THREAD-END 없음)
        break;
      }
      threadZs.push(c);
    }
    var n = threadZs.length; // 나사 섹션 수 = 선삭 섹션 수

    // 마지막 나사 W
    var lastW = null;
    if (zLast != null) {
      lastW = r2(L - 6 - zLast);
      if (opts.lastW != null) {
        lastW = Number(opts.lastW);
        if (lastW < 3 || lastW > 8) warnings.push('lastW=' + lastW + '는 권장 범위 [3,8] 밖입니다.');
      }
    }
    var lastStyle = opts.lastThreadStyle || 'auto';

    // ----- 선삭 세그먼트 종점: 8, 14, ... (중간), 마지막은 F 병합 여부 -----
    // E_k = 8+6(k-1), k=1..n-1. 마지막 중간(k=n-1)은 F-E<0.5(또는 E>F)이면 F로 병합.
    var ends = [];
    var absorbed = false;
    for (var k = 1; k <= n - 1; k++) ends.push(8 + 6 * (k - 1));
    if (n === 1) { ends.push(F); absorbed = true; }
    else {
      var eLast = ends[ends.length - 1];
      if (F - eLast < 0.5 || quirks.absorb) { ends[ends.length - 1] = F; absorbed = true; }
    }

    var exSpace = !quirks.exNoSpace; // T400 섹션 "#4=10.8 (E X)" 공백 여부

    // ---------- 고정 헤더 ~ (START) ----------
    var lines = [
      '%',
      'O' + oNumber + '(' + comment + ')',
      '(F136 D6.0)'
    ];
    if (opts.qty != null) lines.push('(QTY ' + opts.qty + ')');
    lines.push(
      headComment,
      'G25',
      'G99G40M9',
      'M5',
      'M11',
      'G0Z10.0T0',
      'M200',
      'M20',
      '',
      'M10',
      'T100',
      'G0X21.0Z-0.5/M25',
      'M27',
      '',
      'M1',
      'GOTO1300',
      '(TOOLSETTING)',
      '(T200 TURNING 35, R0.2_JINSUNG)',
      '(T300 BACK TURNING 35, R0.2_JINSUNG)',
      '(T400 THREAD 3.5mm Locking Screw_JINSUNG)',
      '(T500 THREAD 80, R0.1_JINSUNG)',
      '(T3200 STS E/M D4.0X12mm_JJ)',
      '',
      'G18',
      'T200',
      'G0X7.0Z0.0M3S3000T2',
      'G1X-1.0F0.02',
      'G1X5.5',
      'G1W1.5F0.012',
      'G1X6.1W0.5',
      'G0X50.0',
      'G0T0',
      'M5',
      'M1',
      '',
      '(CUTTING)',
      'T200',
      'G0X7.0Z0.0M3S3000T2',
      'G1X-1.0F0.02',
      'G1X6.1',
      'G0X50.0',
      'G0T0',
      'M5',
      'M1',
      '',
      'T300',
      'G0X7.0Z2.0M3S2500T3',
      'G1X4.5F0.01',
      'G1W1.5',
      'G1X6.1F0.03',
      'G0X50.0',
      'G0T0',
      'M5',
      'M1',
      '',
      'N1(THREAD 3.5)',
      'T400',
      'G0X7.0Z5.0M3S1500T4',
      'G1X5.3F0.01',
      'G4U0.5',
      'G1X6.1F0.03',
      'G0X50.0',
      'G0T0',
      'M5',
      'M1',
      '',
      'N1(THREAD 60, R0.1)',
      'T500',
      'G0X7.0Z7.0M3S1500T5',
      'G1X5.5F0.01',
      'G4U0.5',
      'G1X6.1F0.03',
      'G0X50.0',
      'G0T0',
      'M5',
      '',
      'M1',
      '',
      '(STS E/M D4.0X12mm)',
      'T3200',
      'M8',
      'G0Y7.0X12.0Z12.0C0.0M36S3500T22',
      'M6',
      '',
      'G0Y3.5',
      'G1X-9.0F0.01',
      'G0Y7.0',
      'G0X12.0',
      '',
      'M7',
      'G0C180.0',
      'M6',
      '',
      'G0Y3.5',
      'G1X-9.0F0.01',
      'G0Y7.0',
      'G0Z-3.0',
      '',
      'M7',
      'G0Y40.0',
      'M38',
      'G0T0',
      'M9',
      'M1',
      'N1300',
      '',
      '(START)',
      ''
    );

    // ---------- 섹션 빌더 ----------
    var e1 = ends[0]; // TURNING-1 종점 (8.0 또는 F)
    var t1EndsAtF = (n === 1) || (absorbed && n === 2);

    function turning1() {
      var lim = t1EndsAtF ? r2(F - 0.04) : r2(e1 - 0.1);
      return [
        'G18',
        'N1(TURNING-1)',
        'T200',
        'G0X7.0Z0.0M3S3000T2',
        'G1X-1.0F0.02',
        'G1X-0.4',
        'G2X2.25Z0.95R1.4F0.012',
        'G1X3.5Z2.66',
        '/M1001',
        ''
      ].concat(peckLoop(2.66, lim), [
        'G1Z' + fmt(e1) + 'F0.02',
        'G1X5.5W2.93',
        'G1X6.1W0.5',
        'G0X50.0',
        '/M1002',
        'G0T0',
        'M5'
      ]);
    }

    function turning1Burr() {
      var L2 = [
        'G18',
        'N1(TURNING-1 BURR)',
        'T200',
        'G0X7.0Z0.0M3S3000T2',
        'G1X-1.0F0.05',
        'G1X-0.4',
        'G2X2.25Z0.95R1.4',
        'G1X3.5Z2.66',
        'G1Z' + fmt(e1)
      ];
      if (t1EndsAtF) L2.push('G1X5.5W2.93');
      L2.push('G1X6.1W0.5', 'G0X50.0', 'G0T0', 'M5');
      return L2;
    }

    function thread1(burr) {
      return threadSection({
        header: burr ? 'N2(THREAD-1 BURR)' : 'N1(THREAD-1)',
        tool: 'T400', sx: '11.6', ex: '10.8', exSpace: exSpace,
        z: -2, blocks: [th1Block(0), th1Block(180000)],
        burr: burr, dwell: dwell
      });
    }

    // 중간 선삭 TURNING-k (k=2..n-1)
    function turningK(k) {
      var end = ends[k - 1];
      var prevEnd = ends[k - 2];
      var isLastMid = (k === n - 1);
      var lim = (isLastMid && absorbed) ? r2(F - 0.04) : r2(end - 0.1);
      var start = r2(prevEnd - 0.1);
      var L2 = ['N1(TURNING-' + k + ')', 'T200'];
      if (k === 2) {
        L2.push('G0X7.0Z' + fmt(start) + 'M3S3000T2', 'G1X3.8F0.1', 'G1X3.5F0.02', '/M1001', '');
      } else {
        L2.push('G0X7.0Z' + fmt(threadZs[k - 2]) + 'M3S3000T2', 'G1X3.8F0.1', 'G1X3.5F0.02',
          'G1Z' + fmt(start), '/M1001', '');
      }
      var tail = ['G1Z' + fmt(end) + 'F0.02'];
      if (isLastMid && absorbed && quirks.midTaper) tail.push('G1X5.5W2.93');
      tail.push('G1X6.1W0.5', 'G0X50.0', '/M1002', 'G0T0');
      return L2.concat(peckLoop(start, lim), tail);
    }

    function threadK(k, burr) {
      return threadSection({
        header: 'N2(THREAD-' + k + ')',
        tool: 'T400', sx: '11.6', ex: '10.8', exSpace: exSpace,
        z: threadZs[k - 1], blocks: [th2Block(0), th2Block(180000)],
        burr: !!burr, dwell: dwell,
        noBlockGap: quirks.noBlankThreadK === k
      });
    }

    function turningEnd() {
      if (n === 2) {
        // 짧은 사이즈(12~16mm): 펙 루프 없이 재가공
        return [
          'N1(TURNING-END)',
          'T200',
          'G0X7.0Z7.0M3S3000T2',
          'G1X3.8F0.1',
          'G1X3.5F0.02',
          'G1Z7.5F0.05',
          '/M1001',
          'G1Z' + fmt(F) + 'F0.02',
          'G1X5.5W2.93',
          'G1X6.1W0.5',
          'G0X50.0',
          '/M1002',
          'G0T0'
        ];
      }
      var g0z = threadZs[n - 2]; // 마지막 나사 Z - 6
      var app;
      if (absorbed) app = r2(ends[n - 3] - 0.1);      // 마지막 중간 세그먼트 재실행
      else if (n === 3) app = 7.9;                    // 20/22mm 계열
      else app = r2(ends[n - 2] - 0.1);
      if (quirks.endApp != null) app = quirks.endApp;
      return [
        'N1(TURNING-END)',
        'T200',
        'G0X7.0Z' + fmt(g0z) + 'M3S3000T2',
        'G1X3.8F0.1',
        'G1X3.5F0.02',
        'G1Z' + fmt(app) + 'F0.05',
        '/M1001',
        ''
      ].concat(peckLoop(app, r2(F - 0.04)), [
        'G1Z' + fmt(F) + 'F0.02',
        'G1X5.5W2.93',
        'G1X6.1W0.5',
        'G0X50.0',
        '/M1002',
        'G0T0'
      ]);
    }

    function threadEnd() {
      var useTh1 = (lastStyle === 'th1');
      var blocks = useTh1
        ? [th1Block(0), th1Block(180000)]
        : [thEndBlock(0, lastW), thEndBlock(180000, lastW)];
      return threadSection({
        header: 'N2(THREAD-END)',
        tool: 'T400', sx: '11.6', ex: '10.8', exSpace: exSpace,
        z: zLast, blocks: blocks,
        burr: false, dwell: dwell
      });
    }

    function turningLocking() {
      var L2 = ['N8(TURNING-LOCKING)', 'T200'];
      if (n <= 2) {
        L2.push('G0X7.0Z' + fmt(F) + 'M3S3000T2', 'G1X3.8F0.1', 'G1X3.5F0.02', '/M1001');
      } else {
        var g0z = quirks.lockG0Z != null ? quirks.lockG0Z : threadZs[n - 1];
        L2.push('G0X7.0Z' + fmt(g0z) + 'M3S3000T2', 'G1X3.8F0.1', 'G1X3.5F0.02',
          'G1Z' + fmt(F), '/M1001');
      }
      L2.push('G1X5.5W2.93', 'G1W0.5', 'G1X6.1W0.5', 'G0X50.0', '/M1002', 'G0T0', 'M5');
      return L2;
    }

    function threadLocking(burr) {
      return threadSection({
        header: burr ? 'N1(THREAD-LOCKING BURR)' : 'N1(THREAD-LOCKING)',
        tool: 'T500', sx: '7.65', ex: '6.85', exSpace: true,
        z: lockZ, blocks: [lockBlock()],
        burr: !!burr, dwell: dwell
      });
    }

    function turningLockingBurr() {
      return [
        'N8(TURNING-LOCKING BURR)',
        'T200',
        'G0X7.0Z' + fmt(F) + 'M3S3000T2',
        'G1X3.8F0.1',
        'G1X3.5F0.05',
        'G1X5.5W2.93',
        'G1W0.5',
        'G1X6.1W0.5',
        'G0X50.0',
        'G0T0',
        'M5'
      ];
    }

    function backTurning() {
      return [
        'N3(BACK TURNING)',
        'T300',
        'G0X7.0Z' + fmt(backZ) + 'M3S2500T3',
        'G1X5.5F0.01',
        '/M1001',
        'G1W0.77F0.01',
        'G2X2.6W0.73R1.8',
        'G1X2.4',
        'G1X6.1F0.025',
        'G0X50.0',
        '/M1002',
        'G0T0',
        'M5'
      ];
    }

    function cutOff() {
      return [
        'M1',
        'N77(CUT-OFF)',
        'T100',
        'M700',
        'G0X7.0Z' + fmt(cutZ) + 'M3S500T1',
        'M82',
        'M40',
        '',
        'M3S2500',
        'G1X-1.5F0.01',
        '',
        'M41',
        'M83',
        '',
        'M80',
        '/G0X7.0W-0.5',
        '/G0W1.0',
        '/M98P7000',
        'M81',
        'M99'
      ];
    }

    function n0Block() {
      return ['N0', 'M5', 'M11', 'G0T0', 'G28W0', 'G0W' + fmt(n0W), 'T100', 'G120Z0', 'M99'];
    }

    function n100Block() {
      return [
        'N100(SHORT-CUT PROGRAM)',
        'M9',
        'G99M10',
        'M3S2500',
        'T200',
        'T100',
        '/M25',
        'G0X7.0',
        'G0W0.5',
        'G99G1X-1.5F0.01',
        'M5',
        'M00',
        'M99P100',
        '%'
      ];
    }

    // ---------- 조립 (섹션 사이 빈 줄 1개) ----------
    var sections = [];
    sections.push(turning1());
    sections.push(thread1(false));
    sections.push(emSection(false));
    sections.push(turning1Burr());
    sections.push(thread1(true));
    sections.push(emSection(true));
    sections.push(turning1Burr());
    sections.push(thread1(true));
    for (var kk = 2; kk <= n - 1; kk++) {
      sections.push(turningK(kk));
      sections.push(threadK(kk, false));
    }
    if (n >= 2) {
      sections.push(turningEnd());
      sections.push(threadEnd());
    }
    sections.push(turningLocking());
    sections.push(threadLocking(false));
    sections.push(turningLockingBurr());
    sections.push(threadLocking(true));
    sections.push(backTurning());
    sections.push(cutOff());
    sections.push(n0Block());
    sections.push(n100Block());

    for (var s = 0; s < sections.length; s++) {
      lines = lines.concat(sections[s]);
      if (s < sections.length - 1) lines.push('');
    }

    var text = lines.join('\r\n') + '\r\n';

    return {
      filename: 'O' + oNumber,
      text: text,
      meta: {
        oNumber: oNumber,
        lastW: lastW,
        // 선삭 종점 목록 (TURNING-1..중간..최종 L-3.56)
        segments: (ends[ends.length - 1] === F ? ends : ends.concat([F])).map(r2),
        threadZs: threadZs.map(r2)
      },
      warnings: warnings
    };
  }

  return { generate: generate, _fmt: fmt };
});
