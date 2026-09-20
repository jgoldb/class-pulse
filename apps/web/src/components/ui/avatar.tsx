import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn, initials } from '../../lib/utils';

const HUES = [175, 255, 60, 300, 20, 120, 210];
function hueFor(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const s = { sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-12 text-sm', xl: 'size-16 text-lg' }[size];
  const hue = hueFor(name);
  return (
    <AvatarPrimitive.Root className={cn('relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold', s, className)} style={{ background: `oklch(0.92 0.05 ${hue})`, color: `oklch(0.4 0.1 ${hue})` }}>
      {src && <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0}>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
