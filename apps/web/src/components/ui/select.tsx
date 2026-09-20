import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Select({ value, onChange, options, placeholder = 'Choose…', className, size = 'md', ariaLabel, groups }: { value: string | null; onChange: (v: string) => void; options?: SelectOption[]; groups?: Array<{ label: string; options: SelectOption[] }>; placeholder?: string; className?: string; size?: 'sm' | 'md'; ariaLabel?: string }) {
  const renderOpt = (o: SelectOption) => (
    <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className="relative flex cursor-pointer select-none items-start gap-2 rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-sunken data-[disabled]:opacity-50">
      <span className="absolute left-2 top-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <div>
        <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
        {o.description && <div className="text-xs text-muted">{o.description}</div>}
      </div>
    </SelectPrimitive.Item>
  );
  return (
    <SelectPrimitive.Root value={value ?? undefined} onValueChange={onChange}>
      <SelectPrimitive.Trigger aria-label={ariaLabel} className={cn('flex w-full items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 text-sm shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring data-[placeholder]:text-subtle', size === 'sm' ? 'h-8 text-xs' : 'h-10', className)}>
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-lg animate-pop">
          <SelectPrimitive.Viewport>
            {options?.map(renderOpt)}
            {groups?.map((g) => (
              <SelectPrimitive.Group key={g.label}>
                <SelectPrimitive.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.label}</SelectPrimitive.Label>
                {g.options.map(renderOpt)}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
