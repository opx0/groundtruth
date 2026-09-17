import type { ReactNode } from "react";

export type TopBarProps = {
	readonly children?: ReactNode;
};

export function TopBar({ children }: TopBarProps) {
	return (
		<header className="gt-bar">
			<span className="gt-display shrink-0 text-lg font-bold uppercase tracking-wide">Ground Truth</span>
			{children === undefined ? null : <nav className="flex items-center gap-1 sm:gap-2">{children}</nav>}
		</header>
	);
}

export function BarLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
	return (
		<a
			href={href}
			className="rounded-full px-3 py-2 text-xs text-[var(--on-ground-muted)] transition-colors hover:text-[var(--on-ground)] sm:text-sm"
		>
			{children}
		</a>
	);
}
