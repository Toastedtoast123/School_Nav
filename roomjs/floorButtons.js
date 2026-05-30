(function () {
  
  if (window.__floorButtonsInitialized) return;

  function highlightActiveFloorButton(floorNum) {
    const wrap = document.getElementById('floor-model-buttons');
    if (!wrap) return;
    const buttons = Array.from(wrap.querySelectorAll('.floor-btn'));
    buttons.forEach((btn, idx) => {
      const active = idx + 1 === floorNum;
      btn.classList.toggle('is-active-floor', active);
    });
  }


  function setup() {
    const roomListEl = document.querySelector('.room-list');
    if (!roomListEl) return;

    if (!Array.isArray(window.MODELS) || typeof window.__setFloorModel !== 'function') {
      return;
    }

    // expose to 3D viewer so it can highlight when setModelByIndex() is called during routing
    window.__highlightActiveFloor = highlightActiveFloorButton;

    const existing = document.getElementById('floor-model-buttons');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'floor-model-buttons';

    for (let i = 0; i < window.MODELS.length; i++) {
      const model = window.MODELS[i];
      const label = model?.labels || `Floor ${i + 1}`;

      const btn = document.createElement('button');
      btn.textContent = label;
      
      btn.classList.add('floor-btn');

      btn.addEventListener('click', () => {
        window.__setFloorModel(i);
        highlightActiveFloorButton(i + 1);
      });
      wrap.appendChild(btn);
    }

    roomListEl.appendChild(wrap);
  }

  document.addEventListener('DOMContentLoaded', setup);
  window.addEventListener('load', setup);

// Keep the active floor highlighted when URL changes or route sets floor model
  window.addEventListener('load', () => {
  const m = (window.location.pathname || '').match(/(room|floor)([1-6])\.html/);
  if (m) highlightActiveFloorButton(Number(m[2]));
});

  window.addEventListener('hashchange', () => {
  const m = (window.location.pathname || '').match(/(room|floor)([1-6])\.html/);
  if (m) highlightActiveFloorButton(Number(m[2]));
});

// Expose to new.js so auto-switch can call it
  window.__highlightActiveFloor = highlightActiveFloorButton;

window.__floorButtonsInitialized = true;
})();
