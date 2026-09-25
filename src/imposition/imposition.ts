import {
  BLANK_CELL,
  faceOf,
  pageCell,
  type AnyImposition,
  type Binding,
  type Face,
  type Flip,
  type Imposition,
  type ImpositionBase,
  type ImpositionInput,
  type InventoryImposition,
  type PageCell,
  type PageLocation,
  type Sheet,
  type Slot,
} from './types';

/**
 * 参数校验：
 * - 正文页数：1 至 512 的整数
 * - signatureSize：4 至 32 且为 4 的倍数
 * - binding：left | right；flip：long | short
 * 注意：不存在“互相冲突”的参数组合——四种 binding/flip 模式都合法；
 * 非法的只是单个参数越界或类型错误。非法输入抛错，调用方保留上次合法拼版。
 */
export function validateInput(input: {
  bodyPages: unknown;
  signatureSize: unknown;
  binding: unknown;
  flip: unknown;
}): asserts input is ImpositionInput {
  const errors: string[] = [];
  const { bodyPages, signatureSize, binding, flip } = input;

  if (
    typeof bodyPages !== 'number' ||
    !Number.isInteger(bodyPages) ||
    bodyPages < 1 ||
    bodyPages > 512
  ) {
    errors.push('正文页数必须是 1 至 512 的整数');
  }
  if (
    typeof signatureSize !== 'number' ||
    !Number.isInteger(signatureSize) ||
    signatureSize < 4 ||
    signatureSize > 32 ||
    signatureSize % 4 !== 0
  ) {
    errors.push('signatureSize 必须是 4 至 32 之间 4 的倍数');
  }
  if (binding !== 'left' && binding !== 'right') {
    errors.push('装订方向必须是 left 或 right');
  }
  if (flip !== 'long' && flip !== 'short') {
    errors.push('翻纸方式必须是 long 或 short');
  }
  if (errors.length > 0) {
    throw new ImpositionError(errors);
  }
}

export class ImpositionError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join('；'));
    this.name = 'ImpositionError';
    this.errors = errors;
  }
}

/**
 * 左订长边基准：把一个签帖的本地页 1..m 排到各纸张槽位。
 *
 * 骑马订一张纸在外层包着内层，帖内第 k 张（k 从 0 起）四面为：
 *   frontLeft  = m - 2k      （偶数，贴订口的大页码）
 *   frontRight = 2k + 1      （奇数）
 *   backLeft   = 2k + 2
 *   backRight  = m - 2k - 1
 * 翻页后可见的相邻两页恒为 frontRight/backLeft = 2k+1/2k+2，
 * 最外层纸正面右为第 1 页、正面左为第 m 页。
 * 帖容量恒为 4 的倍数且 k 为合法纸张序号时，四个本地页码必然都在 1..m 内；
 * 不足一帖的尾部补白由调用方按“本地页 > 帖内实有页数”统一判为 BLANK。
 */
function baselineSheetCells(m: number, k: number): Record<Slot, PageCell> {
  return {
    frontLeft: pageCell(m - 2 * k),
    frontRight: pageCell(2 * k + 1),
    backLeft: pageCell(2 * k + 2),
    backRight: pageCell(m - 2 * k - 1),
  };
}

/** 交换同一张纸同一面上的左右槽位内容（物理换槽，不是另写公式）。 */
function swapLeftRight(cells: Record<Slot, PageCell>, face: Face): void {
  if (face === 'front') {
    const tmp = cells.frontLeft;
    cells.frontLeft = cells.frontRight;
    cells.frontRight = tmp;
  } else {
    const tmp = cells.backLeft;
    cells.backLeft = cells.backRight;
    cells.backRight = tmp;
  }
}

/**
 * 在左订长边基准之上施加两种物理调整：
 * 1. 右订：每一面（正面和背面）交换左右槽位——订口换到右边，第 1 页落到正面左；
 * 2. 短边翻转：在右订调整之后，再只对背面交换左右槽位——
 *    短边翻纸时背面上下颠倒，等价于背面左右镜像。
 * 基准（左订长边）不做任何交换。
 */
function applyBindingAndFlip(
  cells: Record<Slot, PageCell>,
  binding: Binding,
  flip: 'long' | 'short',
): void {
  if (binding === 'right') {
    swapLeftRight(cells, 'front');
    swapLeftRight(cells, 'back');
  }
  if (flip === 'short') {
    swapLeftRight(cells, 'back');
  }
}

/**
 * 逐帖生成拼版公共骨架：按给定的逐帖容量序列，正文页从第 1 页起
 * 按签帖顺序连续装页，每帖用满自己的容量，最后一帖不足处以 BLANK 补齐。
 * 固定容量与库存拼版共用这同一套槽位映射与全局纸张编号，导出不再另算。
 */
export function imposeSequence(
  bodyPages: number,
  signatureSizes: readonly number[],
  binding: Binding,
  flip: Flip,
): ImpositionBase {
  const sheets: Sheet[] = [];
  const locations: Record<number, PageLocation> = {};
  let blankCount = 0;
  let globalSheetIndex = 0;
  let firstPage = 1;

  for (let sig = 1; sig <= signatureSizes.length; sig += 1) {
    const signatureSize = signatureSizes[sig - 1]!;
    const sheetsPerSignature = signatureSize / 4;
    const lastPage = Math.min(firstPage + signatureSize - 1, bodyPages);
    const pagesInSignature = lastPage - firstPage + 1;
    // 每个签帖独立补 BLANK 到满帖；本地页号大于 pagesInSignature 的槽位
    // 在下面 toGlobal 中统一判为 BLANK。

    for (let k = 0; k < sheetsPerSignature; k += 1) {
      // 先按左订长边基准取槽位，再做右订/短边的物理交换；
      // 全程只有这一套排布公式，导出不另算。
      const cells = baselineSheetCells(signatureSize, k);
      applyBindingAndFlip(cells, binding, flip);

      globalSheetIndex += 1;
      const toGlobal = (cell: PageCell): PageCell => {
        if (cell.blank) {
          blankCount += 1;
          return BLANK_CELL;
        }
        const local = cell.page as number;
        if (local <= pagesInSignature) {
          return pageCell(firstPage + local - 1);
        }
        // 本帖尾部的补白页槽位。
        blankCount += 1;
        return BLANK_CELL;
      };

      const sheet: Sheet = {
        sheetIndex: globalSheetIndex,
        signature: sig,
        sheetInSignature: k + 1,
        frontLeft: toGlobal(cells.frontLeft),
        frontRight: toGlobal(cells.frontRight),
        backLeft: toGlobal(cells.backLeft),
        backRight: toGlobal(cells.backRight),
      };

      (['frontLeft', 'frontRight', 'backLeft', 'backRight'] as Slot[]).forEach(
        (slot) => {
          const cell = sheet[slot];
          if (!cell.blank && cell.page !== null) {
            locations[cell.page] = {
              page: cell.page,
              signature: sig,
              sheetIndex: globalSheetIndex,
              sheetInSignature: k + 1,
              face: faceOf(slot),
              slot,
            };
          }
        },
      );

      sheets.push(sheet);
    }

    firstPage += signatureSize;
  }

  return {
    bodyPages,
    binding,
    flip,
    signatureCount: signatureSizes.length,
    sheetCount: sheets.length,
    blankCount,
    sheets,
    locations,
  };
}

/** 生成一次完整拼版。输入非法时抛 ImpositionError，绝不返回半成品。 */
export function impose(input: ImpositionInput): Imposition {
  validateInput(input);
  const { bodyPages, signatureSize, binding, flip } = input;

  const signatureCount = Math.ceil(bodyPages / signatureSize);
  const signatureSizes = Array.from(
    { length: signatureCount },
    () => signatureSize,
  );
  const base = imposeSequence(bodyPages, signatureSizes, binding, flip);

  // 字段顺序保持旧入口不变（JSON 序列化形状稳定）。
  return {
    bodyPages: base.bodyPages,
    signatureSize,
    binding: base.binding,
    flip: base.flip,
    signatureCount: base.signatureCount,
    sheetCount: base.sheetCount,
    blankCount: base.blankCount,
    sheets: base.sheets,
    locations: base.locations,
  };
}

/** 页码反查：返回该页的实体位置；页码不存在（含 BLANK）时返回 undefined。 */
export function locatePage(
  result: ImpositionBase,
  page: number,
): PageLocation | undefined {
  return result.locations[page];
}

/** JSON 导出与测试共用：把 BLANK 单元序列化为 'BLANK'。 */
export function cellToJson(cell: PageCell): number | 'BLANK' {
  return cell.blank || cell.page === null ? 'BLANK' : cell.page;
}

/**
 * 导出用公共部分（可直接 JSON.stringify）。
 * 表格/反查/下载走的是同一个 Imposition 映射，这里只做可序列化整形；
 * 页码反查、翻面卡片、表格与下载 JSON 共用同一全局纸张编号，不另行计算。
 */
function baseToJson(base: ImpositionBase) {
  return {
    bodyPages: base.bodyPages,
    binding: base.binding,
    flip: base.flip,
    signatureCount: base.signatureCount,
    sheetCount: base.sheetCount,
    blankCount: base.blankCount,
    sheets: base.sheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      signature: sheet.signature,
      sheetInSignature: sheet.sheetInSignature,
      frontLeft: cellToJson(sheet.frontLeft),
      frontRight: cellToJson(sheet.frontRight),
      backLeft: cellToJson(sheet.backLeft),
      backRight: cellToJson(sheet.backRight),
    })),
    locations: Object.values(base.locations).sort((a, b) => a.page - b.page),
  };
}

/** 固定容量旧入口导出：字段与顺序保持原样。 */
export function impositionToJson(result: Imposition): {
  bodyPages: number;
  signatureSize: number;
  binding: Binding;
  flip: Flip;
  signatureCount: number;
  sheetCount: number;
  blankCount: number;
  sheets: ReturnType<typeof baseToJson>['sheets'];
  locations: PageLocation[];
};

/** 库存拼版导出：带逐帖容量序列与实际耗用库存。 */
export function impositionToJson(result: InventoryImposition): ReturnType<
  typeof baseToJson
> & {
  signatureSizes: number[];
  usedStock: { capacity: number; count: number }[];
};

export function impositionToJson(result: AnyImposition) {
  const base = baseToJson(result);
  if ('signatureSize' in result) {
    // signatureSize 保持在旧位置（bodyPages 之后、binding 之前）。
    const { bodyPages, ...rest } = base;
    return { bodyPages, signatureSize: result.signatureSize, ...rest };
  }
  return {
    ...base,
    signatureSizes: result.signatureSizes,
    usedStock: result.usedStock.map((item) => ({ ...item })),
  };
}
