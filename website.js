// Local illustrative documents only: no model requests, tracking or customer data.
(() => {
  const tabs = [...document.querySelectorAll('[data-document]')];
  function select(tab, moveFocus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
    if (moveFocus) tab.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(tabs[next], true); }
    });
  }
  const media = matchMedia('(max-width: 760px)');
  const orientation = () => document.querySelector('.sample-tabs')?.setAttribute('aria-orientation', media.matches ? 'horizontal' : 'vertical');
  orientation(); media.addEventListener('change', orientation);
})();
