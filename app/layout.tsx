import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Ground Truth",
	description:
		"Type a US address. Read what the public environmental record says about it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="h-full antialiased">
			<body className="min-h-full">{children}</body>
		</html>
	);
}
