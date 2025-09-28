// site/app/AboutAuntie.tsx
"use client";
import React from "react";

type AboutProps = {
  topImageSrc?: string;     // e.g. "/images/auntie1.jpg"
  bottomImageSrc?: string;  // e.g. "/images/auntie2.jpg"
};

export default function AboutAuntie({
  topImageSrc,
  bottomImageSrc,
}: AboutProps) {
  return (
    <section id="about" className="about">
      <div className="bg" aria-hidden />

      <div className="wrap">
        {/* LEFT: floating transparent image “cards” */}
        <div className="stack">
          {bottomImageSrc && (
            <figure className="card card-bottom">
              <img src="AuntieSample.png" alt="Everyday comfort from Auntie" />
            </figure>
          )}
          {topImageSrc && (
            <figure className="card card-top">
              <img src="AuntieBubble.png" alt="A mom enjoying a calm moment" />
            </figure>
          )}
        </div>

        {/* RIGHT: title + blurb */}
        <div className="text">
          <h2 className="title">
            <span className="script">About Auntie</span>
          </h2>

          <p className="lead">
            When you’re awake at <span className="chip">3 a.m.</span> with a
            crying baby, you don’t want to download another app or fill out a
            form — you want someone who simply picks up, understands, and helps.
          </p>

          <p>
          Auntie is a warm, SMS/voice-first line for the{" "}
          <strong>fourth trimester</strong>. She listens, triages what you
          need— comfort, practical resources, or a gentle escalation, and
          replies with evidence-based guidance plus local, trusted links when
          that’s useful. No dashboards, no mood-tracking chores: just real,
          judgement-free support that meets you where you are.
        </p>


          <p><br></br>
            <strong>Why a line, not an app?</strong> Because most tools ask new moms to do more
            work. Auntie removes friction, remembers a little context (like
            delivery type or feeding), and connects you quickly to what helps —from latch basics to vetted helplines— all in a tone that feels like
            family.
          </p>
        </div>
      </div>

      <style jsx>{`
        .about {
          --accent-1: #ff5ea3;
          --accent-2: #ff2f88;
          position: relative;
          padding: clamp(40px, 8vw, 120px) 20px;
          overflow: hidden;
          isolation: isolate;
        }

        /* White canvas + soft pink radials */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background-color: #fff;
          background-image:
            radial-gradient(700px 520px at 12% 20%, rgba(255, 182, 193, 0.35), transparent 60%),
            radial-gradient(820px 560px at 88% 25%, rgba(255, 105, 180, 0.28), transparent 65%),
            radial-gradient(900px 680px at 50% 95%, rgba(255, 192, 203, 0.28), transparent 70%);
          background-repeat: no-repeat;
          background-blend-mode: screen;
          z-index: -2;
        }

        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: clamp(24px, 4vw, 60px);
          align-items: center;
        }

        /* Image stack */
        /* Image stack */
        .stack {
          position: relative;
          min-height: clamp(260px, 45vw, 540px);
        }

        /* make figures plain (no frame/shadow/padding) */
        .card {
          position: absolute;
          inset: auto;
          width: min(85%, 520px);   /* default size (applies to bottom) */
          background: transparent;  /* remove white card bg */
          padding: 0;               /* remove frame padding */
          box-shadow: none;         /* remove drop shadow */
          backdrop-filter: none;    /* remove blur */
          border-radius: 0;         /* keep PNG edges as-is */
        }
        .card img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 0;         /* no rounded mask */
        }

        /* AuntieSample (bottom): push a little left */
        .card-bottom {
          left: -24px;              /* was 0; nudge left ~24px */
          bottom: 0;
          transform: rotate(-6deg);
        }

        /* AuntieBubble (top): make smaller */
        .card-top {
          right: 0;
          top: 0;
          width: min(70%, 420px);   /* smaller than bottom */
          transform: rotate(4deg);
        }


        /* Text column */
        .text {
          color: #111;
          font-size: clamp(16px, 1.7vw, 18px);
          line-height: 1.65;
        }
        .title {
          margin: 0 0 8px;
          font-size: clamp(28px, 5vw, 44px);
        }
        .script {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 8px 22px rgba(255, 72, 146, 0.25);
        }
        .lead {
          margin: 10px 0 14px;
          color: rgba(0, 0, 0, 0.72);
          font-size: clamp(17px, 2vw, 20px);
        }
        .chip {
          display: inline-block;
          padding: 4px 10px;
          margin: 0 6px;
          border-radius: 9999px;
          background: rgba(255, 182, 193, 0.18);
          box-shadow: inset 0 0 0 1px rgba(255, 105, 180, 0.28),
            0 4px 12px rgba(255, 72, 146, 0.14);
          font-weight: 700;
          color: #111;
        }

        @media (max-width: 980px) {
          .wrap {
            grid-template-columns: 1fr;
            gap: 28px;
          }
          .stack {
            min-height: 380px;
            order: 2;
          }
          .text {
            order: 1;
          }
          .card {
            width: min(86%, 520px);
          }
        }
      `}</style>
    </section>
  );
}
