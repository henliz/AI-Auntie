// site/app/Nav.tsx
"use client";

import Link from "next/link";
import React from "react";

type NavProps = {
  logoSrc?: string;
  brand?: string;
  ctaHref?: string;
};

const LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "About", href: "#about" },
  { label: "How it Works", href: "#how" },
];

export default function Nav({ logoSrc, brand = "Auntie", ctaHref = "#talk" }: NavProps) {
  const scrollTop = () =>
    window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="nav-fixed">
      <nav className="glass">
        <div className="left">
          {/* Make logo + brand clickable to scroll to top */}
          <button className="home" onClick={scrollTop} aria-label="Go to top">
            {logoSrc ? (
              <img className="logo" src="AuntieLogo.png" alt={`${brand} logo`} />
            ) : (
              <div className="logo-placeholder" aria-hidden />
            )}
            {/* Brand styled to match "your Auntie" */}
            <span className="brand-script">{brand}</span>
          </button>
        </div>

        <ul className="links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="link">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="right">
          {/* Real button with smooth/shine hover */}
          <button
            type="button"
            className="cta"
            onClick={() => (window.location.href = ctaHref!)}
          >
            <span>Talk to Auntie</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12h14m0 0-6-6m6 6-6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <span className="glow" aria-hidden />
      </nav>

      <style jsx>{`
        /* Accent variables shared by brand + CTA (match hero's pinks) */
        .nav-fixed {
          --accent-1: #ff5ea3;
          --accent-2: #ff2f88;
          --text-strong: #111; /* same dark text used in hero */
          position: fixed;
          top: calc(env(safe-area-inset-top, 0px) + 12px);
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          display: flex;
          justify-content: center;
          z-index: 9999;
          pointer-events: none;
        }

        .glass {
          position: relative;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 16px;
          width: min(1100px, 92vw);
          height: 64px;
          padding: 8px 14px;
          border-radius: 9999px;

          color: var(--text-strong);

          /* Stronger, frostier glass look */
          background-color: rgba(255, 255, 255, 0.42);
          background-image: linear-gradient(
            135deg,
            rgba(255, 182, 193, 0.24),
            rgba(255, 105, 180, 0.20)
          );
          backdrop-filter: blur(50px) saturate(125%);
          -webkit-backdrop-filter: blur(23px) saturate(125%);
          border: 1px solid rgba(255, 255, 255, 0.35);
          box-shadow:
            0 8px 24px rgba(234, 57, 141, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.35);
          overflow: hidden;
          pointer-events: auto; /* pill is clickable */
        }
        /* subtle top sheen */
        .glass::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 42%);
          pointer-events: none;
        }

        .glow {
          position: absolute;
          inset: -40%;
          background:
            radial-gradient(40% 60% at 20% 30%, rgba(255, 255, 255, 0.18), transparent 60%),
            radial-gradient(30% 45% at 80% 70%, rgba(255, 240, 245, 0.16), transparent 60%);
          animation: float 12s linear infinite;
          pointer-events: none;
        }
        @keyframes float {
          0% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-3%, 2%, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }

        .left {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-left: 6px;
          z-index: 1;
        }
        /* make logo+brand one clickable target */
        .home {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 0;
          margin: 0;
          background: transparent;
          border: 0;
          cursor: pointer;
        }
        .home:focus-visible {
          outline: 2px solid rgba(255, 105, 180, 0.45);
          outline-offset: 3px;
        }

        .logo { width: 45px; height: 45px; object-fit: contain; border-radius: 10px; background: rgba(255,255,255,0.18); }
        .logo-placeholder { width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,0.18); }

        /* Brand matches Hero's "your Auntie" look */
        .brand-script {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          font-size: 20px;
          background: linear-gradient(180deg, #111 0%, #333 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 6px 18px rgba(255, 72, 146, 0.25);
          letter-spacing: 0.2px;
        }

        /* Middle tabs: more spacing + same text color as hero */
        .links {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 22px;            /* more spaced out */
          list-style: none;
          padding: 0;
          margin: 0;
          z-index: 1;
        }
        .link {
          display: inline-block;
          padding: 8px 2px;     /* tighter pill, but can click */
          border-radius: 9999px;
          text-decoration: none;
          color: rgba(17,17,17,0.9);      /* hero text color */
          transition: background 150ms ease, transform 120ms ease, color 150ms ease;
          white-space: nowrap;
        }
        .link:hover {
          background: rgba(0,0,0,0.06);
          transform: translateY(-1px);
        }

        .right { display: flex; justify-content: flex-end; z-index: 1; }

        /* CTA: real button, a touch more saturated blush, smooth & shiny hover */
        .cta {
          --sat1: #ff4fa0;      /* slightly more saturated than accent-1 */
          --sat2: #ff2a87;      /* slightly more saturated than accent-2 */
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.45);
          background: linear-gradient(135deg, #e37f64, #db5a7a);
          color: #fff;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.2px;
          cursor: pointer;

          box-shadow:
            0 12px 28px rgba(255, 72, 146, 0.35),
            inset 0 1px 0 rgba(255,255,255,0.55);
          backdrop-filter: blur(8px) saturate(115%);
          -webkit-backdrop-filter: blur(8px) saturate(115%);
          transition:
            transform 220ms cubic-bezier(.22,.61,.36,1),
            box-shadow 240ms ease,
            filter 240ms ease,
            background 260ms ease;
          overflow: hidden;
        }
        .cta svg { width: 18px; height: 18px; }
        .cta::before {
          content: "";
          position: absolute;
          top: -150%;
          left: -40%;
          width: 40%;
          height: 400%;
          background: linear-gradient(
            75deg,
            transparent 0%,
            rgba(255,255,255,0.0) 40%,
            rgba(255,255,255,0.55) 50%,
            rgba(255,255,255,0.0) 60%,
            transparent 100%
          );
          transform: translateX(-120%);
          transition: transform 600ms ease;
          pointer-events: none;
        }
        .cta:hover {
          transform: translateY(-2px) scale(1.03);
          filter: saturate(118%);
          box-shadow: 0 18px 40px rgba(255,72,146,0.42), inset 0 1px 0 rgba(255,255,255,0.6);
          background: linear-gradient(150deg, #ff815e, #ed5379);
        }
        .cta:hover::before { transform: translateX(280%); }
        .cta:active { transform: translateY(0) scale(0.995); }

        /* Responsive tweaks */
        @media (max-width: 900px) {
          .links { gap: 14px; }
        }
        @media (max-width: 720px) {
          .glass { grid-template-columns: auto 1fr auto; height: 58px; }
          .brand-script { display: none; } /* keep it minimal on small screens */
          .links { overflow-x: auto; scrollbar-width: none; }
          .links::-webkit-scrollbar { display: none; }
        }
      `}</style>
    </div>
  );
}

