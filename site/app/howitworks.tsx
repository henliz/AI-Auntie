// site/app/HowItWorks.tsx
"use client";
import React, { useMemo, useRef, useState, useEffect } from "react";

type HowItWorksProps = {
  textVideo: string;        // mp4 or YouTube/Vimeo URL
  callVideo: string;        // mp4 or YouTube/Vimeo URL
  textPoster?: string;      // optional poster for mp4
  callPoster?: string;      // optional poster for mp4
};

export default function HowItWorks({
  textVideo,
  callVideo,
  textPoster,
  callPoster,
}: HowItWorksProps) {
  const steps = useMemo(
    () => [
      {
        key: "text" as const,
        num: "01",
        title: "Text Auntie",
        blurb:
          "Open your messages and text Auntie. Get calm, practical help in minutes—no accounts, no app chores.",
        src: "TextAuntie.mp4",
        poster: textPoster,
      },
      {
        key: "call" as const,
        num: "02",
        title: "Call Auntie",
        blurb:
          "Prefer a voice? Call Auntie for a warm, judgment-free chat. We’ll listen, triage, and guide you.",
        src: callVideo,
        poster: callPoster,
      },
    ],
    [textVideo, callVideo, textPoster, callPoster]
  );

  const [active, setActive] = useState<"text" | "call">("text");
  const lastSwitchRef = useRef(0);

  // Wheel/trackpad also switches steps (throttled)
  const onWheel = (e: React.WheelEvent<HTMLElement>) => {
    const now = Date.now();
    if (now - lastSwitchRef.current < 500) return;
    if (Math.abs(e.deltaY) < 24) return;

    setActive((prev) => (e.deltaY > 0 ? "call" : "text"));
    lastSwitchRef.current = now;
  };

  const isEmbed = (url: string) => /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
  const currentIndex = active === "text" ? 0 : 1;

  // Optional: keyboard up/down to swap
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowDown") setActive("call");
    if (e.key === "ArrowUp") setActive("text");
  };

  return (
    <section id="how" className="how" onWheel={onWheel} onKeyDown={onKeyDown} tabIndex={0}>
      <div className="bg" aria-hidden />

      <div className="wrap">
        <h2 className="title"><span className="script">How it works</span></h2>

        <div className="grid">
          {/* Steps (left) — clean, spaced, no white blocks */}
          <ol className="steps" role="tablist" aria-label="How it works">
            {steps.map((s, i) => {
              const selected = i === currentIndex;
              return (
                <li key={s.key} className={`row ${selected ? "active" : ""}`} role="presentation">
                  <button
                    className="stepBtn"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`panel-${s.key}`}
                    id={`tab-${s.key}`}
                    onClick={() => setActive(s.key)}
                  >
                    <span className="num">{s.num}</span>
                    <span className="copy">
                      <span className="heading">{s.title}</span>
                      <span className="blurb">{s.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Single viewer (right) — smooth cross-fade between the two sources */}
          <div className="viewer" role="tabpanel" aria-labelledby={`tab-${active}`} id={`panel-${active}`}>
            <div className="frame">
              {steps.map((s) => (
                <div
                  key={s.key}
                  className={`layer ${active === s.key ? "show" : "hide"}`}
                  aria-hidden={active !== s.key}
                >
                  {isEmbed(s.src) ? (
                    <iframe
                      className="media"
                      src={s.src
                        .replace("watch?v=", "embed/")
                        .replace("youtu.be/", "www.youtube.com/embed/")}
                      title={s.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <video
                      className="media"
                      src={s.src}
                      poster={s.poster}
                      controls
                      playsInline
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .how {
          --accent-1: #ff5ea3;
          --accent-2: #ff2f88;
          position: relative;
          padding: clamp(48px, 8vw, 120px) 20px;
          isolation: isolate;
          scroll-margin-top: 96px;
          outline: none;
        }

        /* soft pink field behind */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background-color: #fff;
          background-image:
            linear-gradient(180deg, rgba(255,94,163,0.10), rgba(255,47,136,0.10)),
            radial-gradient(700px 520px at 10% 20%, rgba(255,182,193,.30), transparent 60%),
            radial-gradient(820px 560px at 90% 30%, rgba(255,105,180,.24), transparent 65%);
          background-blend-mode: normal, screen, screen;
          z-index: -1;
        }

        .wrap { max-width: 1200px; margin: 0 auto; }

        /* pretty script title (matches hero) */
        .title { margin: 0 0 22px; line-height: 1.05; }
        .script {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          font-size: clamp(32px, 5.6vw, 56px);
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 10px 28px rgba(255, 72, 146, 0.25);
        }

        .grid {
          display: grid;
          grid-template-columns: 1.02fr 1fr;
          gap: clamp(22px, 5vw, 64px);
          align-items: start;
        }

        /* Steps — minimal, spaced, accent bar when active */
        .steps {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 20px;
          border-left: 2px solid rgba(0,0,0,0.08);
        }
        .row { position: relative; }
        .row.active::before {
          content: "";
          position: absolute;
          left: -2px;
          top: 8px;
          bottom: 8px;
          width: 2px;
          background: linear-gradient(180deg, var(--accent-1), var(--accent-2));
          border-radius: 2px;
        }

        .stepBtn {
          display: grid;
          grid-template-columns: 60px 1fr;
          gap: 16px;
          width: 100%;
          padding: 8px 0 8px 12px;
          background: transparent;
          border: 0;
          text-align: left;
          cursor: pointer;
        }
        .num {
          font-variant-numeric: tabular-nums;
          color: rgba(0,0,0,0.55);
          font-weight: 800;
          font-size: 18px;
          display: grid;
          place-items: center;
          border-right: 2px solid rgba(0,0,0,0.08);
          padding-right: 12px;
        }
        .copy { display: grid; gap: 6px; }
        .heading {
          color: #111;
          font-weight: 800;
          font-size: clamp(18px, 2.2vw, 26px);
          letter-spacing: -0.01em;
          transition: color 160ms ease;
        }
        .row.active .heading {
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
        }
        .blurb {
          color: rgba(0,0,0,0.65);
          font-size: clamp(15px, 1.7vw, 18px);
          line-height: 1.6;
        }

        /* One viewer with two layers that cross-fade */
        .viewer { width: 100%; }
        .frame {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          border-radius: 22px;
          overflow: hidden;
          background: #000;
          box-shadow:
            0 24px 60px rgba(0,0,0,0.20),
            inset 0 1px 0 rgba(255,255,255,0.35);
        }
        .layer {
          position: absolute;
          inset: 0;
          opacity: 0;
          pointer-events: none;
          transition: opacity 360ms ease;
        }
        .layer.show {
          opacity: 1;
          pointer-events: auto;
        }
        .media {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          border: 0;
        }

        @media (prefers-reduced-motion: reduce) {
          .layer { transition: none; }
        }

        @media (max-width: 980px) {
          .grid { grid-template-columns: 1fr; }
          .frame { aspect-ratio: 16 / 9; }
          .steps { border-left: none; }
          .num { border-right: none; }
        }
      `}</style>
    </section>
  );
}
