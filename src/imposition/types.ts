// 骑马订拼版核心类型定义。

/** 装订方向：订口在左（西式左翻）或在右（中式右翻）。 */
export type Binding = 'left' | 'right';

/** 翻纸方式：沿长边翻（左右翻页）或沿短边翻（上下翻页）。 */
export type Flip = 'long' | 'short';

/** 纸张上的物理槽位：正面左、正面右、背面左、背面右。 */
export type Slot = 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

/** 槽位所属纸面。 */
export type Face = 'front' | 'back';

/** 拼版入口：固定容量旧入口，或按库存容量拼版。 */
export type ImpositionMode = 'fixed' | 'inventory';

/** 一种库存签帖：容量（4–32 的 4 的倍数）及可用册数（0–8）。 */
export interface InventoryItem {
  size: number;
  count: number;
}

export const SLOTS: readonly Slot[] = [
  'frontLeft',
  'frontRight',
  'backLeft',
  'backRight',
] as const;

/**
 * 一个槽位里放置的内容：
 * - 正文页（page 为正文页码，1 起）
 * - 补白页（blank 为 true，无页码，导出时序列化为 'BLANK'）
 */
export interface PageCell {
  page: number | null;
  blank: boolean;
}

/** 一张实体纸：按实体纸张顺序生成，正面/背面各两个槽位。 */
export interface Sheet {
  /** 全局实体纸张序号，从 1 起，按签帖外→内连续编号。 */
  sheetIndex: number;
  /** 所属签帖序号，从 1 起。 */
  signature: number;
  /** 该签帖的容量（库存拼版时各帖可以不同）。 */
  signatureSize: number;
  /** 签帖内纸张序号，从 1 起（帖内最外层）。 */
  sheetInSignature: number;
  frontLeft: PageCell;
  frontRight: PageCell;
  backLeft: PageCell;
  backRight: PageCell;
}

/** 某一正文页的实体位置，可由页码直接反查。 */
export interface PageLocation {
  page: number;
  signature: number;
  /** 全局实体纸张序号。 */
  sheetIndex: number;
  /** 签帖内纸张序号。 */
  sheetInSignature: number;
  face: Face;
  slot: Slot;
}

/** 库存拼版选中的一种签帖：容量及实际使用册数。 */
export interface UsedSignature {
  size: number;
  used: number;
}

/**
 * 一次合法拼版的完整结果。表格、反查、卡片预览与 JSON 导出共用此结构。
 * fixed 为固定容量旧入口（结构与旧版逐字段一致）；
 * inventory 为库存拼版，记录选中的容量序列与库存消耗。
 */
export type Imposition = FixedImposition | InventoryImposition;

interface BaseImposition {
  bodyPages: number;
  binding: Binding;
  flip: Flip;
  /** 签帖总数。 */
  signatureCount: number;
  /** 实体纸张总数（所有签帖之和）。 */
  sheetCount: number;
  /** 补入的 BLANK 页总数。 */
  blankCount: number;
  /** 按实体纸张顺序（签帖顺序 × 帖内外→内）排列的纸张。 */
  sheets: Sheet[];
  /** 页码 → 实体位置的反查表。 */
  locations: Record<number, PageLocation>;
}

/** 固定容量旧入口结果（固定容量旧入口及四种翻转模式结果不变）。 */
export interface FixedImposition extends BaseImposition {
  mode: 'fixed';
  signatureSize: number;
}

/** 库存拼版结果。 */
export interface InventoryImposition extends BaseImposition {
  mode: 'inventory';
  /** 按签帖顺序排列的各帖容量（仅最后一帖可补白）。 */
  signatureSizes: number[];
  /** 每种容量实际消耗的库存册数（只列 used > 0，按容量升序）。 */
  usedSignatures: UsedSignature[];
}

/** 固定容量拼版输入参数。 */
export interface ImpositionInput {
  bodyPages: number;
  signatureSize: number;
  binding: Binding;
  flip: Flip;
}

/** 库存拼版输入参数。 */
export interface InventoryImpositionInput {
  bodyPages: number;
  inventory: InventoryItem[];
  binding: Binding;
  flip: Flip;
}

export const BLANK_CELL: PageCell = { page: null, blank: true };

export function pageCell(page: number): PageCell {
  return { page, blank: false };
}

/** 槽位 → 纸面。 */
export function faceOf(slot: Slot): Face {
  return slot === 'frontLeft' || slot === 'frontRight' ? 'front' : 'back';
}

export const SLOT_LABEL: Record<Slot, string> = {
  frontLeft: '正面左',
  frontRight: '正面右',
  backLeft: '背面左',
  backRight: '背面右',
};

export const FACE_LABEL: Record<Face, string> = {
  front: '正面',
  back: '背面',
};
