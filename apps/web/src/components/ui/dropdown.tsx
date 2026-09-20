import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({ className, align = 'end', ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn('z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-lg animate-pop', className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({ className, icon, danger, children, ...props }: ComponentProps<typeof DropdownPrimitive.Item> & { icon?: ReactNode; danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:text-muted', danger && 'text-danger-fg data-[highlighted]:bg-danger-soft', className)}
      {...props}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownCheckItem({ checked, children, ...props }: ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem checked={checked} className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken" {...props}>
      <span className="flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{children}</DropdownPrimitive.Label>;
}
export const DropdownSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
