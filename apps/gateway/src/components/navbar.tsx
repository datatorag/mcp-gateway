"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCurrentUser } from "@/lib/use-current-user";
import { useDismissable } from "@/lib/use-dismissable";
import { PromoBanner } from "@/components/promo-banner";
import { signInHref } from "@/lib/sign-in";
import { CtaLink } from "@/components/cta-link";
import { GithubMark, REPOSITORY_URL } from "@/components/github-mark";

interface NavLink {
  href: string;
  label: string;
}

const productItems: NavLink[] = [
  { href: "/#platform", label: "Platform" },
  { href: "/#custom-hosted-llms", label: "Custom Hosted LLMs" },
  { href: "/#services", label: "Services" },
  { href: "/#integrations", label: "Integrations" },
];

const flatItems: NavLink[] = [
  { href: "/pricing", label: "Pricing" },
  { href: "/skills", label: "Skills" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
  { href: "/contact", label: "Contact" },
];

const navItemClass =
  "rounded-lg px-3 py-2 text-sm text-white/70 transition-colors hover:text-white";
const navItemMobileClass =
  "block rounded-lg px-3 py-2.5 text-sm text-white/70 transition-colors hover:text-white";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const user = useCurrentUser();
  // A signed-in visitor's CTA re-enters the product where login lands: the
  // Agent is the front door (SCRUM-70), and the old "Dashboard" label pointed
  // at a page whose heading now says Connections (SCRUM-118).
  const ctaHref = user ? "/dashboard/agent" : signInHref();
  const ctaLabel = user ? "Open Agent" : "Get Started";

  const closeProduct = useCallback(() => setProductOpen(false), []);
  useDismissable(dropdownRef, productOpen, closeProduct);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-4 pt-4">
      {/* SCRUM-231: every page with a navbar carries the promo banner. */}
      <PromoBanner />
      <div className="mx-auto max-w-6xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/datatorag-logo-256.png"
              alt="DataToRAG"
              width={26}
              height={26}
            />
            <span className="font-display text-[15px] font-bold tracking-tight text-white">
              DataToRAG
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setProductOpen((v) => !v)}
                aria-expanded={productOpen}
                className={`${navItemClass} flex cursor-pointer items-center gap-1`}
              >
                Product
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${productOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  <path d="M2 4l3 3 3-3" />
                </svg>
              </button>
              {productOpen && (
                <div className="absolute left-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-black/90 shadow-xl backdrop-blur-xl">
                  {productItems.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={closeProduct}
                      className="block px-4 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {flatItems.map((item) => (
              <Link key={item.href} href={item.href} className={navItemClass}>
                {item.label}
              </Link>
            ))}

            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:text-white"
            >
              <GithubMark size={18} />
            </a>
            <CtaLink
              href={ctaHref}
              className="ml-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
            >
              {ctaLabel}
            </CtaLink>
          </nav>

          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:text-white lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {mobileOpen ? (
                <>
                  <path d="M5 5l10 10" />
                  <path d="M15 5L5 15" />
                </>
              ) : (
                <>
                  <path d="M3 6h14" />
                  <path d="M3 10h14" />
                  <path d="M3 14h14" />
                </>
              )}
            </svg>
          </button>
        </div>

        {mobileOpen && (
          <nav className="border-t border-white/10 px-5 pb-4 pt-3">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Product
            </div>
            {productItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={navItemMobileClass}
              >
                {item.label}
              </a>
            ))}

            <div className="my-2 h-px bg-white/10" />

            {flatItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={navItemMobileClass}
              >
                {item.label}
              </Link>
            ))}
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMobile}
              className={navItemMobileClass}
            >
              GitHub
            </a>
            <CtaLink
              href={ctaHref}
              onClick={closeMobile}
              className="mt-2 block rounded-xl bg-white px-4 py-2.5 text-center text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
            >
              {ctaLabel}
            </CtaLink>
          </nav>
        )}
      </div>
    </header>
  );
}
