import { useState } from 'react';
import { locatePage } from '../imposition/imposition';
import { FACE_LABEL, SLOT_LABEL, type Imposition } from '../imposition/types';

/** 页码反查：输入正文页码，给出签帖 / 纸张 / 面 / 槽位。 */
export default function PageLookup({ imposition }: { imposition: Imposition }) {
  const [raw, setRaw] = useState('1');

  const page = Number(raw);
  const valid =
    raw.trim() !== '' &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= imposition.bodyPages;
  const location = valid ? locatePage(imposition, page) : undefined;

  return (
    <section className="panel">
      <h2>页码反查</h2>
      <div className="lookup">
        <label>
          页码（1–{imposition.bodyPages}）
          <input
            type="number"
            min={1}
            max={imposition.bodyPages}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
        {valid && location ? (
          <p className="lookup-result" data-testid="lookup-result">
            第 {location.page} 页 → 签帖 {location.signature} · 第{' '}
            {location.sheetIndex} 张实体纸（帖内第 {location.sheetInSignature}{' '}
            张）· {FACE_LABEL[location.face]} · {SLOT_LABEL[location.slot]}
          </p>
        ) : (
          <p className="lookup-result muted">
            {raw.trim() === ''
              ? '请输入页码。'
              : '页码超出范围（BLANK 补白页不属于正文页码）。'}
          </p>
        )}
      </div>
    </section>
  );
}
