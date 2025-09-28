// site/app/Problem.tsx
"use client";
import React from "react";

type ProblemProps = {
  images?: Array<{ src: string; alt?: string }>; // up to 6 images for the spots
};

export default function Problem({ images = [] }: ProblemProps) {
  return (
    <section id="problem" className="problem">
      <div className="bg" aria-hidden />
      <div className="rings" aria-hidden />

      {/* Image spots around the bubble */}
      {images[0] && (
        <figure className="spot spot1"><img src={images[0].src} alt={images[0].alt ?? ""} /></figure>
      )}
      {images[1] && (
        <figure className="spot spot2"><img src={images[1].src} alt={images[1].alt ?? ""} /></figure>
      )}
      {images[2] && (
        <figure className="spot spot3"><img src={images[2].src} alt={images[2].alt ?? ""} /></figure>
      )}
      {images[3] && (
        <figure className="spot spot4"><img src={images[3].src} alt={images[3].alt ?? ""} /></figure>
      )}
      {images[4] && (
        <figure className="spot spot5"><img src={images[4].src} alt={images[4].alt ?? ""} /></figure>
      )}
      {images[5] && (
        <figure className="spot spot6"><img src={images[5].src} alt={images[5].alt ?? ""} /></figure>
      )}

      <div className="wrap">
        <h2 className="eyebrow">The Problem</h2>

        {/* BIG speech bubble */}
        <article className="bubble" aria-label="Postpartum problem statement">
          <p>
            Postpartum depression and anxiety affect <strong>1 in 7</strong> mothers,
            yet most support options are either inaccessible or unhelpful. Current
            “solutions” often look like:
          </p>

          <ul>
            <li>
              <strong>Journaling / mood-tracking apps</strong> — burdensome, time-consuming,
              and easy to abandon when you’re exhausted.
            </li>
            <li>
              <strong>Generic mental-health platforms</strong> — built for broad audiences,
              not the unique hormonal, social, and physical realities of postpartum recovery.
            </li>
            <li>
              <strong>Family advice</strong> — well-meaning, but packed with myths, stigma,
              and pressure that can make things worse.
            </li>
          </ul>

          <p className="closer">
            Young first time moms <strong>don’t need another app</strong>: they need a warm,
            trustworthy voice that listens, gives evidence-based guidance, and connects them
            to the right local resources, fast.
          </p>
        </article>
      </div>

      <style jsx>{`
        .problem {
          --accent-1: #ff5ea3;
          --accent-2: #ff2f88;
          position: relative;
          padding: clamp(48px, 8vw, 120px) 20px clamp(64px, 10vw, 140px);
          overflow: hidden;
          isolation: isolate;
          scroll-margin-top: 96px; /* so #problem isn't hidden under the fixed nav */
        }

        /* White canvas + soft pink radials (behind everything) */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background-color: #fff;
          background-image:
            linear-gradient(180deg, rgba(255,94,163,0.10), rgba(255,47,136,0.10)),
            radial-gradient(700px 520px at 12% 18%, rgba(255,182,193,.35), transparent 60%),
            radial-gradient(820px 560px at 88% 22%, rgba(255,105,180,.28), transparent 65%),
            radial-gradient(900px 680px at 50% 95%, rgba(255,192,203,.28), transparent 70%);
          background-blend-mode: normal, screen, screen, screen;
          background-repeat: no-repeat;
          z-index: -3;
        }

        /* faint concentric rings for a “broadcast” feel */
        .rings {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 50% 55%,
              rgba(0,0,0,0.06) 0 1px, transparent 1px 140px),
            radial-gradient(circle at 50% 55%,
              rgba(0,0,0,0.045) 0 1px, transparent 1px 220px);
          opacity: 0.4;
          z-index: -2;
          mask-image: radial-gradient(circle at 50% 60%, black, transparent 70%);
        }

        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          place-items: center;
        }

        .eyebrow {
          margin: 0 0 16px;
          font-weight: 800;
          font-size: clamp(18px, 2.3vw, 24px);
          color: #111;
          letter-spacing: 0.2px;
        }

        /* Bubble body */
        .bubble {
          position: relative;
          max-width: 900px;
          padding: clamp(22px, 4.5vw, 40px) clamp(24px, 5.5vw, 48px);
          color: #fff;
          font-size: clamp(16px, 1.9vw, 20px);
          line-height: 1.65;

          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          border-radius: 28px;
          box-shadow:
            0 40px 80px rgba(255,72,146,0.25),
            inset 0 1px 0 rgba(255,255,255,0.4);
        }
        /* glossy top sheen */
        .bubble::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 40%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
        /* tail — moved left */
        .bubble::after {
          content: "";
          position: absolute;
          left: clamp(20px, 6%, 70px); /* further left than before */
          bottom: -28px;
          width: 120px;
          height: 56px;
          background: inherit;
          border-bottom-left-radius: 80px;
          transform: skewX(-14deg);
          filter: drop-shadow(0 22px 40px rgba(255,72,146,0.25));
        }

        .bubble p { margin: 0 0 12px; }
        .bubble p:last-child { margin-bottom: 0; }

        /* bullets inside the bubble */
        .bubble ul {
          margin: 10px 0 14px;
          padding-left: 1.2em;
        }
        .bubble li {
          margin-bottom: 10px;
        }

        /* circular image spots */
        .spot {
          position: absolute;
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: #fff;
          display: grid;
          place-items: center;
          box-shadow: 0 16px 48px rgba(0,0,0,0.12);
          overflow: hidden;
        }
        .spot img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
        }

        /* positions (tweak as you like) */
        .spot1 { left: 6%; top: 8%; }
        .spot2 { right: 8%; top: 10%; }
        .spot3 { left: 10%; bottom: 16%; }
        .spot4 { right: 10%; bottom: 18%; }
        .spot5 { left: 36%; top: 16%; width: 90px; height: 90px; }
        .spot6 { right: 30%; top: 22%; width: 90px; height: 90px; }

        @media (max-width: 900px) {
          .spot { width: 86px; height: 86px; }
          .spot5, .spot6 { width: 70px; height: 70px; }
          .rings { opacity: 0.3; }
        }
      `}</style>
    </section>
  );
}
