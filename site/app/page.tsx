// site/app/page.tsx
import Nav from "./Nav";
import Hero from "./Hero";

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
    </>
  );
}

