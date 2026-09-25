"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTheme } from "@/hooks/useTheme";
import { COLORS, HUES, hexToRgba } from "@/lib/palette";

const darkOrbs = [
  {
    color: hexToRgba(HUES.violet500, 0.08),
    mid: hexToRgba(HUES.violet500, 0.03),
    size: "60vw",
    top: "-10%",
    left: "0%",
    dx: 40,
    dy: 25,
    duration: 20,
  },
  {
    color: hexToRgba(COLORS.bitcoin, 0.06),
    mid: hexToRgba(COLORS.bitcoin, 0.02),
    size: "55vw",
    top: "40%",
    right: "-5%",
    dx: -30,
    dy: -35,
    duration: 25,
  },
  {
    color: hexToRgba(HUES.blue500, 0.06),
    mid: hexToRgba(HUES.blue500, 0.02),
    size: "50vw",
    bottom: "-10%",
    left: "25%",
    dx: 25,
    dy: -20,
    duration: 22,
  },
];

const lightOrbs = [
  {
    color: hexToRgba(HUES.violet400, 0.06),
    mid: hexToRgba(HUES.violet400, 0.02),
    size: "60vw",
    top: "-10%",
    left: "0%",
    dx: 40,
    dy: 25,
    duration: 20,
  },
  {
    color: hexToRgba(HUES.amber400, 0.05),
    mid: hexToRgba(HUES.amber400, 0.015),
    size: "55vw",
    top: "40%",
    right: "-5%",
    dx: -30,
    dy: -35,
    duration: 25,
  },
  {
    color: hexToRgba(HUES.blue300, 0.06),
    mid: hexToRgba(HUES.blue300, 0.02),
    size: "50vw",
    bottom: "-10%",
    left: "25%",
    dx: 25,
    dy: -20,
    duration: 22,
  },
];

export function AmbientBackground() {
  const prefersReduced = useReducedMotion();
  const { theme } = useTheme();

  const orbs = theme === "light" ? lightOrbs : darkOrbs;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
    >
      {orbs.map((orb, i) => {
        const style: React.CSSProperties = {
          width: orb.size,
          height: orb.size,
          top: orb.top,
          left: orb.left,
          right: orb.right,
          bottom: orb.bottom,
          background: `radial-gradient(circle at center, ${orb.color} 0%, ${orb.mid} 40%, transparent 70%)`,
          borderRadius: "50%",
          position: "absolute",
        };

        if (prefersReduced) {
          return <div key={i} style={style} />;
        }

        return (
          <motion.div
            key={i}
            style={style}
            animate={{
              x: [0, orb.dx, -orb.dx * 0.5, 0],
              y: [0, orb.dy, -orb.dy * 0.5, 0],
            }}
            transition={{
              duration: orb.duration,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        );
      })}
    </div>
  );
}
