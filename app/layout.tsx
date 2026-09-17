import type { Metadata } from "next";
import { Caveat, Inter, Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const hand = Caveat({ subsets: ["latin"], weight: "600", variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
	title: "Ground Truth",
	description:
		"Type a US address. Read what the public environmental record says about it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`h-full antialiased ${display.variable} ${sans.variable} ${hand.variable}`}>
			<body className="min-h-full">{children}</body>
		</html>
	);
}
