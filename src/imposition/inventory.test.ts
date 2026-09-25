import { describe, expect, it } from 'vitest';
import {
  cellToJson,
  impose,
  imposeInventory,
  impositionToJson,
  locatePage,
  ImpositionError,
} from './imposition';
import {
  NO_IMPOSITION,
  NoImpositionError,
  planInventorySignatures,
  validateInventoryInput,
} from './inventory';
import type {
  Binding,
  Flip,
  InventoryItem,
  PageCell,
  Slot,
} from './types';

// 一行 = 一张实体纸的 [frontLeft, frontRight, backLeft, backRight]
type Row = [
  number | 'BLANK',
  number | 'BLANK',
  number | 'BLANK',
  number | 'BLANK',
];
const SLOT_ORDER: Slot[] = [
  'frontLeft',
  'frontRight',
  'backLeft',
  'backRight',
];
const rowsOf = (r: ReturnType<typeof imposeInventory>): Row[] =>
  r.sheets.map((s) => SLOT_ORDER.map((slot) => cellToJson(s[slot])) as Row);

const VALID_SIZES = [4, 8, 12, 16, 20, 24, 28, 32];

const inv = (...items: Array<[number, number]>): InventoryItem[] =>
  items.map(([size, count]) => ({ size, count }));

/**
 * 朴素参考实现：枚举所有“每种容量用量 0..库存册数”的多重集，
 * 升序排列为容量序列后逐一判可行性，按 (总补白, 签帖数, 字典序) 取最小。
 * 与生产实现独立，专门用于枚举小库存核对最优性。
 */
function bruteForcePlan(bodyPages: number, inventory: InventoryItem[]) {
  const sizes = inventory.map((i) => i.size).sort((a, b) => a - b);
  const counts = new Map(inventory.map((i) => [i.size, i.count]));

  // 用 holder 容器装“当前最优”，避免闭包内 let 赋值的控制流收窄。
  const bestRef: { value: { sizes: number[]; total: number } | null } = {
    value: null,
  };
  const consider = (multiset: number[]) => {
    if (multiset.length === 0) return;
    const seq = [...multiset].sort((a, b) => a - b);
    const total = seq.reduce((a, b) => a + b, 0);
    const last = seq[seq.length - 1] as number;
    const pagesIntoLast = bodyPages - (total - last);
    if (pagesIntoLast < 1 || pagesIntoLast > last) return;
    const best = bestRef.value;
    if (best === null) {
      bestRef.value = { sizes: seq, total };
      return;
    }
    if (total !== best.total) {
      if (total < best.total) bestRef.value = { sizes: seq, total };
      return;
    }
    if (seq.length !== best.sizes.length) {
      if (seq.length < best.sizes.length) bestRef.value = { sizes: seq, total };
      return;
    }
    // 同总容量、同长度：手动按位置比较字典序（不能用数组 <，那会按字符串比较）。
    for (let i = 0; i < seq.length; i += 1) {
      if (seq[i] !== best.sizes[i]) {
        if ((seq[i] as number) < (best.sizes[i] as number)) {
          bestRef.value = { sizes: seq, total };
        }
        break;
      }
    }
  };

  const enumerate = (index: number, chosen: number[]): void => {
    if (index === sizes.length) {
      consider(chosen);
      return;
    }
    const size = sizes[index] as number;
    const count = counts.get(size) as number;
    for (let c = 0; c <= count; c += 1) {
      if (c > 0) chosen.push(size);
      enumerate(index + 1, chosen);
    }
    chosen.length -= count;
  };
  enumerate(0, []);

  return bestRef.value === null
    ? null
    : {
        sizes: bestRef.value.sizes,
        blank: bestRef.value.total - bodyPages,
      };
}

describe('库存拼版规划：小库存枚举核对最优性', () => {
  it('与朴素枚举在所有小库存组合下结果一致（2 种容量）', () => {
    for (let ai = 0; ai < VALID_SIZES.length; ai += 1) {
      for (let bi = ai + 1; bi < VALID_SIZES.length; bi += 1) {
        const sizeA = VALID_SIZES[ai] as number;
        const sizeB = VALID_SIZES[bi] as number;
        for (let countA = 0; countA <= 3; countA += 1) {
          for (let countB = 0; countB <= 3; countB += 1) {
            for (let n = 1; n <= 40; n += 1) {
              const inventory = inv([sizeA, countA], [sizeB, countB]);
              const expected = bruteForcePlan(n, inventory);
              if (expected === null) {
                expect(() => planInventorySignatures(n, inventory)).toThrow(
                  NoImpositionError,
                );
              } else {
                const plan = planInventorySignatures(n, inventory);
                expect(plan.sizes).toEqual(expected.sizes);
                expect(
                  plan.sizes.reduce((a, b) => a + b, 0) - n,
                ).toBe(expected.blank);
              }
            }
          }
        }
      }
    }
  });

  it('与朴素枚举在 3/4 种容量、随机小库存下一致', () => {
    let seed = 123456789;
    const rand = () => {
      // 确定性 LCG，避免测试依赖外部随机源。
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const combos: number[][] = [
      [4, 8, 12],
      [4, 16, 24],
      [8, 12, 32],
      [4, 8, 16, 32],
      [12, 20, 28],
      [4, 12, 20, 28],
    ];
    for (const combo of combos) {
      for (let trial = 0; trial < 60; trial += 1) {
        const inventory: InventoryItem[] = combo.map((size) => ({
          size,
          count: Math.floor(rand() * 4), // 0..3
        }));
        const n = 1 + Math.floor(rand() * 60);
        const expected = bruteForcePlan(n, inventory);
        if (expected === null) {
          expect(() => planInventorySignatures(n, inventory)).toThrow(
            NoImpositionError,
          );
        } else {
          expect(planInventorySignatures(n, inventory).sizes).toEqual(
            expected.sizes,
          );
        }
      }
    }
  });

  it('库存顺序不影响规划结果（容量按升序规范化）', () => {
    const n = 18;
    const a = planInventorySignatures(n, inv([4, 2], [8, 1], [16, 2]));
    const b = planInventorySignatures(n, inv([16, 2], [4, 2], [8, 1]));
    expect(a.sizes).toEqual(b.sizes);
  });

  it('0 册的容量种类合法但不参与使用', () => {
    const plan = planInventorySignatures(6, inv([4, 0], [8, 2]));
    expect(plan.sizes).toEqual([8]);
    expect(plan.usedSignatures).toEqual([{ size: 8, used: 1 }]);
  });
});

describe('库存拼版规划：确定性金样', () => {
  it('10 页 / {4×2, 8×2}：[4,8] 补 2，优于 [4,4,4] 补 2（签帖更少）', () => {
    const plan = planInventorySignatures(10, inv([4, 2], [8, 2]));
    expect(plan.sizes).toEqual([4, 8]);
    expect(plan.usedSignatures).toEqual([
      { size: 4, used: 1 },
      { size: 8, used: 1 },
    ]);
  });

  it('12 页 / {4×8, 8×8, 16×8}：单帖 16 补 4，但 [4,8] 无补白更优', () => {
    const plan = planInventorySignatures(
      12,
      inv([4, 8], [8, 8], [16, 8]),
    );
    expect(plan.sizes).toEqual([4, 8]);
  });

  it('16 页：单帖 16 无补白且签帖数最少', () => {
    const plan = planInventorySignatures(
      16,
      inv([4, 8], [8, 8], [16, 8]),
    );
    expect(plan.sizes).toEqual([16]);
  });

  it('10 页 / {8×2, 12×2}：[12] 补 2，优于 [8,8] 补 6', () => {
    const plan = planInventorySignatures(10, inv([8, 2], [12, 2]));
    expect(plan.sizes).toEqual([12]);
  });

  it('26 页 / {8×3, 12×3}：[8,8,12] 补 2（唯一可行形状，总容量 28）', () => {
    const plan = planInventorySignatures(26, inv([8, 3], [12, 3]));
    expect(plan.sizes).toEqual([8, 8, 12]);
  });

  it('平局取字典序最小：总容量与签帖数相同的不同多重集', () => {
    // n=30 / {8×2,12×2,16×2,20×2}：
    // 两帖总容量 32（补 2）的有 [12,20] 与 [16,16]，[12,20] 字典序更小。
    // （库存只给 2 册 16，且 [8,12,?] 三帖序列补白相同但签帖更多，不参与平局。）
    const plan = planInventorySignatures(
      30,
      inv([8, 2], [12, 2], [16, 2], [20, 2]),
    );
    expect(plan.sizes).toEqual([12, 20]);

    // 次级规则：补白相同时签帖数更少者胜。
    // n=20 / {4×2,8×2,12×2,16×2}：[4,16] 零补白且 2 帖，胜过任何 3 帖序列。
    const fewer = planInventorySignatures(
      20,
      inv([4, 2], [8, 2], [12, 2], [16, 2]),
    );
    expect(fewer.sizes).toEqual([4, 16]);
  });

  it('满册库存上限 8 被尊重：8 册 4 只能装 32 页', () => {
    expect(planInventorySignatures(32, inv([4, 8])).sizes).toEqual([
      4, 4, 4, 4, 4, 4, 4, 4,
    ]);
    expect(() => planInventorySignatures(33, inv([4, 8]))).toThrow(
      NoImpositionError,
    );
  });

  it('NO_IMPOSITION：总容量不足', () => {
    expect(() => planInventorySignatures(20, inv([4, 2], [8, 1]))).toThrow(
      NoImpositionError,
    );
  });

  it('NO_IMPOSITION：满册库存也无法凑出可行序列（总容量不足）', () => {
    // 每种 8 册：{4×8,8×8} 总容量 96，97 页必然无解。
    expect(() =>
      planInventorySignatures(97, inv([4, 8], [8, 8])),
    ).toThrow(NoImpositionError);
    // 临界：96 页恰好装下（末帖装满，无补白）。
    expect(
      planInventorySignatures(96, inv([4, 8], [8, 8])).sizes.reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(96);
  });

  it('NO_IMPOSITION：库存只够拼出末帖为空的序列', () => {
    // n=5 / {4×1, 8×0}：[4] 只装 4 页，补 1 页需要第二帖但 8 已无库存；
    // 仅有的“序列”[4] 会使末帖之后还剩正文页，不满足末帖规则。
    expect(() =>
      planInventorySignatures(5, inv([4, 1], [8, 0])),
    ).toThrow(NoImpositionError);
  });
});

describe('库存拼版：物理槽位映射复用同一套公式', () => {
  it('10 页 / [4,8] 左订长边金样：第一帖满 4 页，第二帖装 6 页补 2 BLANK', () => {
    const r = imposeInventory({
      bodyPages: 10,
      inventory: inv([4, 2], [8, 2]),
      binding: 'left',
      flip: 'long',
    });
    expect(r.mode).toBe('inventory');
    expect(r.signatureSizes).toEqual([4, 8]);
    expect(r.signatureCount).toBe(2);
    expect(r.sheetCount).toBe(3);
    expect(r.blankCount).toBe(2);
    // 第二帖容量 8、实装本地页 1..6（全局 5..10），本地 7/8 为 BLANK：
    // k=0 槽位本地页 [8,1,2,7] → [BLANK,5,6,BLANK]
    // k=1 槽位本地页 [6,3,4,5] → [10,7,8,9]
    expect(rowsOf(r)).toEqual([
      [4, 1, 2, 3],
      ['BLANK', 5, 6, 'BLANK'],
      [10, 7, 8, 9],
    ]);
    // 全局纸张编号跨签帖连续 1..3
    expect(r.sheets.map((s) => s.sheetIndex)).toEqual([1, 2, 3]);
    expect(r.sheets.map((s) => s.signature)).toEqual([1, 2, 2]);
    expect(r.sheets.map((s) => s.sheetInSignature)).toEqual([1, 1, 2]);
    expect(r.sheets.map((s) => s.signatureSize)).toEqual([4, 8, 8]);
  });

  it('每一正文页恰好出现一次，且槽位 ↔ 反查指向同一全局纸张编号', () => {
    const cases: Array<{ n: number; items: Array<[number, number]> }> = [
      { n: 1, items: [[4, 2], [8, 1]] },
      { n: 6, items: [[4, 1], [8, 1]] },
      { n: 10, items: [[4, 2], [8, 2]] },
      { n: 17, items: [[8, 2], [12, 2], [16, 1]] },
      { n: 40, items: [[4, 8], [8, 4], [12, 2]] },
      { n: 33, items: [[4, 4], [32, 2]] },
    ];
    for (const { n, items } of cases) {
      for (const binding of ['left', 'right'] as Binding[]) {
        for (const flip of ['long', 'short'] as Flip[]) {
          const r = imposeInventory({
            bodyPages: n,
            inventory: inv(...items),
            binding,
            flip,
          });
          const seen = new Set<number>();
          r.sheets.forEach((sheet) => {
            SLOT_ORDER.forEach((slot) => {
              const cell = sheet[slot];
              if (!cell.blank && cell.page !== null) {
                expect(seen.has(cell.page)).toBe(false);
                seen.add(cell.page);
                const loc = locatePage(r, cell.page)!;
                expect(loc.signature).toBe(sheet.signature);
                // 反查的全局纸张编号必须就是这张纸
                expect(loc.sheetIndex).toBe(sheet.sheetIndex);
                expect(loc.sheetInSignature).toBe(sheet.sheetInSignature);
                expect(loc.slot).toBe(slot);
                expect(loc.face).toBe(
                  slot.startsWith('front') ? 'front' : 'back',
                );
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
  });

  it('库存不超额：usedSignatures 与容量序列内的实际用量都不超过库存', () => {
    const items: Array<[number, number]> = [
      [4, 2],
      [8, 1],
      [16, 2],
    ];
    const r = imposeInventory({
      bodyPages: 30,
      inventory: inv(...items),
      binding: 'left',
      flip: 'long',
    });
    const stock = new Map(items);
    r.usedSignatures.forEach(({ size, used }) => {
      expect(used).toBeLessThanOrEqual(stock.get(size) as number);
      expect(r.signatureSizes.filter((s) => s === size).length).toBe(used);
    });
    // 30 页：[8,?]... [8,?] 期望 [8,?] 由规划器给出，这里只断言库存约束与总量
    const total = r.signatureSizes.reduce((a, b) => a + b, 0);
    expect(total).toBe(r.bodyPages + r.blankCount);
  });

  it('补白只出现在最后一帖，且就是该帖本地页尾部', () => {
    for (const { n, items, expectedSizes } of [
      {
        n: 10,
        items: [[4, 2], [8, 2]] as Array<[number, number]>,
        expectedSizes: [4, 8],
      },
      {
        n: 26,
        items: [[8, 3], [12, 3]] as Array<[number, number]>,
        expectedSizes: [8, 8, 12],
      },
      {
        n: 7,
        items: [[4, 1], [8, 1]] as Array<[number, number]>,
        expectedSizes: [8],
      },
    ]) {
      const r = imposeInventory({
        bodyPages: n,
        inventory: inv(...items),
        binding: 'left',
        flip: 'long',
      });
      expect(r.signatureSizes).toEqual(expectedSizes);
      const lastSig = r.signatureCount;
      let blanks = 0;
      r.sheets.forEach((sheet) => {
        const localBlankSlots: string[] = [];
        SLOT_ORDER.forEach((slot) => {
          if (sheet[slot].blank) {
            expect(sheet.signature).toBe(lastSig); // 只有最后一帖允许补白
            blanks += 1;
            localBlankSlots.push(slot);
          }
        });
        if (sheet.signature !== lastSig) return;
        // 物理位置核对：补白槽位的左订长边本地页必须大于最后一帖实有页数。
        // 帖容量 m、帖内第 k 张：四槽本地页 [m-2k, 2k+1, 2k+2, m-2k-1]。
        const m = sheet.signatureSize;
        const pagesIntoLast =
          n -
          r.signatureSizes
            .slice(0, lastSig - 1)
            .reduce((a, b) => a + b, 0);
        const k = sheet.sheetInSignature - 1;
        const localBySlot: Record<string, number> = {
          frontLeft: m - 2 * k,
          frontRight: 2 * k + 1,
          backLeft: 2 * k + 2,
          backRight: m - 2 * k - 1,
        };
        localBlankSlots.forEach((slot) => {
          expect(localBySlot[slot]).toBeGreaterThan(pagesIntoLast);
        });
      });
      expect(blanks).toBe(r.blankCount);
    }
  });

  it('前面签帖必须装满：非末帖每槽都是正文页', () => {
    const r = imposeInventory({
      bodyPages: 30,
      inventory: inv([4, 2], [8, 2], [12, 2], [16, 2]),
      binding: 'left',
      flip: 'long',
    });
    r.sheets.forEach((sheet) => {
      if (sheet.signature < r.signatureCount) {
        SLOT_ORDER.forEach((slot) => {
          expect(sheet[slot].blank).toBe(false);
        });
      }
    });
  });

  it('四种翻转模式：与同容量序列固定入口逐帖一致（物理映射同源）', () => {
    const n = 20;
    for (const binding of ['left', 'right'] as Binding[]) {
      for (const flip of ['long', 'short'] as Flip[]) {
        const r = imposeInventory({
          bodyPages: n,
          inventory: inv([8, 1], [16, 2]),
          binding,
          flip,
        });
        // [8,16] 总容量 24 补 4；[16,16] 总容量 32 补 12 → 选 [8,16]
        expect(r.signatureSizes).toEqual([8, 16]);
        // 用固定入口分别造 8 帖前 8 页、16 帖装 12 页，逐槽核对。
        // 第二帖本地页 1..12 对应全局页 9..20，这里按偏移映射后比较
        //（物理槽位排布来自同一套公式，全局页码只是本地页加前缀和）。
        const first = impose({
          bodyPages: 8,
          signatureSize: 8,
          binding,
          flip,
        });
        const second = impose({
          bodyPages: 12,
          signatureSize: 16,
          binding,
          flip,
        });
        const remap = (cell: PageCell, offset: number): PageCell =>
          cell.blank || cell.page === null
            ? cell
            : { page: cell.page + offset, blank: false };
        const expected: PageCell[][] = [
          ...first.sheets.map((s) =>
            SLOT_ORDER.map((slot) => s[slot]),
          ),
          ...second.sheets.map((s) =>
            SLOT_ORDER.map((slot) => remap(s[slot], 8)),
          ),
        ];
        r.sheets.forEach((sheet, i) => {
          const src = expected[i] as PageCell[];
          SLOT_ORDER.forEach((slot, j) => {
            expect(sheet[slot]).toEqual(src[j]);
          });
        });
      }
    }
  });
});

describe('库存拼版：页码反查 / 表格 / 卡片 / JSON 共用同一全局纸张编号', () => {
  it('JSON 的 sheetIndex 与反查完全一致，导出不另行计算', () => {
    const r = imposeInventory({
      bodyPages: 23,
      inventory: inv([4, 2], [8, 2], [12, 2]),
      binding: 'right',
      flip: 'short',
    });
    const json = impositionToJson(r);
    expect(json.mode).toBe('inventory');
    expect(json.signatureSizes).toEqual(r.signatureSizes);
    expect(json.usedSignatures).toEqual(r.usedSignatures);

    r.sheets.forEach((sheet, i) => {
      const j = json.sheets[i]!;
      expect(j.sheetIndex).toBe(sheet.sheetIndex);
      expect(j.signature).toBe(sheet.signature);
      expect(j.signatureSize).toBe(sheet.signatureSize);
      SLOT_ORDER.forEach((slot) => {
        expect(j[slot]).toBe(cellToJson(sheet[slot]));
      });
    });

    // 每个正文页：反查得到的全局纸张编号必须能在 JSON 同编号纸张的同槽位找回
    json.locations.forEach((loc) => {
      const internal = locatePage(r, loc.page)!;
      expect(loc.sheetIndex).toBe(internal.sheetIndex);
      const jsonSheet = json.sheets.find(
        (s) => s.sheetIndex === loc.sheetIndex,
      )!;
      expect(jsonSheet[loc.slot]).toBe(loc.page);
    });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe('库存拼版：非法库存抛错且保留旧拼版（不产生半成品）', () => {
  const bad: Array<{
    bodyPages: unknown;
    inventory: unknown;
    binding: unknown;
    flip: unknown;
  }> = [
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [{ size: 8, count: 1 }] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 1 }, { size: 8, count: 1 }, { size: 12, count: 1 },
      { size: 16, count: 1 }, { size: 20, count: 1 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 1 }, { size: 4, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 6, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 0, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 36, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 9 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: -1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 1.5 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 0, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 513, binding: 'left', flip: 'long', inventory: [
      { size: 4, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'top', flip: 'long', inventory: [
      { size: 4, count: 1 }, { size: 8, count: 2 },
    ] },
    { bodyPages: 10, binding: 'left', flip: 'sideways', inventory: [
      { size: 4, count: 1 }, { size: 8, count: 2 },
    ] },
  ];

  bad.forEach((input) => {
    it(JSON.stringify(input.inventory).slice(0, 60), () => {
      expect(() => {
        validateInventoryInput(input);
        imposeInventory(input as never);
      }).toThrow(ImpositionError);
    });
  });

  it('非法库存不能被误报为 NO_IMPOSITION', () => {
    expect(() =>
      imposeInventory({
        bodyPages: 10,
        inventory: inv([6, 1], [8, 2]),
        binding: 'left',
        flip: 'long',
      }),
    ).not.toThrow(NoImpositionError);
  });

  it('NO_IMPOSITION 错误带固定 code', () => {
    try {
      imposeInventory({
        bodyPages: 100,
        inventory: inv([4, 1], [8, 1]),
        binding: 'left',
        flip: 'long',
      });
      throw new Error('应当 NO_IMPOSITION');
    } catch (err) {
      expect(err).toBeInstanceOf(NoImpositionError);
      expect((err as NoImpositionError).code).toBe(NO_IMPOSITION);
    }
  });
});
