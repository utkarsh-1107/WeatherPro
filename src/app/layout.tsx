import type { Metadata } from "next";
import "./globals.css";

const SITE_URL =
  "https://weatherpro1130.vercel.app";

const TITLE =
  "Weather Intelligence";

const DESCRIPTION =
  "Live weather, hourly forecasts, AQI, rain tracking and smart activity insights for any city.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  title: TITLE,

  description: DESCRIPTION,

  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,

    images: [
      {
        url:
          "https://weatherpro1130.vercel.app/opengraph-image.jpg",

        secureUrl:
          "https://weatherpro1130.vercel.app/opengraph-image.jpg",

        width: 1200,
        height: 630,

        alt:
          "Weather Intelligence",

        type:
          "image/jpeg",
      },
    ],
  },

  twitter: {
    card:
      "summary_large_image",

    title: TITLE,

    description:
      DESCRIPTION,

    images: [
      "https://weatherpro1130.vercel.app/twitter-image.jpg",
    ],
  },

  icons: {
    icon:
      "/icon.png",

    apple:
      "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}