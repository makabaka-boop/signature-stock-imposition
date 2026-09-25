import { useState } from 'react';
import type { Imposition, PageCell, Sheet } from '../imposition/types';
import SheetCard from './SheetCard';

function CellValue({ cell }: { cell: PageCell }) {
  if (cell.blank || cell.page === null) {
    return <span className="blank">BLANK</span>;
  }
  return <span className="page-no">{cell.page}</span>;
}

function SheetRow({
  sheet,
  active,
  onSelect,
}: {
  sheet: Sheet;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      className={active ? 'selected' : undefined}
      onClick={onSelect}
      style={{ cursor: 'pointer' }}
    >
      <td>{sheet.sheetIndex}</td>
      <td>{sheet.signature}</td>
      <td>{sheet.sheetInSignature}</td>
      <td><CellValue cell={sheet.frontLeft} /></td>
      <td><CellValue cell={sheet.frontRight} /></td>
      <td><CellValue cell={sheet.backLeft} /></td>
      <td><CellValue cell={sheet.backRight} /></td>
    </tr>
  );
}

/**
 * 实体纸张顺序表 + 可翻面卡片预览。
 * 表格与卡片渲染的是同一个 Imposition 映射，不做二次计算。
 */
export default function SheetTable({ imposition }: { imposition: Imposition }) {
  const [selected, setSelected] = useState(0);
  const sheet = imposition.sheets[selected] ?? imposition.sheets[0];

  return (
    <section className="panel">
      <h2>实体纸张顺序（印刷顺序）</h2>
      <div className="sheet-layout">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>纸张#</th>
                <th>签帖</th>
                <th>帖内张</th>
                <th>正面左</th>
                <th>正面右</th>
                <th>背面左</th>
                <th>背面右</th>
              </tr>
            </thead>
            <tbody>
              {imposition.sheets.map((s, i) => (
                <SheetRow
                  key={s.sheetIndex}
                  sheet={s}
                  active={i === selected}
                  onSelect={() => setSelected(i)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {sheet && (
          <div className="card-wrap">
            <h3>
              卡片预览：第 {sheet.sheetIndex} 张（签帖 {sheet.signature} 第{' '}
              {sheet.sheetInSignature} 张）
            </h3>
            <SheetCard sheet={sheet} flipMode={imposition.flip} />
          </div>
        )}
      </div>
    </section>
  );
}
