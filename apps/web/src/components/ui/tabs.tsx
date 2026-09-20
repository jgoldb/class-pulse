import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/** Underline tabs with an animated indicator. */
export function TabsList({ tabs, value, className, layoutId = 'tabs' }: { tabs: Array<{ id: string; label: ReactNode; count?: number }>; value: string; className?: string; layoutId?: string }) {
  return (
    <TabsPrimitive.List className={cn('relative flex gap-1 overflow-x-auto border-b border-border', className)}>
      {tabs.map((t) => (
        <TabsPrimitive.Trigger
          key={t.id}
          value={t.id}
          className={cn('relative -mb-px flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:text-fg')}
        >
          {t.label}
          {t.count !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', value === t.id ? 'bg-primary-soft text-primary-soft-fg' : 'bg-sunken text-muted')}>{t.count}</span>}
          {value === t.id && <motion.span layoutId={layoutId} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}

/** Segmented control for a small set of options. */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md' }: { options: Array<{ value: T; label: ReactNode }>; value: T | null; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-md bg-sunken p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-[7px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : size === 'lg' ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join('-')}`} className="absolute inset-0 rounded-[7px] bg-elevated shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
