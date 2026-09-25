import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

// React 18 并发渲染测试环境标记
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderApp(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container, root };
}

function setNumberInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('App 冒烟', () => {
  it('默认展示 8 页合法拼版，表格行数 = 纸张数', () => {
    const { container, root } = renderApp();
    expect(container.textContent).toContain('8 页正文');
    expect(container.textContent).toContain('2 张实体纸');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    act(() => root.unmount());
  });

  it('非法输入不覆盖上次合法拼版，合法提交后更新', () => {
    const { container, root } = renderApp();
    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    );
    const bodyPagesInput = inputs[0]!;
    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '生成拼版',
    )!;

    // 非法：0 页
    setNumberInput(bodyPagesInput, '0');
    click(applyBtn);
    expect(container.textContent).toContain('参数非法，已保留上次合法拼版');
    expect(container.textContent).toContain('8 页正文');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    // 合法：12 页 / 默认 8 帖容量 → 2 帖 4 张纸
    setNumberInput(bodyPagesInput, '12');
    click(applyBtn);
    expect(container.textContent).not.toContain('参数非法');
    expect(container.textContent).toContain('12 页正文');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    act(() => root.unmount());
  });

  it('页码反查显示签帖/纸张/面/槽位', () => {
    const { container, root } = renderApp();
    const lookupInput = container.querySelector<HTMLInputElement>(
      '.lookup input',
    )!;
    setNumberInput(lookupInput, '8');
    const result = container.querySelector('[data-testid="lookup-result"]');
    expect(result?.textContent).toContain('第 8 页');
    expect(result?.textContent).toContain('签帖 1');
    expect(result?.textContent).toContain('正面左');
    act(() => root.unmount());
  });
});

describe('App 库存拼版', () => {
  const getButton = (container: HTMLElement, text: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === text,
    )!;

  const clickRadio = (el: Element) => {
    act(() => {
      // 只派发 click：原生行为会把未选中的单选置为选中并触发 change；
      // 若先手动 checked=true 再 click，状态未变反而不触发 React onChange。
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  const clickInventoryMode = (container: HTMLElement) => {
    const radios = container.querySelectorAll('input[name="mode"]');
    clickRadio(radios[1]!); // 第二个模式单选 = 库存拼版
  };

  const fireInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** 一次性填好库存表单的 5 个数字框（在同一 act 内，避免逐框重渲染丢引用）。 */
  const fillInventoryForm = (
    container: HTMLElement,
    values: [string, string, string, string, string],
  ) => {
    const labels = [
      '正文页数',
      '库存签帖 1 容量',
      '库存签帖 1 册数',
      '库存签帖 2 容量',
      '库存签帖 2 册数',
    ];
    const inputs = labels.map((label) =>
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      )!,
    );
    act(() => {
      inputs.forEach((input, i) => fireInputValue(input, values[i]!));
    });
  };

  it('切换到库存拼版，输入 10 页 / 4×2,8×2 后渲染 [4,8] 两张帖 3 张纸', () => {
    const { container, root } = renderApp();

    clickInventoryMode(container);

    fillInventoryForm(container, ['10', '4', '2', '8', '2']);

    click(getButton(container, '生成拼版'));

    expect(container.textContent).toContain('10 页正文');
    expect(container.textContent).toContain('容量序列 4 / 8');
    expect(container.textContent).toContain('3 张实体纸');
    expect(container.textContent).toContain('补白 2 页');
    expect(container.textContent).toContain('库存拼版');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    act(() => root.unmount());
  });

  it('库存不足 NO_IMPOSITION 时保留上次合法拼版，不生成部分纸张', () => {
    const { container, root } = renderApp();

    clickInventoryMode(container);

    fillInventoryForm(container, ['100', '4', '1', '8', '1']);

    click(getButton(container, '生成拼版'));

    expect(container.textContent).toContain('NO_IMPOSITION');
    expect(container.textContent).toContain('已保留上次合法拼版');
    // 表格仍是旧的固定容量 8 页 2 张纸，没有任何半成品
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).toContain('8 页正文');
    act(() => root.unmount());
  });

  it('非法库存（容量 6 / 册数 9）保留上次合法拼版并报错', () => {
    const { container, root } = renderApp();

    clickInventoryMode(container);

    fillInventoryForm(container, ['10', '6', '1', '8', '9']);

    click(getButton(container, '生成拼版'));

    expect(container.textContent).toContain('参数非法');
    expect(container.textContent).toContain('已保留上次合法拼版');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    act(() => root.unmount());
  });
});
