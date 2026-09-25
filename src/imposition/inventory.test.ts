import { describe, expect, it } from 'vitest';
import {
  cellToJson,
  impose,
  imposeSequence,
  impositionToJson,
  locatePage,
  ImpositionError,
} from './imposition';
import {
  imposeInventory,
  InventoryShortageError,
  NO_IMPOSITION,
  planInventorySequence,
  validateInventoryInput,
} from './inventory';
import type {
  Binding,
  Flip,
  ImpositionBase,
  InventoryStockItem,
  Slot,
} from './types';

const SLOT_ORDER: Slot[] = [
  'frontLeft',
  'frontRight',
  'backLeft',
  'backRight',
];

function rowsOf(result: ImpositionBase) {
  return result.sheets.map((s) =>
    SLOT_ORDER.map((slot) => cellToJson(s[slot])),
  );
}

const ALL_BINDINGS: Binding[] = ['left', 'right'];
const ALL_FLIPS: Flip[] = ['long', 'short'];

/** 把 stock 缩写（[容量, 册数] 对）转成库存数组。 */
function stock(...pairs: Array<[number, number]>): InventoryStockItem[] {
  return pairs.map(([capacity, count]) => ({ capacity, count }));
}

/**
 * 测试内独立参考实现：枚举全部用量向量，用题目三目标
 * （补白数 → 签帖数 → 升序容量序列字典序）显式择优。
 * 与 planInventorySequence 的实现路径完全独立，用于核对最优性。
 */
function referencePlan(
  bodyPages: number,
  stockItems: readonly InventoryStockItem[],
): number[] | null {
  const items = [...stockItems].sort((a, b) => a.capacity - b.capacity);
  const n = items.length;
  const used = new Array<number>(n).fill(0);

  interface Candidate {
    blanks: number;
    sigs: number;
    sequence: number[];
  }

  const lexLess = (a: readonly number[], b: readonly number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const x = a[i];
      const y = b[i];
      if (x === undefined) return y !== undefined;
      if (y === undefined) return false;
      if (x !== y) return x < y;
    }
    return false;
  };

  const prefers = (a: Candidate, b: Candidate | null): boolean =>
    b === null ||
    a.blanks < b.blanks ||
    (a.blanks === b.blanks && a.sigs < b.sigs) ||
    (a.blanks === b.blanks &&
      a.sigs === b.sigs &&
      lexLess(a.sequence, b.sequence));

  const dfs = (i: number): Candidate | null => {
    if (i === n) {
      const sequence: number[] = [];
      let total = 0;
      used.forEach((c, j) => {
        total += c * items[j]!.capacity;
        for (let k = 0; k < c; k += 1) sequence.push(items[j]!.capacity);
      });
      if (total < bodyPages) return null;
      return {
        blanks: total - bodyPages,
        sigs: used.reduce((s, c) => s + c, 0),
        sequence,
      };
    }
    let best: Candidate | null = null;
    for (let c = 0; c <= items[i]!.count; c += 1) {
      used[i] = c;
      const candidate = dfs(i + 1);
      if (candidate !== null && prefers(candidate, best)) {
        best = candidate;
      }
    }
    used[i] = 0;
    return best;
  };

  const chosen = dfs(0);
  return chosen === null ? null : chosen.sequence;
}

describe('规划：小库存枚举核对三目标最优性', () => {
  const cases: { stock: InventoryStockItem[]; pages: number[] }[] = [
    {
      // 每种册数都很小，配合 N=1..48 完整枚举
      stock: stock([4, 2], [8, 2]),
      pages: Array.from({ length: 25 }, (_, i) => i + 1),
    },
    {
      stock: stock([4, 2], [12, 1], [16, 1]),
      pages: Array.from({ length: 41 }, (_, i) => i + 1),
    },
    {
      // 含 0 册库存
      stock: stock([4, 0], [8, 2], [16, 1]),
      pages: [1, 4, 7, 8, 9, 12, 15, 16, 17, 24, 31, 32, 33],
    },
    {
      stock: stock([8, 2], [12, 1], [20, 1], [32, 1]),
      pages: [1, 8, 9, 16, 20, 21, 32, 40, 41, 48, 52, 60, 72, 73],
    },
  ];

  cases.forEach(({ stock: stockItems, pages }) => {
    pages.forEach((n) => {
      it(`N=${n}, stock=${JSON.stringify(stockItems)}`, () => {
        const planned = planInventorySequence(n, stockItems);
        const expected = referencePlan(n, stockItems);
        expect(planned).toEqual(expected);
      });
    });
  });

  it('规划金样：零补白时仍优先更少签帖（N=8：[8] 胜 [4,4]）', () => {
    expect(planInventorySequence(8, stock([4, 2], [8, 1]))).toEqual([8]);
  });

  it('规划金样：补白相同取更少签帖（N=12：[16] 胜 [8,8]，补白均为 4）', () => {
    expect(planInventorySequence(12, stock([8, 2], [16, 1]))).toEqual([16]);
  });

  it('规划金样：补白与签帖数相同取字典序最小（N=20：[4,16] 胜 [8,12]）', () => {
    expect(
      planInventorySequence(20, stock([4, 2], [8, 1], [12, 1], [16, 1])),
    ).toEqual([4, 16]);
  });

  it('规划金样：N=17 / {8×2,16×1} 只能 [8,16]（[8,8] 容量不够）', () => {
    expect(planInventorySequence(17, stock([8, 2], [16, 1]))).toEqual([8, 16]);
  });

  it('规划金样：0 册条目不参与，但仍满足 2–4 种库存条目', () => {
    expect(planInventorySequence(12, stock([4, 0], [8, 0], [16, 1]))).toEqual([
      16,
    ]);
  });

  it('库存总容量不足 → null', () => {
    expect(planInventorySequence(33, stock([16, 1], [8, 2]))).toBeNull();
    expect(planInventorySequence(100, stock([32, 2], [16, 1]))).toBeNull();
  });

  it('库存条目乱序输入不影响结果（内部按容量升序）', () => {
    const a = planInventorySequence(20, stock([16, 1], [4, 2], [12, 1], [8, 1]));
    const b = planInventorySequence(20, stock([4, 2], [8, 1], [12, 1], [16, 1]));
    expect(a).toEqual([4, 16]);
    expect(b).toEqual([4, 16]);
  });
});

describe('库存拼版结果：每页一次、库存不超额、补白位置', () => {
  const fixtures: Array<{
    name: string;
    n: number;
    stockItems: InventoryStockItem[];
    sequence: number[];
  }> = [
    { name: '12页/4+8', n: 12, stockItems: stock([4, 1], [8, 1]), sequence: [4, 8] },
    {
      name: '20页/4+16（字典序胜出）',
      n: 20,
      stockItems: stock([4, 2], [8, 1], [12, 1], [16, 1]),
      sequence: [4, 16],
    },
    { name: '13页/16（签帖数胜出）', n: 13, stockItems: stock([8, 2], [16, 1]), sequence: [16] },
    {
      name: '17页/8+16（补白 7）',
      n: 17,
      stockItems: stock([8, 2], [16, 1]),
      sequence: [8, 16],
    },
    { name: '9页/4+8（前帖满、尾帖补3）', n: 9, stockItems: stock([4, 1], [8, 1]), sequence: [4, 8] },
    { name: '1页/4+8', n: 1, stockItems: stock([4, 1], [8, 1]), sequence: [4] },
  ];

  fixtures.forEach(({ name, n, stockItems, sequence }) => {
    it(name, () => {
      for (const binding of ALL_BINDINGS) {
        for (const flip of ALL_FLIPS) {
          const r = imposeInventory({
            bodyPages: n,
            binding,
            flip,
            stock: stockItems,
          });
          // 选定序列与规划一致（升序）
          expect(r.signatureSizes).toEqual(sequence);
          expect(r.signatureCount).toBe(sequence.length);

          // 全局纸张编号连续
          expect(r.sheets.map((s) => s.sheetIndex)).toEqual(
            Array.from({ length: r.sheets.length }, (_, i) => i + 1),
          );
          expect(r.sheetCount).toBe(
            sequence.reduce((s, c) => s + c / 4, 0),
          );
          // 所属签帖号与容量序列对齐
          const expectedSigs: number[] = [];
          sequence.forEach((c, i) => {
            for (let k = 0; k < c / 4; k += 1) expectedSigs.push(i + 1);
          });
          expect(r.sheets.map((s) => s.signature)).toEqual(expectedSigs);

          // 每个正文页恰好出现一次
          const seen = new Set<number>();
          r.sheets.forEach((sheet) => {
            SLOT_ORDER.forEach((slot) => {
              const cell = sheet[slot];
              if (!cell.blank && cell.page !== null) {
                expect(cell.page).toBeGreaterThanOrEqual(1);
                expect(cell.page).toBeLessThanOrEqual(n);
                expect(seen.has(cell.page)).toBe(false);
                seen.add(cell.page);
                // 正向槽位 ↔ 反查共享同一全局纸张编号
                const loc = locatePage(r, cell.page)!;
                expect(loc.sheetIndex).toBe(sheet.sheetIndex);
                expect(loc.signature).toBe(sheet.signature);
                expect(loc.sheetInSignature).toBe(sheet.sheetInSignature);
                expect(loc.slot).toBe(slot);
              }
            });
          });
          expect([...seen].sort((a, b) => a - b)).toEqual(
            Array.from({ length: n }, (_, i) => i + 1),
          );
          expect(Object.keys(r.locations)).toHaveLength(n);

          // 库存不超额
          stockItems.forEach((item) => {
            const used = r.usedStock.find(
              (u) => u.capacity === item.capacity,
            )!.count;
            expect(used).toBeLessThanOrEqual(item.count);
          });
          // usedStock 与容量序列互相一致
          const fromSequence = sequence.reduce<Record<number, number>>(
            (acc, c) => {
              acc[c] = (acc[c] ?? 0) + 1;
              return acc;
            },
            {},
          );
          r.usedStock.forEach((u) => {
            expect(u.count).toBe(fromSequence[u.capacity] ?? 0);
          });

          // 补白：数量 = 总容量 − 正文页数
          const totalCapacity = sequence.reduce((s, c) => s + c, 0);
          expect(r.blankCount).toBe(totalCapacity - n);

          // 补白只允许出现在最后一帖；最后一帖承载的页码恰好是
          // prefixPages+1..n，其余槽位全部是 BLANK（装订/翻纸只移动槽位，
          // 不改变这一集合性质；精确槽位在左订长边分支单独核对）。
          const prefixPages = sequence
            .slice(0, -1)
            .reduce((s, c) => s + c, 0);
          const lastSigPages = n - prefixPages;
          const lastSigIndex = sequence.length;
          const lastSize = sequence[sequence.length - 1]!;
          let blanks = 0;
          const lastSigPagesSeen = new Set<number>();
          r.sheets.forEach((sheet) => {
            SLOT_ORDER.forEach((slot) => {
              const cell = sheet[slot];
              if (cell.blank || cell.page === null) {
                blanks += 1;
                expect(sheet.signature).toBe(lastSigIndex);
                return;
              }
              if (sheet.signature === lastSigIndex) {
                expect(cell.page).toBeGreaterThan(prefixPages);
                expect(cell.page).toBeLessThanOrEqual(n);
                lastSigPagesSeen.add(cell.page as number);
              } else {
                // 非末尾签帖必须装满（无 BLANK，页码都属于本帖区间）
                const sizesBefore = sequence
                  .slice(0, sheet.signature - 1)
                  .reduce((s, c) => s + c, 0);
                const localCap = sequence[sheet.signature - 1]!;
                expect(cell.page).toBeGreaterThan(sizesBefore);
                expect(cell.page).toBeLessThanOrEqual(sizesBefore + localCap);
              }
            });
          });
          expect(blanks).toBe(r.blankCount);
          expect([...lastSigPagesSeen].sort((a, b) => a - b)).toEqual(
            Array.from({ length: lastSigPages }, (_, i) => prefixPages + i + 1),
          );

          // 左订长边下逐槽核对：BLANK 恰好落在最后一帖本地页 > 实有页数
          // 的槽位，实有页槽位页码 = 前缀 + 本地页。
          if (binding === 'left' && flip === 'long') {
            r.sheets.forEach((sheet) => {
              if (sheet.signature !== lastSigIndex) return;
              const k = sheet.sheetInSignature - 1;
              const baselineLocal: Record<Slot, number> = {
                frontLeft: lastSize - 2 * k,
                frontRight: 2 * k + 1,
                backLeft: 2 * k + 2,
                backRight: lastSize - 2 * k - 1,
              };
              SLOT_ORDER.forEach((slot) => {
                const cell = sheet[slot];
                const local = baselineLocal[slot]!;
                if (local > lastSigPages) {
                  expect(cell.blank || cell.page === null).toBe(true);
                } else {
                  expect(cell.page).toBe(prefixPages + local);
                }
              });
            });
          }
        }
      }
    });
  });

  it('9页/4+8 左订长边金样：第一帖满 4 页，第二帖本地尾部补 3 个 BLANK', () => {
    const r = imposeInventory({
      bodyPages: 9,
      binding: 'left',
      flip: 'long',
      stock: stock([4, 1], [8, 1]),
    });
    // 第二帖本地页 1..5 → 全局 5..9；本地 6/7/8 → BLANK
    expect(rowsOf(r)).toEqual([
      [4, 1, 2, 3],
      ['BLANK', 5, 6, 'BLANK'],
      ['BLANK', 7, 8, 9],
    ]);
    expect(r.blankCount).toBe(3);
    expect(r.signatureSizes).toEqual([4, 8]);
  });

  it('1页/4+8：只用最小帖 [4]，三槽 BLANK，第 1 页在正面右', () => {
    const r = imposeInventory({
      bodyPages: 1,
      binding: 'left',
      flip: 'long',
      stock: stock([4, 1], [8, 1]),
    });
    expect(rowsOf(r)).toEqual([['BLANK', 1, 'BLANK', 'BLANK']]);
    expect(r.signatureSizes).toEqual([4]);
    expect(r.usedStock).toEqual([
      { capacity: 4, count: 1 },
      { capacity: 8, count: 0 },
    ]);
  });
});

describe('库存拼版复用现有物理槽位映射（四种翻转模式）', () => {
  it('同容量序列与固定容量旧入口逐槽一致，结果签名含逐帖容量', () => {
    for (const binding of ALL_BINDINGS) {
      for (const flip of ALL_FLIPS) {
        // 4 容量库存 0 册 → 20 页只能用三帖 8
        const r = imposeInventory({
          bodyPages: 20,
          binding,
          flip,
          stock: stock([4, 0], [8, 3]),
        });
        const fixed = impose({
          bodyPages: 20,
          signatureSize: 8,
          binding,
          flip,
        });
        expect(r.signatureSizes).toEqual([8, 8, 8]);
        expect(rowsOf(r)).toEqual(rowsOf(fixed));
        expect(r.sheets).toEqual(fixed.sheets);
      }
    }
  });

  it('imposeSequence 是唯一排布入口：混合序列 4+12 与手工调用一致', () => {
    const direct = imposeSequence(14, [4, 12], 'left', 'long');
    const r = imposeInventory({
      bodyPages: 14,
      binding: 'left',
      flip: 'long',
      stock: stock([4, 1], [12, 1]),
    });
    expect(r.sheets).toEqual(direct.sheets);
    expect(r.blankCount).toBe(2);
  });
});

describe('表格 / 反查 / JSON 共享同一全局纸张编号', () => {
  it('JSON 中每张纸、每个定位都与 Imposition 逐一相等', () => {
    const r = imposeInventory({
      bodyPages: 19,
      binding: 'right',
      flip: 'short',
      stock: stock([4, 1], [8, 1], [16, 1]),
    });
    const json = impositionToJson(r);
    expect(json.sheets).toHaveLength(r.sheets.length);
    r.sheets.forEach((sheet, i) => {
      const j = json.sheets[i]!;
      expect(j.sheetIndex).toBe(sheet.sheetIndex);
      expect(j.signature).toBe(sheet.signature);
      expect(j.sheetInSignature).toBe(sheet.sheetInSignature);
      expect(j.frontLeft).toBe(cellToJson(sheet.frontLeft));
      expect(j.frontRight).toBe(cellToJson(sheet.frontRight));
      expect(j.backLeft).toBe(cellToJson(sheet.backLeft));
      expect(j.backRight).toBe(cellToJson(sheet.backRight));
    });
    // 导出时不另行计算：按 JSON 定位取纸，页码必须对得上反查表
    r.sheets.forEach((sheet) => {
      SLOT_ORDER.forEach((slot) => {
        const cell = sheet[slot];
        if (!cell.blank && cell.page !== null) {
          const loc = json.locations.find((l) => l.page === cell.page)!;
          expect(loc.sheetIndex).toBe(sheet.sheetIndex);
          const j = json.sheets.find((s) => s.sheetIndex === loc.sheetIndex)!;
          expect(j[slot]).toBe(cell.page);
        }
      });
    });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(json.signatureSizes).toEqual(r.signatureSizes);
    expect(json.usedStock).toEqual(r.usedStock);
    // 库存结果 JSON 不带固定容量字段
    expect('signatureSize' in json).toBe(false);
  });
});

describe('库存不足与非法输入：不生成部分纸张', () => {
  it('库存不足抛 InventoryShortageError（code=NO_IMPOSITION）', () => {
    expect.assertions(4);
    try {
      imposeInventory({
        bodyPages: 33,
        binding: 'left',
        flip: 'long',
        stock: stock([16, 1], [8, 2]),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(InventoryShortageError);
      expect((err as InventoryShortageError).code).toBe(NO_IMPOSITION);
      expect(NO_IMPOSITION).toBe('NO_IMPOSITION');
    }
    // 超过全部库存容量（最多 32×8×4=1024 也覆盖不到时）
    expect(() =>
      imposeInventory({
        bodyPages: 500,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [8, 1]),
      }),
    ).toThrow(InventoryShortageError);
  });

  const badInputs: Array<{ label: string; input: unknown }> = [
    {
      label: '库存只有 1 种',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([8, 1]),
      },
    },
    {
      label: '库存有 5 种',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [8, 1], [12, 1], [16, 1], [20, 1]),
      },
    },
    {
      label: '容量重复',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([8, 1], [8, 2]),
      },
    },
    {
      label: '容量非 4 的倍数',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([6, 1], [8, 1]),
      },
    },
    {
      label: '容量越界',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [36, 1]),
      },
    },
    {
      label: '册数为 9',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [8, 9]),
      },
    },
    {
      label: '册数为负',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'long',
        stock: stock([4, -1], [8, 1]),
      },
    },
    {
      label: '正文页数越界',
      input: {
        bodyPages: 0,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [8, 1]),
      },
    },
    {
      label: 'binding 非法',
      input: {
        bodyPages: 8,
        binding: 'top',
        flip: 'long',
        stock: stock([4, 1], [8, 1]),
      },
    },
    {
      label: 'flip 非法',
      input: {
        bodyPages: 8,
        binding: 'left',
        flip: 'diagonal',
        stock: stock([4, 1], [8, 1]),
      },
    },
    {
      label: 'stock 不是数组',
      input: { bodyPages: 8, binding: 'left', flip: 'long', stock: {} },
    },
  ];

  badInputs.forEach(({ label, input }) => {
    it(`非法输入：${label} → ImpositionError`, () => {
      expect(() => validateInventoryInput(input as never)).toThrow(
        ImpositionError,
      );
      expect(() => imposeInventory(input as never)).toThrow(ImpositionError);
    });
  });

  it('库存不足与参数非法是不同异常类型', () => {
    // 容量凑不齐但参数合法 → shortage；参数本身坏 → validation
    expect(() =>
      imposeInventory({
        bodyPages: 100,
        binding: 'left',
        flip: 'long',
        stock: stock([4, 1], [8, 1]),
      }),
    ).toThrow(InventoryShortageError);
  });
});
