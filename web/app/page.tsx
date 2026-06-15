import VoiceConsole from "@/components/VoiceConsole";

export default function Home() {
  return (
    <main className="min-h-screen">
      <VoiceConsole />
      <footer className="pb-10 text-center text-xs text-slate-600">
        Powered by Gemini 2.5 Flash Live · FastAPI · Next.js
      </footer>
    </main>
  );
}
