import type { Controls } from "../input";

/**
 * A floating stick on the left half of the screen (it appears where the thumb
 * lands) and jump and fold buttons on the right. Multi-touch safe.
 */
export function mountTouch(root: HTMLElement, controls: Controls, haptic: (ms: number) => void) {
  const zone = root.querySelector<HTMLElement>("#stick-zone")!;
  const stick = root.querySelector<HTMLElement>("#stick")!;
  const knob = root.querySelector<HTMLElement>("#stick-knob")!;
  const jump = root.querySelector<HTMLElement>("#touch-jump")!;
  const fold = root.querySelector<HTMLElement>("#touch-fold")!;
  const RANGE = 46;
  let stickId: number | null = null;
  let origin = { x: 0, y: 0 };

  const place = (x: number, y: number) => {
    stick.style.left = `${x}px`;
    stick.style.top = `${y}px`;
  };
  const rest = () => {
    stick.classList.remove("live");
    stick.style.left = "";
    stick.style.top = "";
    knob.style.transform = "";
    controls.setTouch(0, 0);
  };

  zone.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const r = zone.getBoundingClientRect();
    origin = { x: e.clientX - r.left, y: e.clientY - r.top };
    place(origin.x, origin.y);
    stick.classList.add("live");
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    const r = zone.getBoundingClientRect();
    let dx = e.clientX - r.left - origin.x;
    let dy = e.clientY - r.top - origin.y;
    const d = Math.hypot(dx, dy);
    // The stick follows a thumb that drifts too far, so it never runs out of travel.
    if (d > RANGE * 1.6) {
      const k = (d - RANGE * 1.6) / d;
      origin.x += dx * k;
      origin.y += dy * k;
      place(origin.x, origin.y);
      dx -= dx * k;
      dy -= dy * k;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / RANGE);
    const a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * m * RANGE}px, ${Math.sin(a) * m * RANGE}px)`;
    const dead = 0.18;
    const mag = m < dead ? 0 : (m - dead) / (1 - dead);
    controls.setTouch(Math.cos(a) * mag, Math.sin(a) * mag);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    rest();
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
  zone.addEventListener("lostpointercapture", end);

  const hold = (el: HTMLElement, down: () => void, up: () => void = () => {}) => {
    const ids = new Set<number>();
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      el.classList.add("held");
      down();
    });
    const release = (e: PointerEvent) => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) {
        el.classList.remove("held");
        up();
      }
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  };
  hold(
    jump,
    () => controls.touchJumpDown(),
    () => controls.touchJumpUp(),
  );
  hold(fold, () => {
    controls.touchFold();
    haptic(12);
  });

  return { reset: rest };
}
