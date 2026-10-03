// Touch controls for phones and tablets: a thumb stick on the left half of the screen,
// drag on the right half to look around, and a few round buttons for the actions.

export interface TouchHandlers {
  // True while the player is walking around (not on the title, not in view mode).
  active: () => boolean;
  move: (x: number, y: number) => void; // stick, -1..1 each; y is forward
  look: (dx: number, dy: number) => void; // pixels dragged
  press: (code: string) => void; // same codes as the keyboard
}

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

const STICK_RADIUS = 48;

export function setupTouch(canvas: HTMLCanvasElement, h: TouchHandlers) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick')!;
  const knob = document.getElementById('knob')!;
  let stickId = -1;
  let lookId = -1;
  let sx = 0;
  let sy = 0;
  let lx = 0;
  let ly = 0;

  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const endStick = () => {
    stickId = -1;
    stick.classList.remove('show');
    setKnob(0, 0);
    h.move(0, 0);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !h.active()) return;
    // The left part of the screen walks; the rest looks around.
    if (e.clientX < window.innerWidth * 0.42 && stickId < 0) {
      stickId = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      stick.style.left = `${sx}px`;
      stick.style.top = `${sy}px`;
      stick.classList.add('show');
      setKnob(0, 0);
    } else if (lookId < 0) {
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - sx;
      let dy = e.clientY - sy;
      const l = Math.hypot(dx, dy);
      if (l > STICK_RADIUS) {
        dx *= STICK_RADIUS / l;
        dy *= STICK_RADIUS / l;
      }
      setKnob(dx, dy);
      h.move(dx / STICK_RADIUS, -dy / STICK_RADIUS);
    } else if (e.pointerId === lookId) {
      h.look((e.clientX - lx) * 1.8, (e.clientY - ly) * 1.8);
      lx = e.clientX;
      ly = e.clientY;
    }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId === stickId) endStick();
    if (e.pointerId === lookId) lookId = -1;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  for (const b of document.querySelectorAll<HTMLButtonElement>('#touch-buttons button')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.press(b.dataset.key!);
    });
  }
  // Long presses and double taps should not select text or zoom the page.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    reset: endStick,
    // Only show the cancel button while there is something to cancel.
    setCancel(show: boolean) {
      document.getElementById('touch-cancel')!.hidden = !show;
    },
  };
}
