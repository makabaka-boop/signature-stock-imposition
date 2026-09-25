import { imposeSequence, ImpositionError } from './imposition';
import type {
  InventoryImposition,
  InventoryImpositionInput,
  InventoryStockItem,
} from './types';

/** 库存不足时的结果码：不生成任何部分纸张。 */
export const NO_IMPOSITION = 'NO_IMPOSITION';

/** 库存不足（输入本身合法，但现有签帖凑不出这本书）。 */
export class InventoryShortageError extends Error {
  readonly code = NO_IMPOSITION;
  constructor() {
    super(NO_IMPOSITION);
    this.name = 'InventoryShortageError';
  }
}

/**
 * 库存拼版参数校验：
 * - 正文页数：1 至 512 的整数
 * - binding：left | right；flip：long | short
 * - 库存条目：2 至 4 种；容量 4–32 且为 4 的倍数、互不相同；册数 0–8 的整数
 * 非法输入抛 ImpositionError，调用方保留上次合法拼版。
 */
export function validateInventoryInput(input: {
  bodyPages: unknown;
  binding: unknown;
  flip: unknown;
  stock: unknown;
}): asserts input is InventoryImpositionInput {
  const errors: string[] = [];
  const { bodyPages, binding, flip, stock } = input;

  if (
    typeof bodyPages !== 'number' ||
    !Number.isInteger(bodyPages) ||
    bodyPages < 1 ||
    bodyPages > 512
  ) {
    errors.push('正文页数必须是 1 至 512 的整数');
  }
  if (binding !== 'left' && binding !== 'right') {
    errors.push('装订方向必须是 left 或 right');
  }
  if (flip !== 'long' && flip !== 'short') {
    errors.push('翻纸方式必须是 long 或 short');
  }

  if (!Array.isArray(stock) || stock.length < 2 || stock.length > 4) {
    errors.push('库存拼版需要 2 至 4 种签帖容量');
  } else {
    const seen = new Set<number>();
    stock.forEach((item, i) => {
      const label = `第 ${i + 1} 种签帖`;
      if (item === null || typeof item !== 'object') {
        errors.push(`${label}必须是 { capacity, count } 对象`);
        return;
      }
      const { capacity, count } = item as Record<string, unknown>;
      if (
        typeof capacity !== 'number' ||
        !Number.isInteger(capacity) ||
        capacity < 4 ||
        capacity > 32 ||
        capacity % 4 !== 0
      ) {
        errors.push(`${label}容量必须是 4 至 32 之间 4 的倍数`);
      } else if (seen.has(capacity)) {
        errors.push(`签帖容量 ${capacity} 重复，库存条目必须互不相同`);
      } else {
        seen.add(capacity);
      }
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > 8
      ) {
        errors.push(`${label}可用册数必须是 0 至 8 的整数`);
      }
    });
  }

  if (errors.length > 0) {
    throw new ImpositionError(errors);
  }
}

/**
 * 规划容量序列：枚举库存约束下的所有用量组合，依次
 * 1. 最小化总补白页（= 总容量 − 正文页数，即最小化总容量）；
 * 2. 最小化使用签帖数（序列长度）；
 * 3. 取容量序列字典序最小者。
 *
 * 序列按升序排列：升序就是同多重集里字典序最小的排列；且最小总容量
 * 方案下每种用到的容量 c 都满足 c > 补白数 b（否则去掉一帖 c 会得到
 * 仍 ≥ N 的更小总容量，矛盾），所以升序时最后一帖容量必然大于 b，
 * “除最后一帖外全部装满”的装页规则对升序序列恒可执行，库存不超额。
 *
 * 返回升序容量序列；库存不足以覆盖正文页数时返回 null。
 */
export function planInventorySequence(
  bodyPages: number,
  stock: readonly InventoryStockItem[],
): number[] | null {
  // 按容量升序枚举，用量向量展开即升序容量序列。
  const items = [...stock].sort((a, b) => a.capacity - b.capacity);
  const n = items.length;
  const used = new Array<number>(n).fill(0);

  interface Candidate {
    blanks: number;
    signatures: number;
    /** 升序容量序列（同一用量向量下字典序最小的排列）。 */
    sequence: number[];
  }

  /** 升序序列字典序比较（短序列为他者前缀时更短者更小）。 */
  const lexLess = (
    a: readonly number[],
    b: readonly number[],
  ): boolean => {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const x = a[i];
      const y = b[i];
      if (x === undefined) return y !== undefined;
      if (y === undefined) return false;
      if (x !== y) return x < y;
    }
    return false;
  };

  /** a 是否严格优于 b（补白 → 签帖数 → 容量序列字典序）。 */
  const prefers = (a: Candidate, b: Candidate | null): boolean =>
    b === null ||
    a.blanks < b.blanks ||
    (a.blanks === b.blanks && a.signatures < b.signatures) ||
    (a.blanks === b.blanks &&
      a.signatures === b.signatures &&
      lexLess(a.sequence, b.sequence));

  // DFS 直接返回当前子树的最优候选，避免闭包可变变量的类型收窄问题。
  const dfs = (i: number): Candidate | null => {
    if (i === n) {
      let total = 0;
      let signatures = 0;
      const sequence: number[] = [];
      for (let j = 0; j < n; j += 1) {
        total += used[j]! * items[j]!.capacity;
        signatures += used[j]!;
        for (let k = 0; k < used[j]!; k += 1) sequence.push(items[j]!.capacity);
      }
      if (total < bodyPages) return null;
      return { blanks: total - bodyPages, signatures, sequence };
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

/**
 * 库存拼版主入口：校验 → 规划 → 逐帖复用固定容量的物理槽位映射。
 * 参数非法抛 ImpositionError；库存不足抛 InventoryShortageError
 * （结果码 NO_IMPOSITION），绝不返回部分纸张的半成品。
 */
export function imposeInventory(
  input: InventoryImpositionInput,
): InventoryImposition {
  validateInventoryInput(input);
  const { bodyPages, binding, flip, stock } = input;

  const sequence = planInventorySequence(bodyPages, stock);
  if (sequence === null) {
    throw new InventoryShortageError();
  }

  const base = imposeSequence(bodyPages, sequence, binding, flip);

  const usedStock: InventoryStockItem[] = [...stock]
    .sort((a, b) => a.capacity - b.capacity)
    .map((item) => ({
      capacity: item.capacity,
      count: sequence.filter((s) => s === item.capacity).length,
    }));

  return {
    ...base,
    signatureSizes: sequence,
    usedStock,
  };
}
