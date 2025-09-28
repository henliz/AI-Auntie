// site/app/page.tsx
import Nav from "./nav";
import Hero from "./hero";
import AboutAuntie from "./aboutauntie";
import Problem from "./problem";
import HowItWorks from "./howitworks";




export default function Home() {
  return (
    <>
      <Nav logoSrc="/logo.svg" brand="Auntie" ctaHref="#talk" />
      <Hero
        ctaHref="#talk"
        leftImageSrc="/images/left.jpg"   // optional
        rightImageSrc="/images/right.jpg" // optional
        iconSrc="/images/appicon.png"     // optional
      />
      {/* rest of the page… */}
      <Problem

      />
      <AboutAuntie
        topImageSrc="/images/about-top.jpg"
        bottomImageSrc="/images/about-bottom.jpg"
      />
      <HowItWorks
        textVideo="/videos/text-auntie.mp4"     // or a YouTube/Vimeo URL
        callVideo="/videos/call-auntie.mp4"     // or a YouTube/Vimeo URL
        textPoster="/videos/text-poster.jpg"
        callPoster="/videos/call-poster.jpg"
      />
    </>
  );
}

