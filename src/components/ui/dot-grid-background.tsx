import { useEffect, useRef } from "react";
import { animate } from "motion";

const DOT_SPACING = 44;
const DOT_SIZE = 3.5;
const MOUSE_RADIUS = 165;
const RIPPLE_SPEED = 1400;

interface DotData {
  x: number;
  y: number;
  el: HTMLDivElement;
}

export function DotGridBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dots: DotData[] = [];
    let activeIndexes = new Set<number>();
    let rafId: number | null = null;
    let pendingMouse: { x: number; y: number } | null = null;

    const half = DOT_SIZE / 2;

    const createDots = () => {
      container.innerHTML = "";
      dots = [];
      activeIndexes.clear();

      const W = window.innerWidth;
      const H = window.innerHeight;

      const fragment = document.createDocumentFragment();

      for (let y = 0; y <= H + DOT_SPACING; y += DOT_SPACING) {
        for (let x = 0; x <= W + DOT_SPACING; x += DOT_SPACING) {
          const el = document.createElement("div");
          el.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            margin-left: -${half}px;
            margin-top: -${half}px;
            width: ${DOT_SIZE}px;
            height: ${DOT_SIZE}px;
            border-radius: 50%;
            background: #0a0a0a;
            opacity: 0.13;
            will-change: transform, opacity;
          `;
          fragment.appendChild(el);
          dots.push({ x, y, el });
        }
      }

      container.appendChild(fragment);
    };

    const processMouse = (mx: number, my: number) => {
      const newActive = new Set<number>();

      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const dx = dot.x - mx;
        const dy = dot.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MOUSE_RADIUS) {
          newActive.add(i);
          const f = 1 - dist / MOUSE_RADIUS;
          animate(
            dot.el,
            {
              scale: 1 + f * 2.4,
              opacity: 0.13 + f * 0.77,
              y: -f * 9,
            },
            { duration: 0.18, ease: "easeOut" }
          );
        }
      }

      activeIndexes.forEach((i) => {
        if (!newActive.has(i)) {
          animate(
            dots[i].el,
            { scale: 1, opacity: 0.13, y: 0 },
            { duration: 0.5, ease: "easeOut" }
          );
        }
      });

      activeIndexes = newActive;
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingMouse = { x: e.clientX, y: e.clientY };
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (pendingMouse) processMouse(pendingMouse.x, pendingMouse.y);
          rafId = null;
        });
      }
    };

    const handleClick = (e: MouseEvent) => {
      const cx = e.clientX;
      const cy = e.clientY;

      for (const dot of dots) {
        const dx = dot.x - cx;
        const dy = dot.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const delay = dist / RIPPLE_SPEED;

        animate(
          dot.el,
          {
            scale: [1, 3.8, 1],
            opacity: [0.13, 0.88, 0.13],
            y: [0, -16, 0],
          },
          {
            duration: 0.42,
            delay,
            ease: [0.22, 1, 0.36, 1],
          }
        );
      }
    };

    createDots();

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("click", handleClick, { passive: true });
    window.addEventListener("resize", createDots);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("resize", createDots);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
    />
  );
}
