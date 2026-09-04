/* 매크로 변환 엔진 — convert_r.js(검증된 로직)의 브라우저 이식판
   20R-IV 원본 프로그램의 나사 패스 리스트/긴 선삭 이송을 매크로(WHILE 루프)로 변환.
   서브프로그램은 subs 맵({ "0120": [lines...] })으로 전달받아 인라인. */
(function (root) {
  'use strict';

  function cleanSubLines(text) {
    const res = [];
    for (let line of text.split('\n')) {
      line = line.replace(/\r/g, '').replace(/\s+$/, '');
      const l = line.trim();
      if (!l) continue;
      if (l === '%') continue;
      if (l.startsWith('O') && l.includes('(')) continue;
      if (l === 'M99') continue;
      res.push(line);
    }
    return res;
  }

  function convertTurningBlock(lines, isBurr, opts) {
    const out = [];
    let lastZ = null;
    for (let l of lines) {
      const lTrim = l.trim();
      const mZ = l.match(/Z([\d.\-]+)/);
      const currentZ = mZ ? parseFloat(mZ[1]) : lastZ;
      const isLongZCut = /^G1\s*Z[\d.\-]+(?:\s*F[\d.]+)?$/.test(lTrim) && !lTrim.includes('X');

      // 이송이 F0.05(이상)인 빠른 이동/버 제거 이송은 칩브레이크 펙 루프를 만들지 않고 원본 유지
      const fThis = lTrim.match(/F([\d.]+)/);
      const isFastFeed = fThis && parseFloat(fThis[1]) >= 0.05;

      if (isLongZCut && !isFastFeed) {
        if (isBurr) {
          out.push(lTrim.replace(/F[\d.]+/, '') + 'F0.05');
        } else {
          const endZStr = mZ[1];
          let startZStr = lastZ !== null ? String(lastZ) : '0.0';
          if (!startZStr.includes('.')) startZStr += '.0';
          const valStart = parseFloat(startZStr);
          const valEnd = parseFloat(endZStr);
          if (Math.abs(valEnd - valStart) > 0.001) {
            const isPos = valEnd > valStart;
            const cmp = isPos ? 'LT' : 'GT';
            const step = isPos ? '+0.05' : '-0.05';
            const fMatch = lTrim.match(/(F[\d.]+)/);
            // 20J 스타일: 원본에 이송(F)이 없으면 펙 루프 기본값 F0.02를 채운다
            const feedStr = fMatch ? fMatch[1] : (opts && opts.pegFeed ? opts.pegFeed : 'F0.02');
            let loopEnd = isPos ? valEnd - 0.04 : valEnd + 0.04;
            loopEnd = parseFloat(loopEnd.toFixed(3));
            const wRetract = isPos ? '-0.05' : '0.05';
            const wReturn = isPos ? '0.045' : '-0.045';
            out.push('');
            out.push('#1=' + startZStr);
            out.push('WHILE[#1' + cmp + loopEnd + ']DO1');
            out.push('#1=#1' + step);
            out.push('');
            out.push('G1Z#1' + feedStr);
            out.push('G1W' + wRetract + 'F0.1');
            out.push('G1W' + wReturn);
            out.push('');
            out.push('END1');
            out.push('');
            out.push('G1Z' + endZStr + feedStr);
          } else {
            out.push(l);
          }
        }
      } else {
        if (isBurr && lTrim.startsWith('G1') && (lTrim.includes('Z') || lTrim.includes('W')) && lTrim.includes('F')) {
          l = l.replace(/F[\d.]+/, 'F0.05');
        }
        out.push(l);
      }
      lastZ = currentZ;
    }
    return out;
  }

  function convertThreadBlock(tLines, subs, isBurrName, opts, report) {
    let zValLineIdx = -1, xStart = '', zVal = '', stPart = '';
    for (let i = 0; i < tLines.length; i++) {
      const l = tLines[i];
      if (l.includes('G0X') && l.includes('Z') && l.includes('M3S')) {
        zValLineIdx = i;
        const m = l.match(/G0X([\d.\-]+)Z([\d.\-]+)(M3S.*)/);
        if (m) { xStart = m[1]; zVal = m[2]; stPart = m[3]; }
        break;
      }
    }

    const mxList = [];
    let subName = null;
    for (let i = 0; i < tLines.length; i++) {
      const l = tLines[i];
      const m = l.match(/M98P(\d+)/);
      if (m) subName = m[1];
      const mX = l.match(/G0X([\d.\-]+)/);
      if (mX && !l.includes('50.0') && !l.includes('30.0') && !l.includes('Z') && zValLineIdx !== -1 && i > zValLineIdx) {
        mxList.push(parseFloat(mX[1]));
      }
    }
    if (mxList.length === 0) return tLines;

    let minVal = Infinity;
    for (const v of mxList) if (v < minVal) minVal = v;
    let xEnd = String(minVal);
    if (!xEnd.includes('.')) xEnd += '.0';
    const maxPassX = Math.max.apply(null, mxList);
    const isBurr = isBurrName || (maxPassX - minVal) < 0.1;

    // 서브프로그램 찾기 (O0120 / 0120 양쪽 허용)
    let subLines = [];
    if (subName) {
      const key = Object.keys(subs).find(k =>
        k === subName || k === 'O' + subName || k.replace(/^O/, '') === subName.replace(/^0*/, '') ||
        k.replace(/^O0*/, '') === subName.replace(/^0*/, ''));
      if (key) {
        subLines = subs[key];
        report.subsUsed.add(key.startsWith('O') ? key : 'O' + key);
      } else {
        report.missingSubs.add('O' + subName);
      }
    }

    const out = [];
    out.push(tLines[0]);
    for (let i = 1; i < zValLineIdx; i++) out.push(tLines[i]);

    out.push('#2=0.05 ');
    out.push('#3=' + xStart + ' (S X)');
    out.push('#4=' + xEnd + '(E X)');
    out.push('#5=' + zVal + ' (Z)');
    out.push('#1=#4+0.05');
    out.push('');

    const hasG4 = tLines.some(l => l.includes('G4U0.5'));
    out.push('G0X#3Z#5' + stPart.trim() + ' ');
    if (hasG4 || opts.addDwell) out.push('G4U0.5 ');

    out.push('WHILE[#3GT#4]DO1');
    out.push('#3=#3-#2');
    out.push('');
    out.push('IF[#3LE#4]THEN#3=#4');
    out.push('IF[#3LE#1]THEN#2=0.01');
    out.push(' ');
    out.push('G0U-#2 ');
    out.push('');

    const formattedSub = subLines.map(sl => sl.trim());
    if (!isBurr) {
      out.push(...formattedSub);
      out.push('');
      out.push('END1 ');
    } else {
      out.push('END1 ');
      out.push('');
      out.push(...formattedSub);
    }
    out.push('');

    let captureExit = false;
    for (const l of tLines) {
      if (l.includes('G0X50.0') || l.includes('G0X30.0')) captureExit = true;
      if (captureExit) {
        out.push(l.trim());
        if (l.trim() === 'M5' || l.trim() === 'M1') break;
      }
    }
    if (!captureExit) { out.push('G0T0 '); out.push('M5 '); }
    report.threadBlocks++;
    return out;
  }

  /* 메인 변환. mainText: 원본 프로그램, subsMap: {이름: 내용텍스트},
     opts: { addDwell: true(드웰 없으면 추가), authorTag: 'AI' } */
  function convertProgram(mainText, subsMap, opts) {
    opts = Object.assign({ addDwell: true, authorTag: 'MACRO' }, opts || {});
    const subs = {};
    for (const name of Object.keys(subsMap || {})) subs[name] = cleanSubLines(subsMap[name]);

    const report = { threadBlocks: 0, turningLoops: 0, subsUsed: new Set(), missingSubs: new Set(), warnings: [] };
    const lines = mainText.replace(/\r/g, '').split('\n');
    const outLines = [];
    let inStart = false, inThread = false, inTurning = false;
    let blockLines = [];
    const blockNameTracker = {};
    let currentBlockIsBurr = false;

    const today = new Date();
    const dateStr = today.getFullYear() + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' + String(today.getDate()).padStart(2, '0');

    for (let line of lines) {
      const stripped = line.trim();

      if (stripped.includes('(202') && stripped.includes(' / ') && !inStart) {
        line = line.replace(/\(202\d\.\d{2}\.\d{2} \/ [^)]+\)/, '(' + dateStr + ' / ' + opts.authorTag + ')');
      }
      if (stripped.includes('(START)')) { inStart = true; outLines.push(line); continue; }
      if (!inStart) { outLines.push(line); continue; }

      const blockMatch = stripped.match(/^N\d+\(([^)]+)\)/);
      if (!inThread && !inTurning && blockMatch) {
        const title = blockMatch[1];
        currentBlockIsBurr = title.includes('BURR');
        if (!currentBlockIsBurr && blockNameTracker[title]) {
          currentBlockIsBurr = true;
          line = line.replace(title, title + ' BURR');
        }
        if (title.includes('THREAD') || title.includes('TURNING')) blockNameTracker[title] = true;
        if (title.includes('THREAD')) { inThread = true; blockLines = [line]; continue; }
        if (title.includes('TURNING')) { inTurning = true; blockLines = [line]; continue; }
      }

      if (inThread) {
        blockLines.push(line);
        if (stripped === 'M5') {
          inThread = false;
          outLines.push(...convertThreadBlock(blockLines, subs, currentBlockIsBurr, opts, report));
        }
        continue;
      }
      if (inTurning) {
        blockLines.push(line);
        if (stripped === 'M5') {
          inTurning = false;
          const before = blockLines.join('\n');
          const conv = convertTurningBlock(blockLines, currentBlockIsBurr, opts);
          if (conv.join('\n') !== before) report.turningLoops++;
          outLines.push(...conv);
        }
        continue;
      }
      outLines.push(line);
    }

    if (inThread || inTurning) report.warnings.push('마지막 블록이 M5로 닫히지 않아 일부가 변환되지 않았을 수 있습니다.');
    if (report.missingSubs.size) {
      report.warnings.push('서브프로그램을 찾지 못해 인라인하지 못했습니다: ' + [...report.missingSubs].join(', ') + ' — 해당 파일을 추가로 올려주세요.');
    }
    return {
      text: outLines.join('\n'),
      report: {
        threadBlocks: report.threadBlocks,
        turningLoops: report.turningLoops,
        subsUsed: [...report.subsUsed],
        missingSubs: [...report.missingSubs],
        warnings: report.warnings
      }
    };
  }

  root.NCConvert = { convertProgram: convertProgram };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NCConvert;
})(typeof self !== 'undefined' ? self : globalThis);
