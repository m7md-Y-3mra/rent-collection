import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rent Collection",
  description: "Malaysia property rent accounts and collections",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense
          fallback={
            <main
              className="mx-auto w-full max-w-7xl space-y-6 p-8"
              aria-label="Loading rent account"
            >
              <Skeleton className="h-12 w-64" />
              <Skeleton className="h-64 w-full" />
            </main>
          }
        >
          {children}
        </Suspense>
        <Toaster richColors />
      </body>
    </html>
  );
}
