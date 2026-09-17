"use client";

import { useEffect, useRef, useState } from "react";

/** Where the needle reads from: a fixed offset, so a short section is not counted as already scrolled through. */
const NEEDLE_OFFSET_PX = 96;

/** The slice of the viewport that decides which section is current. */
const READING_BAND = "-18% 0px -68% 0px";

export type RailSection = { readonly id: string; readonly heading: string };

export type SectionRailProps = {
	readonly sections: readonly RailSection[];
	readonly ready: readonly string[];
};

export function SectionRail({ sections, ready }: SectionRailProps) {
	const [current, setCurrent] = useState<string | null>(null);
	const [travel, setTravel] = useState(0);
	const frame = useRef(0);

	useEffect(() => {
		const inBand = new Set<string>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) inBand.add(entry.target.id);
					else inBand.delete(entry.target.id);
				}
				const reached = sections.filter((section) => inBand.has(section.id));
				const last = reached[reached.length - 1];
				if (last !== undefined) setCurrent(last.id);
			},
			{ rootMargin: READING_BAND, threshold: 0 },
		);
		for (const section of sections) {
			const element = document.getElementById(section.id);
			if (element !== null) observer.observe(element);
		}
		return () => observer.disconnect();
	}, [sections, ready]);

	useEffect(() => {
		const measure = (): void => {
			const boxes = sections.map((section) => {
				const element = document.getElementById(section.id);
				if (element === null) return null;
				const rect = element.getBoundingClientRect();
				return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
			});
			const here = window.scrollY + NEEDLE_OFFSET_PX;
			const last = sections.length - 1;
			if (last < 0) return;

			for (const [index, box] of boxes.entries()) {
				if (box === null) continue;
				if (here < box.top) {
					setTravel(index / last);
					return;
				}
				if (here <= box.bottom) {
					const through = (here - box.top) / Math.max(1, box.bottom - box.top);
					setTravel(Math.min(1, (index + through) / last));
					return;
				}
			}
			setTravel(1);
		};
		const onScroll = (): void => {
			cancelAnimationFrame(frame.current);
			frame.current = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(frame.current);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [sections, ready]);

	return (
		<nav aria-label="Report sections" className="gt-dial max-xl:hidden">
			<span className="gt-dial-scale" aria-hidden="true" />
			<span className="gt-dial-needle" style={{ top: `${travel * 100}%` }} aria-hidden="true" />

			<ol className="relative flex h-full flex-col justify-between">
				{sections.map((section, index) => {
					const live = ready.includes(section.id);
					const here = current === section.id;
					return (
						<li key={section.id} className="relative">
							<a
								href={`#${section.id}`}
								aria-current={here ? "true" : undefined}
								className={`gt-notch ${here ? "gt-notch-here" : ""} ${live ? "" : "opacity-40"}`}
							>
								<span className="gt-notch-tick" aria-hidden="true" />
								<span className="gt-notch-index">{String(index + 1).padStart(2, "0")}</span>
								<span className="gt-notch-name">{section.heading}</span>
							</a>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
