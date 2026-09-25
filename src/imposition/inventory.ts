import type { InventoryItem, InventoryImpositionInput, UsedSignature } from './types';
import { ImpositionError } from './imposition';

/**
 * 库存拼版参数校验（bodyPages / binding / flip 的校验与固定入口共用同一套规则）：
 * - 2～4 种签帖，容量互不相同、4～32 且为 4 的倍数；
 * - 每种可用册数 0～8 的整数（0 册允许，仅表示该种暂时不可用）；
 * - 库存条目本身非法即报错，调用方必须保留上次合法拼版。
 * 注意：库存“不够用”（无可行序列）不在此处报错，而是规划失败 NO_IMPOSITION。
 */
export function validateInventoryInput(input: {
  bodyPages: unknown;
  inventory: unknown;
  binding: unknown;
  flip: unknown;
}): asserts input is InventoryImpositionInput {
  const errors: string[] = [];
  const { bodyPages, inventory, binding, flip } = input;

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

  if (!Array.isArray(inventory)) {
    errors.push('库存签帖必须是 2～4 种容量的列表');
  } else {
    if (inventory.length < 2 || inventory.length > 4) {
      errors.push('必须提供 2～4 种互不相同的签帖容量');
    }
    const sizes: number[] = [];
    inventory.forEach((item, i) => {
      const where = `第 ${i + 1} 种签帖`;
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { size?: unknown }).size !== 'number'
      ) {
        errors.push(`${where}：容量必须是数字`);
        return;
      }
      const { size, count } = item as { size: unknown; count?: unknown };
      if (
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 4 ||
        size > 32 ||
        size % 4 !== 0
      ) {
        errors.push(`${where}：签帖容量必须是 4 至 32 之间 4 的倍数`);
      } else {
        sizes.push(size);
      }
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > 8
      ) {
        errors.push(`${where}：可用册数必须是 0 至 8 的整数`);
      }
    });
    if (sizes.length !== new Set(sizes).size) {
      errors.push('签帖容量必须互不相同');
    }
  }

  if (errors.length > 0) {
    throw new ImpositionError(errors);
  }
}

/** 库存容量上限校验抛出的固定错误码。 */
export const NO_IMPOSITION = 'NO_IMPOSITION';

/** 库存无法凑出可行序列：规划失败，绝不生成部分纸张。 */
export class NoImpositionError extends Error {
  readonly code: typeof NO_IMPOSITION = NO_IMPOSITION;
  constructor(message = '库存签帖无法完成本书：NO_IMPOSITION') {
    super(message);
    this.name = 'NoImpositionError';
  }
}

export interface SignaturePlan {
  /** 按签帖顺序排列的容量序列（前面签帖装满，仅最后一帖可补白）。 */
  sizes: number[];
  /** 每种容量实际消耗的库存册数（只列 used > 0，按容量升序）。 */
  usedSignatures: UsedSignature[];
}

/**
 * 库存拼版规划：
 * 每本书按签帖顺序连续装页，除最后一帖可补 BLANK 外，前面签帖必须装满。
 * 一个容量序列 s1..sk 可行，当且仅当：
 *   Σs ≥ bodyPages 且 bodyPages − (Σs − s_last) ≥ 1
 *   （前面 k−1 帖装满后，最后一帖至少还剩 1 个正文页），
 * 且每种容量使用册数不超过库存可用册数。
 *
 * 优化顺序（严格字典序比较目标）：
 *   1. 总补白页最少（= Σs − bodyPages 最小，即总容量最小）；
 *   2. 使用签帖数最少（k 最小）；
 *   3. 容量序列字典序最小（标准字典序：s_t < t_t 的首个位置定序）。
 *
 * 对同一容量多重集，按容量升序排列总是其所有可行排列中字典序最小者，
 * 因此只枚举“各容量选取册数”的多重集（≤ 9^4 = 6561 个叶子），
 * 再把选中的容量升序排列即可；DFS 按容量升序展开，平局时先到达者即最优。
 */
export function planInventorySignatures(
  bodyPages: number,
  inventory: InventoryItem[],
): SignaturePlan {
  const sizes = [...inventory]
    .map((item) => ({ size: item.size, count: item.count }))
    .sort((a, b) => a.size - b.size);

  type Candidate = { sizes: number[]; total: number };

  const isBetter = (
    candidate: Candidate,
    best: Candidate | null,
  ): boolean => {
    if (best === null) return true;
    const { sizes: seq, total } = candidate;
    if (total !== best.total) return total < best.total;
    if (seq.length !== best.sizes.length) return seq.length < best.sizes.length;
    for (let i = 0; i < seq.length; i += 1) {
      if (seq[i] !== best.sizes[i]) {
        return (seq[i] as number) < (best.sizes[i] as number);
      }
    }
    return false;
  };

  // chosen：截至当前深度选中的容量序列（已按容量升序）。
  // DFS 直接返回当前子树最优候选，避免闭包赋值导致的类型收窄问题。
  const dfs = (
    index: number,
    chosen: number[],
    total: number,
    bestSoFar: Candidate | null,
  ): Candidate | null => {
    let best = bestSoFar;
    if (index === sizes.length) {
      if (chosen.length === 0) return best;
      const last = chosen[chosen.length - 1] as number;
      // 前面各帖装满后落入最后一帖的正文页数；末帖空帖不允许。
      const pagesIntoLast = bodyPages - (total - last);
      if (pagesIntoLast >= 1 && pagesIntoLast <= last) {
        const candidate = { sizes: [...chosen], total };
        if (isBetter(candidate, best)) return candidate;
      }
      return best;
    }

    const { size, count } = sizes[index] as { size: number; count: number };
    // 选 c = 0..count 册；c=0 直接深入，c≥1 先推入再深入（推入次数与递归次数
    // 严格配对），容量升序展开使同总容量/同长度下天然先遇到字典序小的序列。
    for (let c = 0; c <= count; c += 1) {
      if (c > 0) {
        chosen.push(size);
        total += size;
      }
      // 已有解时，总容量已不可能更优的分支直接剪掉。
      if (best === null || total <= best.total) {
        best = dfs(index + 1, chosen, total, best);
      }
    }
    // 回溯本深度推入的全部副本。
    chosen.length -= count;
    return best;
  };

  const winner = dfs(0, [], 0, null);
  if (winner === null) {
    throw new NoImpositionError();
  }

  const usedSignatures: UsedSignature[] = sizes
    .map(({ size }) => ({
      size,
      used: winner.sizes.filter((s: number) => s === size).length,
    }))
    .filter((entry) => entry.used > 0);

  return { sizes: winner.sizes, usedSignatures };
}
