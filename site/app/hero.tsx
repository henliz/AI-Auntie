// site/app/Hero.tsx
"use client";

import Link from "next/link";
import React from "react";

type HeroProps = {
  ctaHref?: string;
  leftImageSrc?: string;   // optional floating image (top-left)
  rightImageSrc?: string;  // optional floating image (right)
  iconSrc?: string;        // small rounded app icon near headline
};

export default function Hero({
  ctaHref = "#talk",
  leftImageSrc,
  rightImageSrc,
  iconSrc,
}: HeroProps) {
  return (
    <section className="hero">
      {/* soft pink background wash */}
      <div className="bg" aria-hidden />

      {/* floating decorative images (optional) */}
      {leftImageSrc && (
        <figure className="float left-float">
          <img src={leftImageSrc} alt="" />
        </figure>
      )}
      {rightImageSrc && (
        <figure className="float right-float">
          <img src={rightImageSrc} alt="" />
        </figure>
      )}

      <div className="container">
        <p className="eyebrow">
          When you need help at 3 a.m., you don’t want an app. You want
        </p>

        <h1 className="display">
          <span className="light">your</span>{" "}
          <span className="script">Auntie</span>
          {iconSrc && <img className="appicon" src={iconSrc} alt="" />}
        </h1>

        <p className="sub">
          Real talk, real care, no run-around. Text Auntie and get calm,
          practical help when you need it most. 💗
        </p>

        <div className="ctaWrap">
          <Link href={ctaHref} className="cta">
            <span>Talk to Auntie</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M5 12h14m0 0-6-6m6 6-6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>

      <style jsx>{`
        .hero {
          position: relative;
          display: grid;
          place-items: center;
          padding: min(12vh, 120px) 16px min(16vh, 160px);
          overflow: hidden;
          isolation: isolate;
        }

        /* soft pink/rose wash with subtle grainy feel */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background:
            radial-gradient(60% 50% at 50% 20%, rgba(255, 182, 193, 0.45), rgba(255, 182, 193, 0) 70%),
            radial-gradient(50% 40% at 80% 60%, rgba(255, 105, 180, 0.35), rgba(255, 105, 180, 0) 70%),
            radial-gradient(45% 40% at 20% 70%, rgba(255, 192, 203, 0.35), rgba(255, 192, 203, 0) 70%),
            linear-gradient(180deg, #fff 0%, #fff0 50%, #fff 100%);
          filter: saturate(105%);
          z-index: -2;
        }

        .container {
          max-width: 980px;
          text-align: center;
        }

        .eyebrow {
          font-size: clamp(16px, 2vw, 22px);
          color: rgba(0, 0, 0, 0.7);
          margin: 0 0 10px;
        }

        .display {
          position: relative;
          font-weight: 800;
          line-height: 1.05;
          margin: 0;
          letter-spacing: -0.02em;
          font-size: clamp(36px, 8vw, 84px);
          color: #111;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
        }

        .light {
          font-weight: 600;
        }

        /* give "Auntie" a soft serif/italic feel even without custom fonts */
        .script {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          background: linear-gradient(180deg, #111 0%, #333 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow: 0 8px 24px rgba(255, 105, 180, 0.2);
        }

        .appicon {
          position: relative;
          top: -6px;
          margin-left: 10px;
          width: 52px;
          height: 52px;
          object-fit: cover;
          border-radius: 16px;
          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.15);
        }

        .sub {
          max-width: 740px;
          margin: 16px auto 28px;
          color: rgba(0, 0, 0, 0.7);
          font-size: clamp(16px, 1.8vw, 20px);
          line-height: 1.6;
        }

        .ctaWrap {
          display: flex;
          justify-content: center;
          margin-top: 8px;
        }

        /* glassmorphic pill button */
        .cta {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 22px;
          border-radius: 9999px;
          color: #fff;
          text-decoration: none;
          font-weight: 700;
          letter-spacing: 0.2px;
          background:
            linear-gradient(135deg, rgba(255, 98, 160, 0.95), rgba(255, 72, 146, 0.92)),
            radial-gradient(60% 120% at 30% 0%, rgba(255, 255, 255, 0.25), transparent 50%);
          box-shadow:
            0 12px 40px rgba(255, 72, 146, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: transform 120ms ease, box-shadow 150ms ease, opacity 150ms ease;
        }
        .cta:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 46px rgba(255, 72, 146, 0.45);
        }

        /* floating rounded image “stickers” */
        .float {
          position: absolute;
          overflow: hidden;
          border-radius: 28px;
          background: #fff;
          padding: 8px;
          box-shadow: 0 22px 60px rgba(0, 0, 0, 0.15);
          transform: rotate(-3deg);
          z-index: -1;
        }
        .float img {
          display: block;
          border-radius: 22px;
          width: 220px;
          height: auto;
        }
        .left-float {
          top: 6%;
          left: 4%;
          animation: bob 9s ease-in-out infinite;
        }
        .right-float {
          right: 6%;
          bottom: 8%;
          transform: rotate(3deg);
          animation: bob 11s ease-in-out infinite;
        }

        @keyframes bob {
          0%,
          100% {
            transform: translateY(0) rotate(var(--rot, -3deg));
          }
          50% {
            transform: translateY(-6px) rotate(var(--rot, -3deg));
          }
        }

        @media (max-width: 900px) {
          .float img { width: 160px; }
          .right-float { display: none; } /* keep it clean on small screens */
        }
      `}</style>
    </section>
  );
}
