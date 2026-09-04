/*
 * interpolate.js — 범용 사이즈 보간 엔진 (Universal size interpolation engine)
 *
 * 아이디어: NC 프로그램 값이 길이 L 에 대해 선형으로 변한다고 가정.
 *   두 점(최소 L1의 값 vA, 최대 L2의 값 vB)으로 기울기/절편을 구해 임의 L 값을 계산.
 *     slope = (vB - vA) / (L2 - L1)
 *     value(L) = vA + slope * (L - L1)
 *
 * UMD: 브라우저 전역 NCInterp + Node module.exports 겸용.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;      // Node
  }
  if (typeof root !== 'undefined') {
    root.NCInterp = api;       // Browser (window.NCInterp)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 숫자 토큰: 선택적 음수부호 + 정수 + 선택적 소수부.  예) 12, -8.0, 3.5, 180000
  var NUM_RE = /-?\d+(?:\.\d+)?/g;
  var EPS = 1e-6;

  // ---------------------------------------------------------------------------
  // 유틸
  // ---------------------------------------------------------------------------

  function splitLines(text) {
    // \r\n / \r / \n 모두 처리, 뒤쪽 공백줄은 유지하되 끝의 완전 빈 줄 하나만 정리
    return String(text).replace(/\r\n?/g, '\n').split('\n');
  }

  function decimalsOf(raw) {
    var dot = raw.indexOf('.');
    return dot === -1 ? 0 : (raw.length - dot - 1);
  }

  // 한 줄에서 숫자 목록(raw 문자열 + 값)을 뽑는다
  function extractNums(line) {
    var out = [];
    var m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(line)) !== null) {
      out.push({ raw: m[0], value: parseFloat(m[0]) });
    }
    return out;
  }

  // 숫자를 #로 치환한 "템플릿" 문자열
  function templateOf(line) {
    NUM_RE.lastIndex = 0;
    return line.replace(NUM_RE, '#');
  }

  // 값 v 를 dec 소수자리로 반올림하여 문자열로
  function formatNum(v, dec) {
    if (dec <= 0) {
      return String(Math.round(v));
    }
    var f = Math.pow(10, dec);
    var r = Math.round(v * f) / f;
    return r.toFixed(dec);
  }

  // 사람이 읽는 공식 문자열 만들기
  function formulaString(slope, intercept) {
    if (Math.abs(slope) < EPS) {
      // 상수
      return String(roundTo(intercept, 3));
    }
    var c = roundTo(intercept, 2);
    var cPart;
    if (Math.abs(c) < EPS) cPart = '';
    else if (c < 0) cPart = ' - ' + Math.abs(c);
    else cPart = ' + ' + c;

    if (Math.abs(slope - 1) < EPS) return 'L' + cPart;
    if (Math.abs(slope + 1) < EPS) return '-L' + cPart;
    return roundTo(slope, 3) + '·L' + cPart; // a·L + c
  }

  function roundTo(v, dec) {
    var f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  }

  // ---------------------------------------------------------------------------
  // LCS 정렬 (템플릿 시퀀스 기준)
  // ---------------------------------------------------------------------------
  // 반환: 정렬된 스텝 배열. 각 스텝은
  //   { kind:'both', aIndex, bIndex } | { kind:'a', aIndex } | { kind:'b', bIndex }
  function alignByTemplate(tmplA, tmplB) {
    var n = tmplA.length, m = tmplB.length;
    // DP 표 (n+1)x(m+1)
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) {
      dp[i] = new Array(m + 1).fill(0);
    }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        if (tmplA[i] === tmplB[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }
    var steps = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (tmplA[i] === tmplB[j]) {
        steps.push({ kind: 'both', aIndex: i, bIndex: j });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        steps.push({ kind: 'a', aIndex: i });
        i++;
      } else {
        steps.push({ kind: 'b', bIndex: j });
        j++;
      }
    }
    while (i < n) { steps.push({ kind: 'a', aIndex: i }); i++; }
    while (j < m) { steps.push({ kind: 'b', bIndex: j }); j++; }
    return steps;
  }

  // ---------------------------------------------------------------------------
  // learn
  // ---------------------------------------------------------------------------
  function learn(textA, lenA, textB, lenB) {
    var linesA = splitLines(textA);
    var linesB = splitLines(textB);
    var tmplA = linesA.map(templateOf);
    var tmplB = linesB.map(templateOf);

    var steps = alignByTemplate(tmplA, tmplB);

    var skeleton = [];
    var warnings = [];
    var rules = [];
    var seenFormula = {};
    var unmatched = 0;

    var dL = (lenB - lenA);
    if (dL === 0) {
      warnings.push('두 프로그램의 길이(lenA, lenB)가 같습니다. 기울기를 계산할 수 없어 값이 상수로 처리됩니다.');
    }

    for (var s = 0; s < steps.length; s++) {
      var st = steps[s];

      if (st.kind === 'a') {
        // A 에만 있는 줄 (구조 차이) — A 텍스트를 그대로 유지
        skeleton.push({ type: 'const', text: linesA[st.aIndex] });
        unmatched++;
        warnings.push('구조 차이: A(' + lenA + ')에만 있는 줄 → "' + linesA[st.aIndex].trim() + '"');
        continue;
      }
      if (st.kind === 'b') {
        skeleton.push({ type: 'const', text: linesB[st.bIndex] });
        unmatched++;
        warnings.push('구조 차이: B(' + lenB + ')에만 있는 줄 → "' + linesB[st.bIndex].trim() + '"');
        continue;
      }

      // both: 템플릿 동일. 숫자 위치별 비교
      var lineA = linesA[st.aIndex];
      var lineB = linesB[st.bIndex];
      var numsA = extractNums(lineA);
      var numsB = extractNums(lineB);

      // 안전장치: 같은 템플릿이면 숫자 개수도 같아야 함
      if (numsA.length !== numsB.length) {
        skeleton.push({ type: 'const', text: lineA });
        warnings.push('숫자 개수 불일치(줄 스킵): "' + lineA.trim() + '"');
        continue;
      }

      var anyVar = false;
      var nums = [];
      for (var k = 0; k < numsA.length; k++) {
        var vA = numsA[k].value, vB = numsB[k].value;
        var same = (vA === vB);
        var dec = Math.max(decimalsOf(numsA[k].raw), decimalsOf(numsB[k].raw));
        if (same) {
          nums.push({ const: true, raw: numsA[k].raw });
        } else {
          anyVar = true;
          var slope = dL === 0 ? 0 : (vB - vA) / dL;
          var intercept = vA - slope * lenA;
          var formula = formulaString(slope, intercept);
          nums.push({
            const: false,
            raw: numsA[k].raw,
            aVal: vA, bVal: vB,
            slope: slope, intercept: intercept,
            decimals: dec,
            formula: formula
          });
          // 사람이 읽는 규칙 목록 (중복 공식 억제)
          var key = vA + '>' + vB + '|' + formula;
          if (!seenFormula[key]) {
            seenFormula[key] = true;
            rules.push(vA + ' → ' + vB + ' : 값 ≈ ' + formula);
          }
        }
      }

      if (anyVar) {
        skeleton.push({ type: 'var', text: lineA, nums: nums });
      } else {
        skeleton.push({ type: 'const', text: lineA });
      }
    }

    var structureMatch = (unmatched === 0) && (linesA.length === linesB.length);

    return {
      lenA: lenA,
      lenB: lenB,
      skeleton: skeleton,
      structureMatch: structureMatch,
      rules: rules,
      warnings: warnings
    };
  }

  // ---------------------------------------------------------------------------
  // generate
  // ---------------------------------------------------------------------------
  function generate(model, targetLen) {
    var warnings = [];
    if (!model || !model.skeleton) {
      return { text: '', rules: [], warnings: ['잘못된 모델입니다.'], meta: {} };
    }
    if (!model.structureMatch) {
      warnings.push('두 프로그램의 구조(공정 수)가 달라 정확한 보간이 어렵습니다. ' +
        '구조가 같은 사이즈 2개를 올리거나 중간 샘플을 추가하세요.');
    }

    var outLines = [];
    for (var i = 0; i < model.skeleton.length; i++) {
      var e = model.skeleton[i];
      if (e.type === 'const') {
        outLines.push(e.text);
        continue;
      }
      // var: e.text 의 숫자들을 순서대로 치환
      var idx = 0;
      var line = e.nums;
      var out = e.text.replace(NUM_RE, function (match) {
        var spec = line[idx++];
        if (!spec) return match;
        if (spec.const) return spec.raw;
        var v = spec.slope * targetLen + spec.intercept;
        return formatNum(v, spec.decimals);
      });
      outLines.push(out);
    }

    return {
      text: outLines.join('\n'),
      rules: model.rules,
      warnings: warnings.concat(model.warnings),
      meta: {
        lenA: model.lenA,
        lenB: model.lenB,
        targetLen: targetLen,
        structureMatch: model.structureMatch,
        lineCount: outLines.length
      }
    };
  }

  return {
    learn: learn,
    generate: generate,
    // 테스트/디버그용 내부 함수 노출
    _internal: {
      templateOf: templateOf,
      extractNums: extractNums,
      alignByTemplate: alignByTemplate,
      formulaString: formulaString,
      formatNum: formatNum
    }
  };
});
