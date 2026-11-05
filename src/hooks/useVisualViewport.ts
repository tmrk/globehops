import { useEffect } from 'react';

/**
 * Mirrors the visual viewport (the part of the page not covered by the on-screen keyboard)
 * into CSS custom properties, so overlays can stay above the keyboard on iOS and Android:
 *   --vv-top, --vv-height
 */
export function useVisualViewportVars(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const height = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      root.style.setProperty('--vv-height', `${Math.round(height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
}
