import CreateErrandButton from "@/components/CreateErrandButton";
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'MMD Delivery',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}
      </body>
    </html>
  )
}



{/* Placez <CreateErrandButton/> dans votre navbar/header */}

