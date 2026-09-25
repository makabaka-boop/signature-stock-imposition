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

describe('库存拼版流程', () => {
  function switchToInventory(container: HTMLElement) {
    const modeRadios = container.querySelectorAll<HTMLInputElement>(
      'input[name="mode"]',
    );
    click(modeRadios[1]!);
  }

  it('库存模式：默认 8×2 + 16×1，8 页正文只用一帖 8', () => {
    const { container, root } = renderApp();
    switchToInventory(container);

    // 库存行出现，固定容量输入消失
    expect(container.querySelectorAll('.stock-row')).toHaveLength(2);
    expect(
      container.querySelector('input[aria-label="签帖容量"]'),
    ).toBeNull();

    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '生成拼版',
    )!;
    click(applyBtn);

    expect(container.textContent).toContain('8 页正文');
    expect(container.textContent).toContain('1 个签帖');
    expect(container.textContent).toContain('容量序列：8');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    act(() => root.unmount());
  });

  it('库存不足显示 NO_IMPOSITION 且保留上次合法拼版', () => {
    const { container, root } = renderApp();
    switchToInventory(container);

    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '生成拼版',
    )!;
    // 先提交一次合法库存拼版（8 页 → [8]）
    click(applyBtn);
    expect(container.textContent).toContain('容量序列：8');

    // 正文页数改为 100，库存最多 32 页 → NO_IMPOSITION
    const bodyPagesInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="正文页数"]',
    )!;
    setNumberInput(bodyPagesInput, '100');
    click(applyBtn);

    expect(container.textContent).toContain('NO_IMPOSITION');
    expect(container.textContent).toContain('已保留上次合法拼版');
    expect(container.textContent).toContain('8 页正文');
    expect(container.textContent).toContain('容量序列：8');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    act(() => root.unmount());
  });

  it('库存行可增删（2–4 种），非法容量提交报错且保留旧拼版', () => {
    const { container, root } = renderApp();
    switchToInventory(container);

    const addBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '添加一种签帖',
    )!;
    click(addBtn);
    click(addBtn);
    expect(container.querySelectorAll('.stock-row')).toHaveLength(4);
    // 已到上限，按钮禁用
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);

    // 把容量 1 改成与容量 2 相同的 16 → 重复容量非法
    const cap1 = container.querySelector<HTMLInputElement>(
      'input[aria-label="容量 1"]',
    )!;
    setNumberInput(cap1, '16');
    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '生成拼版',
    )!;
    click(applyBtn);
    expect(container.textContent).toContain('已保留上次合法拼版');
    expect(container.textContent).toContain('重复');
    // 旧拼版（固定容量 8 页）仍在
    expect(container.textContent).toContain('8 页正文');
    act(() => root.unmount());
  });
});
