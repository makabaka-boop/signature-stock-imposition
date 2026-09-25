import { describe, expect, it } from 'vitest';
import {
  cellToJson,
  impose,
  impositionToJson,
  locatePage,
  ImpositionError,
} from './imposition';
import type { Binding, Flip, Imposition, PageCell, Slot } from './types';

// 一行金样 = 一张实体纸的 [frontLeft, frontRight, backLeft, backRight]
type Row = [number | 'BLANK', number | 'BLANK', number | 'BLANK', number | 'BLANK'];

const SLOT_ORDER: Slot[] = [
  'frontLeft',
  'frontRight',
  'backLeft',
  'backRight',
];

function rowsOf(result: Imposition): Row[] {
  return result.sheets.map((s) =>
    SLOT_ORDER.map((slot) => cellToJson(s[slot])) as Row,
  );
}

const ALL_BINDINGS: Binding[] = ['left', 'right'];
const ALL_FLIPS: Flip[] = ['long', 'short'];
const ALL_SIZES = [4, 8, 12, 16, 20, 24, 28, 32];

describe('金样：左订长边基准', () => {
  it('4 页（单帖满帖）', () => {
    const r = impose({ bodyPages: 4, signatureSize: 4, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([[4, 1, 2, 3]]);
  });

  it('8 页（单帖满帖，外层包内层）', () => {
    const r = impose({ bodyPages: 8, signatureSize: 8, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([
      [8, 1, 2, 7],
      [6, 3, 4, 5],
    ]);
  });

  it('12 页（单帖满帖）', () => {
    const r = impose({ bodyPages: 12, signatureSize: 12, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([
      [12, 1, 2, 11],
      [10, 3, 4, 9],
      [8, 5, 6, 7],
    ]);
  });

  it('12 页 / signatureSize=4：三个独立满帖，每帖重新起算', () => {
    const r = impose({ bodyPages: 12, signatureSize: 4, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([
      [4, 1, 2, 3],
      [8, 5, 6, 7],
      [12, 9, 10, 11],
    ]);
    expect(r.signatureCount).toBe(3);
  });

  it('12 页 / signatureSize=8：第一帖满，第二帖独立补 4 个 BLANK 到满帖', () => {
    const r = impose({ bodyPages: 12, signatureSize: 8, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([
      [8, 1, 2, 7],
      [6, 3, 4, 5],
      ['BLANK', 9, 10, 'BLANK'],
      ['BLANK', 11, 12, 'BLANK'],
    ]);
    expect(r.blankCount).toBe(4);
  });

  it('5 页 / signatureSize=4：第一帖满 4 页，第二帖独立补 3 个 BLANK', () => {
    const r = impose({ bodyPages: 5, signatureSize: 4, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([
      [4, 1, 2, 3],
      ['BLANK', 5, 'BLANK', 'BLANK'],
    ]);
    expect(r.signatureCount).toBe(2);
    expect(r.blankCount).toBe(3);
  });
});

describe('金样：4 页四种模式（右订交换每面左右；短边再交换背面左右）', () => {
  const base = { bodyPages: 4, signatureSize: 4 };

  it('左订长边', () => {
    expect(rowsOf(impose({ ...base, binding: 'left', flip: 'long' }))).toEqual([
      [4, 1, 2, 3],
    ]);
  });

  it('右订长边：正面与背面均左右交换', () => {
    expect(rowsOf(impose({ ...base, binding: 'right', flip: 'long' }))).toEqual([
      [1, 4, 3, 2],
    ]);
  });

  it('左订短边：只交换背面', () => {
    expect(rowsOf(impose({ ...base, binding: 'left', flip: 'short' }))).toEqual([
      [4, 1, 3, 2],
    ]);
  });

  it('右订短边：每面交换后背面再交换（背面与左订长边一致）', () => {
    expect(rowsOf(impose({ ...base, binding: 'right', flip: 'short' }))).toEqual([
      [1, 4, 2, 3],
    ]);
  });
});

describe('金样：8 页 / signatureSize=8 四种模式', () => {
  const base = { bodyPages: 8, signatureSize: 8 };

  it('右订长边', () => {
    expect(rowsOf(impose({ ...base, binding: 'right', flip: 'long' }))).toEqual([
      [1, 8, 7, 2],
      [3, 6, 5, 4],
    ]);
  });

  it('左订短边', () => {
    expect(rowsOf(impose({ ...base, binding: 'left', flip: 'short' }))).toEqual([
      [8, 1, 7, 2],
      [6, 3, 5, 4],
    ]);
  });

  it('右订短边', () => {
    expect(rowsOf(impose({ ...base, binding: 'right', flip: 'short' }))).toEqual([
      [1, 8, 2, 7],
      [3, 6, 4, 5],
    ]);
  });
});

describe('模式变换性质', () => {
  it('右订长边 = 左订长边交换每一张纸的正面与背面左右槽位', () => {
    for (const n of [1, 4, 5, 8, 9, 12, 13, 16, 31, 64, 100]) {
      for (const size of ALL_SIZES) {
        if (size > 32 || n > 512) continue;
        const left = impose({ bodyPages: n, signatureSize: size, binding: 'left', flip: 'long' });
        const right = impose({ bodyPages: n, signatureSize: size, binding: 'right', flip: 'long' });
        right.sheets.forEach((sheet, i) => {
          const src = left.sheets[i]!;
          expect(sheet.frontLeft).toEqual(src.frontRight);
          expect(sheet.frontRight).toEqual(src.frontLeft);
          expect(sheet.backLeft).toEqual(src.backRight);
          expect(sheet.backRight).toEqual(src.backLeft);
        });
      }
    }
  });

  it('短边翻转 = 同装订长边结果再交换背面左右，正面完全不变', () => {
    for (const binding of ALL_BINDINGS) {
      for (const n of [1, 3, 4, 7, 8, 12, 17, 32, 33, 50]) {
        for (const size of ALL_SIZES) {
          const long = impose({ bodyPages: n, signatureSize: size, binding, flip: 'long' });
          const short = impose({ bodyPages: n, signatureSize: size, binding, flip: 'short' });
          short.sheets.forEach((sheet, i) => {
            const src = long.sheets[i]!;
            expect(sheet.frontLeft).toEqual(src.frontLeft);
            expect(sheet.frontRight).toEqual(src.frontRight);
            expect(sheet.backLeft).toEqual(src.backRight);
            expect(sheet.backRight).toEqual(src.backLeft);
          });
        }
      }
    }
  });

  it('任何模式下第 1 页与第二帖首页都在各自帖外第一张纸上', () => {
    for (const binding of ALL_BINDINGS) {
      for (const flip of ALL_FLIPS) {
        const r = impose({ bodyPages: 17, signatureSize: 16, binding, flip });
        const first = locatePage(r, 1)!;
        expect(first.signature).toBe(1);
        expect(first.sheetInSignature).toBe(1);
        // 第二帖第一张纸上必须能找到第 17 页（该帖首页）
        const p17 = locatePage(r, 17)!;
        expect(p17.signature).toBe(2);
        expect(p17.sheetInSignature).toBe(1);
      }
    }
  });
});

describe('正反向互查性质（表格 ↔ 反查同一映射）', () => {
  it('每个正文页恰好出现一次，且 pages/槽位/纸张编号一致', () => {
    for (let n = 1; n <= 40; n += 1) {
      for (const size of ALL_SIZES) {
        for (const binding of ALL_BINDINGS) {
          for (const flip of ALL_FLIPS) {
            const r = impose({ bodyPages: n, signatureSize: size, binding, flip });
            const seen = new Set<number>();
            r.sheets.forEach((sheet) => {
              SLOT_ORDER.forEach((slot) => {
                const cell = sheet[slot];
                if (!cell.blank && cell.page !== null) {
                  expect(seen.has(cell.page)).toBe(false);
                  seen.add(cell.page);
                  // 正向槽位 ↔ 反向定位必须一致
                  const loc = locatePage(r, cell.page)!;
                  expect(loc.signature).toBe(sheet.signature);
                  expect(loc.sheetIndex).toBe(sheet.sheetIndex);
                  expect(loc.sheetInSignature).toBe(sheet.sheetInSignature);
                  expect(loc.slot).toBe(slot);
                  expect(loc.face).toBe(slot.startsWith('front') ? 'front' : 'back');
                }
              });
            });
            expect([...seen].sort((a, b) => a - b)).toEqual(
              Array.from({ length: n }, (_, i) => i + 1),
            );
            expect(Object.keys(r.locations)).toHaveLength(n);
          }
        }
      }
    }
  });

  it('反查到的槽位里取到的页码必须等于查询页码', () => {
    const r = impose({ bodyPages: 37, signatureSize: 12, binding: 'right', flip: 'short' });
    for (let p = 1; p <= 37; p += 1) {
      const loc = locatePage(r, p)!;
      const sheet = r.sheets.find((s) => s.sheetIndex === loc.sheetIndex)!;
      expect(cellToJson(sheet[loc.slot])).toBe(p);
    }
    expect(locatePage(r, 0)).toBeUndefined();
    expect(locatePage(r, 38)).toBeUndefined();
  });

  it('补白数 = 总槽位数 - 正文页数，且补白只落在最后帖的尾部位置', () => {
    for (const n of [1, 5, 6, 9, 11, 12, 13]) {
      for (const size of ALL_SIZES) {
        const r = impose({ bodyPages: n, signatureSize: size, binding: 'left', flip: 'long' });
        const expectedSigs = Math.ceil(n / size);
        const expectedPadding = expectedSigs * size - n;
        expect(r.signatureCount).toBe(expectedSigs);
        expect(r.blankCount).toBe(expectedPadding);
        expect(r.sheetCount).toBe(expectedSigs * (size / 4));
        expect(r.sheets.length * 4).toBe(n + expectedPadding);
      }
    }
  });

  it('纸张全局序号按签帖顺序 × 帖内外→内连续编号', () => {
    const r = impose({ bodyPages: 20, signatureSize: 8, binding: 'left', flip: 'long' });
    expect(r.sheets.map((s) => s.sheetIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.sheets.map((s) => s.signature)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(r.sheets.map((s) => s.sheetInSignature)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('左订长基准：frontRight/backLeft 承载翻开后相邻正文页（非 BLANK 部分）', () => {
    const r = impose({ bodyPages: 10, signatureSize: 8, binding: 'left', flip: 'long' });
    r.sheets.forEach((sheet) => {
      const fr = sheet.frontRight;
      const bl = sheet.backLeft;
      if (!fr.blank && !bl.blank) {
        expect(bl.page).toBe((fr.page as number) + 1);
      }
    });
  });
});

describe('JSON 导出共用同一映射', () => {
  it('导出的每个槽位与 Imposition 中对应纸张槽位逐一相等', () => {
    const r = impose({ bodyPages: 14, signatureSize: 8, binding: 'right', flip: 'short' });
    const json = impositionToJson(r);
    expect(json.sheets).toHaveLength(r.sheets.length);
    r.sheets.forEach((sheet, i) => {
      const j = json.sheets[i]!;
      expect(j.frontLeft).toBe(cellToJson(sheet.frontLeft));
      expect(j.frontRight).toBe(cellToJson(sheet.frontRight));
      expect(j.backLeft).toBe(cellToJson(sheet.backLeft));
      expect(j.backRight).toBe(cellToJson(sheet.backRight));
      expect(j.signature).toBe(sheet.signature);
      expect(j.sheetIndex).toBe(sheet.sheetIndex);
    });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    const located = json.locations.find((l) => l.page === 13)!;
    expect(located.signature).toBe(2);
  });
});

describe('边界：1 页与 512 页', () => {
  it('1 页 / 4：其余三槽全 BLANK，第 1 页在正面右（左订长边）', () => {
    const r = impose({ bodyPages: 1, signatureSize: 4, binding: 'left', flip: 'long' });
    expect(rowsOf(r)).toEqual([['BLANK', 1, 'BLANK', 'BLANK']]);
    expect(locatePage(r, 1)?.slot).toBe('frontRight');
  });

  it('512 页 / 32：16 帖 128 张纸无补白', () => {
    const r = impose({ bodyPages: 512, signatureSize: 32, binding: 'left', flip: 'long' });
    expect(r.signatureCount).toBe(16);
    expect(r.sheetCount).toBe(128);
    expect(r.blankCount).toBe(0);
    expect(r.sheets[0]!.frontRight).toEqual({ page: 1, blank: false });
    // 最后一帖（481–512）最外张：正面左 512、正面右 481、背面左 482、背面右 511
    const outer = r.sheets[120]!;
    expect(rowsOf({ ...r, sheets: [outer] })).toEqual([[512, 481, 482, 511]]);
    // 最后一帖最内张承载该帖中段 495–498
    expect(rowsOf({ ...r, sheets: [r.sheets[127]!] })).toEqual([[498, 495, 496, 497]]);
    expect(locatePage(r, 511)?.slot).toBe('backRight');
    expect(locatePage(r, 512)?.slot).toBe('frontLeft');
  });
});

describe('非法输入：抛错且不产生任何拼版', () => {
  const bad: Array<Record<string, unknown>> = [
    { bodyPages: 0, signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: 513, signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: 1.5, signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: -1, signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: 8, signatureSize: 3, binding: 'left', flip: 'long' },
    { bodyPages: 8, signatureSize: 33, binding: 'left', flip: 'long' },
    { bodyPages: 8, signatureSize: 6, binding: 'left', flip: 'long' },
    { bodyPages: 8, signatureSize: 8, binding: 'top', flip: 'long' },
    { bodyPages: 8, signatureSize: 8, binding: 'left', flip: 'diagonal' },
    { bodyPages: '8', signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: null, signatureSize: 8, binding: 'left', flip: 'long' },
    { bodyPages: undefined, signatureSize: 8, binding: 'left', flip: 'long' },
  ];
  bad.forEach((input) => {
    it(JSON.stringify(input), () => {
      expect(() => impose(input as never)).toThrow(ImpositionError);
    });
  });
});

// 防止 PageCell 结构在测试中被误判为 any 的类型自检
const _cell: PageCell = { page: null, blank: true };
void _cell;
