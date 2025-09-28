// site/app/Nav.tsx
"use client";

import Link from "next/link";
import React from "react";

type NavProps = {
  logoSrc?: string;      // optional logo (e.g. "/logo.svg")
  brand?: string;        // optional text brand next to the logo
  ctaHref?: string;      // where the CTA goes (default "#talk")
};

const LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "About", href: "#about" },
  { label: "How it Works", href: "#how" },
  { label: "Demo", href: "#demo" },
];

export default function Nav({ logoSrc, brand = "Auntie", ctaHref = "#talk" }: NavProps) {
  return (
    <div className="nav-wrap">
      <nav className="glass">
        <div className="left">
          {logoSrc ? (
            <img className="logo" src={logoSrc} alt={`${brand} logo`} />
          ) : (
            <div className="logo-placeholder" aria-hidden />
          )}
          <span className="brand">{brand}</span>
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
          <Link href={ctaHref} className="cta">Talk to Auntie</Link>
        </div>

        {/* liquid highlight */}
        <span className="glow" aria-hidden />
      </nav>

      <style jsx>{`
        .nav-wrap {
          display: flex;
          justify-content: center;
          padding: 16px 16px 0;
        }

        /* Centered pill that's narrower than the viewport */
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

          color: #fff;
          background:
            linear-gradient(135deg, rgba(255, 182, 193, 0.22), rgba(255, 105, 180, 0.18));
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.35);
          box-shadow:
            0 8px 24px rgba(234, 57, 141, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.35);

          overflow: hidden; /* for the animated liquid highlight */
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
          z-index: 1; /* above glow */
        }

        .logo {
          width: 34px;
          height: 34px;
          object-fit: contain;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.18);
        }

        .logo-placeholder {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.18);
        }

        .brand {
          font-weight: 700;
          letter-spacing: 0.2px;
          text-shadow: 0 1px 0 rgba(0,0,0,0.12);
        }

        .links {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          list-style: none;
          padding: 0;
          margin: 0;
          z-index: 1;
        }

        .link {
          display: inline-block;
          padding: 8px 12px;
          border-radius: 9999px;
          text-decoration: none;
          color: rgba(255,255,255,0.96);
          transition: background 150ms ease, transform 120ms ease, color 150ms ease;
          white-space: nowrap;
        }
        .link:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          transform: translateY(-1px);
        }

        .right {
          display: flex;
          justify-content: flex-end;
          z-index: 1;
        }

        .cta {
          padding: 10px 16px;
          border-radius: 9999px;
          text-decoration: none;
          color: #fff;
          background: linear-gradient(135deg, rgba(255, 105, 180, 0.95), rgba(255, 72, 146, 0.95));
          box-shadow: 0 6px 18px rgba(255, 72, 146, 0.35);
          transition: transform 120ms ease, box-shadow 150ms ease, opacity 150ms ease;
          font-weight: 600;
        }
        .cta:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(255,72,146,0.45); }
        .cta:active { transform: translateY(0); }

        /* Responsiveness */
        @media (max-width: 900px) {
          .links { gap: 2px; }
          .link { padding: 8px 10px; }
        }
        @media (max-width: 720px) {
          .glass { grid-template-columns: auto 1fr auto; height: 58px; }
          .brand { display: none; } /* keep it minimal on small screens */
          .links { overflow-x: auto; scrollbar-width: none; }
          .links::-webkit-scrollbar { display: none; }
        }
      `}</style>
    </div>
  );
}
