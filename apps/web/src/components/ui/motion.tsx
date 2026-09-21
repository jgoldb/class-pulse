import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';

export const spring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 } as const;

/**
 * Page-level enter transition keyed on the route. Enter only, on purpose.
 *
 * This used to be an `AnimatePresence mode="wait"` cross-fade, and that left pages blank until a
 * reload. The children here are an `<Outlet />`, which follows the router: while the old wrapper
 * was animating out it was already rendering the *new* page, so anything in that page with a
 * `layoutId` (the segmented filter on Cases, the tabs on a case) registered with the exiting
 * presence context. framer-motion's layout tracker only reports itself finished on a later
 * re-render, never on mount, so the exit never completed, the new wrapper never mounted, and the
 * page sat at opacity 0. Whether a re-render happened to come along in time made it flaky:
 * reproducible on the deployment, rarely at home. With no exit there is nothing to wait on.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const reduce = useReducedMotion();
  return (
    <motion.div key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

/** Stagger children on mount. */
export function Stagger({ children, className, delay = 0.04 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={{ hidden: reduce ? {} : { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: spring } }}>
      {children}
    </motion.div>
  );
}

export function FadeIn({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay }}>
      {children}
    </motion.div>
  );
}

/** A number that eases to its new value. */
export function AnimatedNumber({ value, className, format = (n) => Math.round(n).toString() }: { value: number; className?: string; format?: (n: number) => string }) {
  const s = useSpring(value, { stiffness: 200, damping: 26 });
  const text = useTransform(s, (v) => format(v));
  useEffect(() => {
    s.set(value);
  }, [value, s]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Tap feedback for large touch targets (quick entry). */
export const tap = { whileTap: { scale: 0.94 }, transition: spring } as const;
export { motion, AnimatePresence };
