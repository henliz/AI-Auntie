// app/hero.tsx
"use client";
import Link from "next/link";
import React from "react";

type HeroProps = {
  ctaHref?: string;
  leftImageSrc?: string;
  rightImageSrc?: string;
  iconSrc?: string;
};

export default function Hero({
  ctaHref = "#talk",
  leftImageSrc,
  rightImageSrc,
  iconSrc,
}: HeroProps) {
  return (
    <section className="hero">
      {/* soft white + pink radial field */}
      <div className="bg" aria-hidden />

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
          If you need help at 3 am,
        </p>
        <p className="eyebrow">you don’t want an app— you want</p>
        <br></br>

        <h1 className="display">

          <span className="script">your</span>{" "}
          <span className="script">Auntie</span>
          {iconSrc && <img className="appicon" src="AuntieLogo.png" alt="" />}
        </h1>

        <p className="sub">
        <br></br>
          Real talk, real care, no run-around. Text Auntie and get calm,
          practical help when you need it most. 💗
        </p>
        <br></br>

        <div className="ctaWrap">
          <button
            type="button"
            className="cta"
            onClick={() => (window.location.href = ctaHref)}
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

      </div>

      <style jsx global>{`
        html, body { height: 100%; margin: 0; background: #fff; }
      `}</style>

      <style jsx>{`
        .hero {
          position: relative;
          display: grid;
          place-items: center;
          min-height: 100svh;
          min-height: 100dvh;
          width: 100%;
          padding: 0 16px;
          overflow: hidden;
          isolation: isolate;
        }

        /* White canvas + soft pink radials (no dark gradients) */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background:
            background-color: #fff; /* sits behind, not blended */
              background-image:
                radial-gradient(600px 420px at 15% 18%, rgba(255,182,193,.35), transparent 60%),
                radial-gradient(720px 520px at 85% 35%, rgba(255,105,180,.28), transparent 65%),
                radial-gradient(900px 620px at 50% 85%, rgba(255,192,203,.28), transparent 70%);
              background-repeat: no-repeat;
              background-blend-mode: screen; /* blends the radials with each other only */
          z-index: -2;
          filter: saturate(105%);
        }

        .container { max-width: 980px; text-align: center; }

        .eyebrow {
          font-size: clamp(24px, 2vw, 22px);
          color: rgba(0,0,0,0.7);
          margin: 0 0 10px;
          font-weight: bold;
        }

        .display {
          position: relative;
          margin: 0;
          line-height: 1.05;
          letter-spacing: -0.02em;
          font-weight: 800;
          font-size: clamp(36px, 8vw, 84px);
          color: #111;
          text-shadow: 0 1px 0 rgba(255,255,255,0.6);
        }
        .light { font-weight: 600; }
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
          width: 55px; height: 55px;
          object-fit: cover;
          border-radius: 16px;
          box-shadow: 0 12px 34px rgba(0,0,0,0.15);
        }

        .sub {
          max-width: 740px;
          margin: 16px auto 28px;
          color: rgba(0,0,0,0.7);
          font-size: clamp(16px, 1.8vw, 20px);
          line-height: 1.6;
        }

        .ctaWrap { display: flex; justify-content: center; margin-top: 8px; }

        /* Black glassmorphism pill */
        /* Bigger, Montserrat, subtle glass, same gradient as script */
        .cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 12px;

          /* ~2× size */
          padding: 20px 36px;
          border-radius: 9999px;
          font-family: "Montserrat", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          font-size: clamp(18px, 2vw, 22px);
          line-height: 1;

          color: #fff;
          font-weight: 700;
          letter-spacing: 0.2px;

          background: linear-gradient(180deg, #111 0%, #333 100%);
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow:
            0 24px 60px rgba(255, 72, 146, 0.38),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
          backdrop-filter: blur(8px) saturate(115%);
          -webkit-backdrop-filter: blur(8px) saturate(115%);

          transition:
            transform 240ms cubic-bezier(.22,.61,.36,1),
            box-shadow 260ms ease,
            filter 260ms ease,
            background 260ms ease;
          overflow: hidden; /* for the shine sweep */
        }

        /* bump the arrow a bit since the button is larger */
        .cta svg { width: 22px; height: 22px; }

        /* shiny sweep on hover */
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
          transform: translateY(-2px) scale(1.04);
          filter: saturate(120%);
          box-shadow:
            0 34px 72px rgba(255, 72, 146, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.65);
          background: linear-gradient(180deg, #111 0%, #333 100%);
        }

        .cta:hover::before { transform: translateX(280%); }

        .cta:active { transform: translateY(0) scale(0.995); }


        /* Floating rounded image stickers */
        .float {
          position: absolute;
          overflow: hidden;
          border-radius: 28px;
          background: #fff;
          padding: 8px;
          box-shadow: 0 22px 60px rgba(0,0,0,0.15);
          transform: rotate(-3deg);
          z-index: -1;
        }
        .float img {
          display: block;
          border-radius: 22px;
          width: 220px; height: auto;
        }
        .left-float { top: 6%; left: 4%; animation: bob 9s ease-in-out infinite; }
        .right-float { right: 6%; bottom: 8%; transform: rotate(3deg); animation: bob 11s ease-in-out infinite; }

        @keyframes bob {
          0%, 100% { transform: translateY(0) rotate(var(--rot, -3deg)); }
          50%      { transform: translateY(-6px) rotate(var(--rot, -3deg)); }
        }

        @media (max-width: 900px) {
          .float img { width: 160px; }
          .right-float { display: none; }
        }
      `}</style>
    </section>
  );
}
