export interface GameWindowState {
  id: string;
  url: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

interface WindowDefaults {
  width: number;
  height: number;
}

const windows = ref<GameWindowState[]>([]);
let nextZIndex = 50;
let cascadeOffset = 0;

export function useWindowManager() {
  function openWindow(id: string, url: string, defaults: WindowDefaults) {
    if (windows.value.find(w => w.id === id)) {
      focusWindow(id);
      return;
    }

    const offset = cascadeOffset * 30;
    cascadeOffset = (cascadeOffset + 1) % 5; // cascade wraps after 5 windows

    const x = Math.min(100 + offset, Math.max(0, window.innerWidth - defaults.width - 40));
    const y = Math.min(80 + offset, Math.max(0, window.innerHeight - defaults.height - 40));

    nextZIndex++;
    windows.value.push({
      id,
      url: url + (url.includes('?') ? '&' : '?') + 'windowed=1',
      position: { x, y },
      size: { width: defaults.width, height: defaults.height },
      zIndex: nextZIndex,
    });
  }

  function closeWindow(id: string) {
    windows.value = windows.value.filter(w => w.id !== id);
  }

  function focusWindow(id: string) {
    const win = windows.value.find(w => w.id === id);
    if (win) {
      nextZIndex++;
      win.zIndex = nextZIndex;
    }
  }

  function updatePosition(id: string, position: { x: number; y: number }) {
    const win = windows.value.find(w => w.id === id);
    if (win) win.position = position;
  }

  function updateSize(id: string, size: { width: number; height: number }) {
    const win = windows.value.find(w => w.id === id);
    if (win) win.size = size;
  }

  return {
    windows: readonly(windows),
    openWindow,
    closeWindow,
    focusWindow,
    updatePosition,
    updateSize,
  };
}
