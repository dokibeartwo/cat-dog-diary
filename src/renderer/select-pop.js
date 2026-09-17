// 主题化下拉弹层：系统原生的 select 弹出列表蓝色高亮无法跟随主题，
// 这里接管所有 <select> 的弹层渲染（主界面与提醒共用 select-pop.css），
// select 本体仍保留原生语义，app.js 对 .value 的读取与 change 监听无需改动。
(function () {
  const pop = document.createElement("div");
  pop.className = "select-pop";
  pop.id = 'theme-select-popup';
  pop.setAttribute('role', 'listbox');
  pop.hidden = true;
  let owner = null;
  let rows = [];

  function buildRows(select) {
    pop.innerHTML = "";
    rows = Array.from(select.options).map((option, index) => {
      const row = document.createElement("div");
      row.className = "select-pop__option";
      row.id = `theme-select-option-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.setAttribute('aria-disabled', String(option.disabled || select.disabled));
      row.classList.toggle('is-disabled', option.disabled);
      if (option.selected) row.classList.add("is-selected");
      row.textContent = option.textContent;
      row.addEventListener("pointerenter", () => { if (!option.disabled) setActive(index); });
      row.addEventListener("click", () => commit(select, index));
      pop.appendChild(row);
      return row;
    });
  }

  function setActive(index) {
    if (owner?.options[index]?.disabled) return;
    rows.forEach((row, i) => row.classList.toggle("is-active", i === index));
    if (rows[index]) owner?.setAttribute('aria-activedescendant', rows[index].id);
    rows[index]?.scrollIntoView({ block: "nearest" });
  }

  function commit(select, index) {
    if (select.disabled || !select.options[index] || select.options[index].disabled) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
    if (select.isConnected) select.focus({ preventScroll: true });
  }

  function place(select) {
    const host = select.closest("dialog");
    const bounds = host ? host.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const rect = select.getBoundingClientRect();
    pop.style.minWidth = `${Math.round(rect.width)}px`;
    pop.style.maxWidth = `${Math.max(80, bounds.right - bounds.left - 16)}px`;
    pop.style.fontSize = `${Math.max(16, parseFloat(getComputedStyle(select).fontSize))}px`;
    pop.style.maxHeight = `${Math.max(52, Math.min(280, Math.max(bounds.bottom - rect.bottom, rect.top - bounds.top) - 16))}px`;
    pop.hidden = false;
    pop.style.visibility = "hidden";
    pop.style.left = "0px";
    pop.style.top = "0px";
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    // dialog 在 top layer 会成为 fixed 定位的包含块，先在 0,0 处实测包含块原点再换算坐标
    const origin = pop.getBoundingClientRect();
    const spaceBelow = bounds.bottom - rect.bottom;
    const spaceAbove = rect.top - bounds.top;
    const left = Math.min(Math.max(rect.left, bounds.left + 8), bounds.right - width - 8);
    let top = spaceBelow >= height + 10 || spaceBelow >= spaceAbove ? rect.bottom + 6 : rect.top - height - 6;
    top = Math.min(Math.max(top, bounds.top + 8), bounds.bottom - height - 8);
    pop.style.left = `${Math.round(left - origin.left)}px`;
    pop.style.top = `${Math.round(top - origin.top)}px`;
    pop.style.visibility = "";
    const selected = pop.querySelector('.is-selected');
    if (selected) {
      const luminance = (css) => {
        const values = (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const bg = luminance(getComputedStyle(selected).backgroundColor);
      pop.style.setProperty('--select-selected-ink', (1.05 / (bg + .05)) >= 4.5 ? '#fff' : '#201b27');
    }
  }

  function open(select) {
    document.dispatchEvent(new CustomEvent('theme-popup-opening', {detail:pop}));
    close();
    owner = select;
    select.setAttribute('aria-expanded', 'true');
    select.setAttribute('aria-controls', pop.id);
    buildRows(select);
    (select.closest("dialog") || document.body).appendChild(pop);
    place(select);
    setActive(select.options[select.selectedIndex]?.disabled ? Array.from(select.options).findIndex((item) => !item.disabled) : select.selectedIndex);
    select.focus({ preventScroll: true });
  }

  function close() {
    if (!owner) return;
    owner.setAttribute('aria-expanded', 'false');
    owner.removeAttribute('aria-activedescendant');
    owner = null;
    rows = [];
    pop.hidden = true;
  }

  document.addEventListener("mousedown", (event) => {
    if (pop.contains(event.target)) { event.preventDefault(); return; }
    const select = event.target.closest ? event.target.closest("select") : null;
    if (select && select === owner) { event.preventDefault(); close(); return; }
    close();
    if (select && !select.disabled) {
      event.preventDefault();
      open(select);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (owner) {
      const current = rows.findIndex((row) => row.classList.contains("is-active"));
      const move = (start, direction) => {
        for (let index = start; index >= 0 && index < rows.length; index += direction) {
          if (!owner.options[index].disabled) { setActive(index); return; }
        }
      };
      if (event.key === "Escape") {
        // 只关弹层：阻止事件继续传播和对话框的 cancel 默认动作，避免整个弹窗被关闭
        event.stopPropagation();
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown") { event.preventDefault(); move(current + 1, 1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); move(current - 1, -1); return; }
      if (event.key === "Home") { event.preventDefault(); move(0, 1); return; }
      if (event.key === "End") { event.preventDefault(); move(rows.length - 1, -1); return; }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); commit(owner, Math.max(current, 0)); return; }
      if (event.key === "Tab") close();
      return;
    }
    const select = event.target.closest ? event.target.closest("select") : null;
    if (select && !select.disabled && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      open(select);
    }
  }, true);

  document.addEventListener("scroll", (event) => {
    if (!pop.contains(event.target)) close();
  }, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  document.addEventListener('theme-popup-opening', event => { if(event.detail!==pop)close(); });
  new MutationObserver(() => { if (owner && (!owner.isConnected || owner.disabled || !owner.getClientRects().length)) close(); })
    .observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled', 'open', 'hidden']});
})();
