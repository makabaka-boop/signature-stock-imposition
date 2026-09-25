import {
  BLANK_CELL,
  faceOf,
  pageCell,
  type Binding,
  type Face,
  type Imposition,
  type ImpositionInput,
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

/** 生成一次完整拼版。输入非法时抛 ImpositionError，绝不返回半成品。 */
export function impose(input: ImpositionInput): Imposition {
  validateInput(input);
  const { bodyPages, signatureSize, binding, flip } = input;

  const sheetsPerSignature = signatureSize / 4;
  const signatureCount = Math.ceil(bodyPages / signatureSize);

  const sheets: Sheet[] = [];
  const locations: Record<number, PageLocation> = {};
  let blankCount = 0;
  let globalSheetIndex = 0;

  for (let sig = 1; sig <= signatureCount; sig += 1) {
    const firstPage = (sig - 1) * signatureSize + 1;
    const lastPage = Math.min(sig * signatureSize, bodyPages);
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
  }

  return {
    bodyPages,
    signatureSize,
    binding,
    flip,
    signatureCount,
    sheetCount: sheets.length,
    blankCount,
    sheets,
    locations,
  };
}

/** 页码反查：返回该页的实体位置；页码不存在（含 BLANK）时返回 undefined。 */
export function locatePage(
  result: Imposition,
  page: number,
): PageLocation | undefined {
  return result.locations[page];
}

/** JSON 导出与测试共用：把 BLANK 单元序列化为 'BLANK'。 */
export function cellToJson(cell: PageCell): number | 'BLANK' {
  return cell.blank || cell.page === null ? 'BLANK' : cell.page;
}

/**
 * 导出用纯数据（可直接 JSON.stringify）。
 * 表格/反查/下载走的是同一个 Imposition 映射，这里只做可序列化整形。
 */
export function impositionToJson(result: Imposition) {
  return {
    bodyPages: result.bodyPages,
    signatureSize: result.signatureSize,
    binding: result.binding,
    flip: result.flip,
    signatureCount: result.signatureCount,
    sheetCount: result.sheetCount,
    blankCount: result.blankCount,
    sheets: result.sheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      signature: sheet.signature,
      sheetInSignature: sheet.sheetInSignature,
      frontLeft: cellToJson(sheet.frontLeft),
      frontRight: cellToJson(sheet.frontRight),
      backLeft: cellToJson(sheet.backLeft),
      backRight: cellToJson(sheet.backRight),
    })),
    locations: Object.values(result.locations).sort(
      (a, b) => a.page - b.page,
    ),
  };
}
