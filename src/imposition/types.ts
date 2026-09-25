// 骑马订拼版核心类型定义。

/** 装订方向：订口在左（西式左翻）或在右（中式右翻）。 */
export type Binding = 'left' | 'right';

/** 翻纸方式：沿长边翻（左右翻页）或沿短边翻（上下翻页）。 */
export type Flip = 'long' | 'short';

/** 纸张上的物理槽位：正面左、正面右、背面左、背面右。 */
export type Slot = 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

/** 槽位所属纸面。 */
export type Face = 'front' | 'back';

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

/** 一次合法拼版的完整结果。表格、反查、卡片预览与 JSON 导出共用此结构。 */
export interface Imposition {
  bodyPages: number;
  signatureSize: number;
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

/** 拼版输入参数。 */
export interface ImpositionInput {
  bodyPages: number;
  signatureSize: number;
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
