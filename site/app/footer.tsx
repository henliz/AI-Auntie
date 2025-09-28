// site/app/Footer.tsx
"use client";
import React from "react";

type FooterProps = {
  phone?: string; // display + tel/sms target, e.g. "+1 (415) 555-0134"
};

export default function Footer({ phone = "+1 (415) 555-0134" }: FooterProps) {
  const year = new Date().getFullYear();
  const telHref = `tel:${phone.replace(/[^\d+]/g, "")}`;
  const smsHref = `sms:${phone.replace(/[^\d+]/g, "")}`;

  return (
    <footer className="footer">
      <div className="bg" aria-hidden />
      {/* giant watermark */}
      <div className="mark" aria-hidden>
        <span>Auntie</span>
      </div>

      <div className="wrap">
        <div className="left">
          <span className="brand-script">Auntie</span>
          <div className="sub">© {year} • All Rights Reserved</div>
        </div>

        <ul className="links">
          <li><a href="#about">About Auntie</a></li>
          <li><a>Contact &amp; Support</a></li>
          <li><a>Terms &amp; Conditions</a></li>
          <li><a>Privacy Policy</a></li>
        </ul>
      </div>

      {/* centered glassy action */}
      <div className="ctaDock">
        <a className="cta" href={smsHref}>
          <span>Text Auntie</span>
        </a>
        <a className="cta alt" href={telHref}>
          <span>Call {phone}</span>
        </a>
      </div>

      <style jsx>{`
        .footer {
          --accent-1: #ff5ea3;
          --accent-2: #ff2f88;
          position: relative;
          padding: clamp(80px, 14vw, 160px) 20px clamp(120px, 16vw, 220px);
          overflow: hidden;
          background: linear-gradient(180deg, #fff, #fafafa);
          color: #222;
          isolation: isolate;
        }

        /* soft backdrop like the rest of the site */
        .bg {
          position: absolute;
          inset: -10% -20%;
          background-image:
            radial-gradient(900px 620px at 50% 0%, rgba(255,182,193,.18), transparent 60%),
            radial-gradient(700px 520px at 10% 80%, rgba(255,105,180,.12), transparent 60%);
          background-repeat: no-repeat;
          z-index: -2;
        }

        /* watermark */
        .mark {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          pointer-events: none;
          z-index: -1;
        }
        .mark span {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          font-size: clamp(180px, 34vw, 520px);
          line-height: 0.8;
          color: rgba(0,0,0,0.055); /* faint */
          letter-spacing: 0.02em;
          transform: translateY(6%);
          user-select: none;
          white-space: nowrap;
        }

        .wrap {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 20px;
          align-items: end;
        }

        .brand-script {
          font-family: ui-serif, Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 700;
          font-size: 26px;
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 8px 22px rgba(255,72,146,0.20);
        }
        .sub {
          margin-top: 8px;
          color: rgba(0,0,0,0.55);
          font-size: 14px;
        }

        .links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
          text-align: right;
        }
        .links a {
          color: rgba(0,0,0,0.65);
          text-decoration: none;
          transition: color 160ms ease;
        }
        .links a:hover { color: rgba(0,0,0,0.9); }

        /* centered pill buttons */
        .ctaDock {
          position: absolute;
          left: 50%;
          bottom: clamp(24px, 3vw, 40px);
          transform: translateX(-50%);
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: center;
        }
        .cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 12px 18px;
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.55);
          background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
          color: #fff;
          font-weight: 700;
          box-shadow:
            0 16px 40px rgba(255,72,146,0.28),
            inset 0 1px 0 rgba(255,255,255,0.55);
          backdrop-filter: blur(10px) saturate(120%);
          -webkit-backdrop-filter: blur(10px) saturate(120%);
          transition: transform 200ms cubic-bezier(.22,.61,.36,1),
                      box-shadow 220ms ease,
                      filter 220ms ease;
          text-decoration: none;
          white-space: nowrap;
        }
        .cta:hover {
          transform: translateY(-2px) scale(1.03);
          filter: saturate(115%);
          box-shadow: 0 22px 54px rgba(255,72,146,0.34), inset 0 1px 0 rgba(255,255,255,0.65);
        }
        .cta:active { transform: translateY(0) scale(0.995); }

        .cta.alt {
          background: linear-gradient(135deg, #ff7aa9, #ff4c8f); /* slightly different blush for variety */
        }

        @media (max-width: 860px) {
          .wrap { grid-template-columns: 1fr; gap: 12px; }
          .links { text-align: left; grid-auto-flow: column; grid-auto-columns: 1fr; overflow-x: auto; gap: 16px; }
          .links::-webkit-scrollbar { display: none; }
          .mark span { transform: translateY(10%); }
        }
      `}</style>
    </footer>
  );
}
