/** Block browser gestures without intercepting OrbitControls' wheel/pointer input. */
export function nativeFeel() {
  const preventZoom = (event: Event) => event.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, preventZoom, { passive: false });
  }
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault();
    },
    { passive: false },
  );
}
