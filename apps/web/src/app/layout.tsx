import "./globals.css";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-white text-zinc-900">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-red-600">MMD Delivery</h1>
            <span className="text-sm text-zinc-500">New York 2025</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
