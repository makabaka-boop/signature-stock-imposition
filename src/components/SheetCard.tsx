import { useState } from 'react';
import type { Flip, PageCell, Sheet } from '../imposition/types';

function Cell({ cell, label }: { cell: PageCell; label: string }) {
  const text = cell.blank || cell.page === null ? 'BLANK' : String(cell.page);
  return (
    <div className={`cell ${cell.blank ? 'cell-blank' : ''}`}>
      <span className="cell-label">{label}</span>
      <span className="cell-page">{text}</span>
    </div>
  );
}

/**
 * 一张纸的可翻面卡片：正面/背面各两个槽位。
 * 翻面轴跟随翻纸方式：长边翻转绕竖直轴，短边翻转绕水平轴。
 */
export default function SheetCard({
  sheet,
  flipMode,
}: {
  sheet: Sheet;
  flipMode: Flip;
}) {
  const [showBack, setShowBack] = useState(false);

  return (
    <div className="sheet-card">
      <div
        className={
          'sheet-card-inner' +
          (showBack ? ' flipped' : '') +
          (flipMode === 'short' ? ' flip-horizontal' : '')
        }
      >
        <div className="sheet-face sheet-front">
          <div className="face-title">正面（先印）</div>
          <div className="face-cells">
            <Cell cell={sheet.frontLeft} label="正面左" />
            <Cell cell={sheet.frontRight} label="正面右" />
          </div>
        </div>
        <div className="sheet-face sheet-back">
          <div className="face-title">背面（翻面后印）</div>
          <div className="face-cells">
            <Cell cell={sheet.backLeft} label="背面左" />
            <Cell cell={sheet.backRight} label="背面右" />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flip-btn"
        onClick={() => setShowBack((v) => !v)}
      >
        {showBack ? '翻回正面' : '翻到背面'}
      </button>
    </div>
  );
}
